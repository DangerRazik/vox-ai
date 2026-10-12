import unittest
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch

from tests import test_batch_restoration
from tests.test_stream_api import ADMIN


class StreamDeletionTests(test_batch_restoration.BatchRestorationTests):
    # Reuse isolated REST fixture, not its restoration acceptance tests.
    test_requires_all_original_files_despite_preserved_inputs_and_keeps_progress = None
    test_concurrent_recovery_repeats_and_new_attempt_goes_to_fifo_tail = None
    test_failed_receipt_commit_does_not_count_file_or_delete_preserved_input = None

    def test_delete_queued_stream_removes_resources_not_customer_or_neighbor(self):
        neighbor = self.new_stream()
        self.store.start(self.bid)
        path = f'/v1/admin/streams/{self.sid}'
        self.assertEqual(self.client.delete(path, headers=self.owner).status_code, 403)
        self.assertEqual(self.client.delete(path, headers=ADMIN).status_code, 204)
        for resource in (f'/v1/streams/{self.sid}', f'/v1/batches/{self.bid}',
                         f'/v1/calls/{self.calls[0]}/report'):
            self.assertEqual(self.client.get(resource, headers=ADMIN).status_code, 404)
        self.assertIsNone(self.store.claim_next())
        self.assertEqual(self.client.get(f'/v1/streams/{neighbor}', headers=ADMIN).status_code, 200)
        self.assertEqual(self.client.get(f'/v1/customers/{self.customer_id}', headers=ADMIN).status_code, 200)
        self.assertFalse((self.settings.inputs_root / self.bid).exists())
        self.assertFalse((self.settings.materials_root / self.sid).exists())

    def test_busy_processing_uploading_restoring_and_active_file_lock(self):
        path = f'/v1/admin/streams/{self.sid}'
        with self.store.input_lock(self.bid):
            # Separate thread owns the HTTP operation, so it cannot reuse our lock.
            with ThreadPoolExecutor(max_workers=1) as pool:
                response = pool.submit(self.client.delete, path, headers=ADMIN).result()
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()['error']['code'], 'resource_busy')
        self.store.start(self.bid)
        self.assertEqual(self.store.claim_next(), self.bid)
        self.assertEqual(self.client.delete(path, headers=ADMIN).status_code, 409)
        with self.store.processing_lock:
            self.store.recover_interrupted()
        self.client.post('/v1/batches', headers=self.owner, json=self.body).raise_for_status()
        self.assertEqual(self.client.delete(path, headers=ADMIN).status_code, 409)
        new_sid = self.new_stream()
        self.client.post('/v1/batches', headers=self.owner,
                         json={**self.body, 'stream_id': new_sid, 'upload_id': self.sid}).raise_for_status()
        self.assertEqual(self.client.delete(f'/v1/admin/streams/{new_sid}', headers=ADMIN).status_code, 409)

    def test_cleanup_failure_and_crash_keep_intents_after_history_disappears(self):
        with patch('backend.batches.shutil.rmtree', side_effect=PermissionError('private path')):
            self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 204)
        self.assertTrue((self.settings.materials_root / self.sid).is_dir())
        self.assertEqual(self.client.get(f'/v1/batches/{self.bid}', headers=ADMIN).status_code, 404)
        self.database.initialize()
        with patch('pipeline.process_call', side_effect=AssertionError('never analyze')):
            self.store.cleanup_deleted_streams()
            self.store.cleanup_deleted_streams()
        self.assertFalse((self.settings.materials_root / self.sid).exists())
        self.assertFalse((self.settings.inputs_root / self.bid).exists())
        self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 404)

    def test_intent_or_delete_failure_rolls_back_all_history(self):
        self.store.start(self.bid)
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER deny_delete BEFORE DELETE ON streams "
                               "BEGIN SELECT RAISE(ABORT, 'controlled'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.delete_stream(self.sid)
        self.assertEqual(self.store.get(self.bid)['status'], 'queued')
        self.store.cleanup_deleted_streams()
        self.assertTrue((self.settings.materials_root / self.sid).exists())
        self.assertTrue(self.store.path(self.bid, self.calls[0]).is_file())
        self.assertEqual(self.store.claim_next(), self.bid)

    def test_claim_and_delete_are_serialized(self):
        self.store.start(self.bid)
        go = Event()

        def claim():
            go.wait()
            return self.store.claim_next()

        def delete():
            go.wait()
            return self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            claimed = pool.submit(claim)
            deleted = pool.submit(delete)
            go.set()
            result, status = claimed.result(), deleted.result()
        if status == 204:
            self.assertIsNone(result)
            self.assertIsNone(self.store.claim_next())
        else:
            self.assertEqual(status, 409)
            self.assertEqual(result, self.bid)
            self.assertEqual(self.store.get(self.bid)['status'], 'processing')

    def test_start_and_delete_never_return_server_error(self):
        go = Event()

        def start():
            go.wait()
            return self.client.post(f'/v1/admin/batches/{self.bid}/start', headers=ADMIN).status_code

        def delete():
            go.wait()
            return self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            started, deleted = pool.submit(start), pool.submit(delete)
            go.set()
            self.assertIn(started.result(), (202, 404))
            self.assertEqual(deleted.result(), 204)
        self.assertIsNone(self.store.claim_next())

    def test_actual_inflight_file_receipt_conflicts_with_delete(self):
        import io
        entered, release = Event(), Event()

        class PausedInput(io.BytesIO):
            def read(self, size=-1):
                entered.set()
                if not release.wait(timeout=10):
                    raise TimeoutError('receipt not released')
                return super().read(size)

        # Completed native uploads acknowledge duplicates without restoring inputs.
        # Missing managed inputs produce errors before any model request.
        for cid in self.calls:
            self.store.path(self.bid, cid).unlink()
        self.store.start(self.bid)
        self.assertTrue(self.store.process(self.bid))
        with ThreadPoolExecutor(max_workers=1) as pool:
            upload = pool.submit(self.store.add, self.bid, self.customer_id,
                                 PausedInput(self.contents[0]), 'repeat.wav')
            try:
                self.assertTrue(entered.wait(timeout=5))
                self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 409)
            finally:
                release.set()
            call, created = upload.result()
            self.assertTrue(call['duplicate'])
            self.assertFalse(created)
        self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 204)

    def test_exit_after_history_commit_preserves_cleanup_and_ack_retry(self):
        class ControlledExit(BaseException):
            pass

        with patch.object(self.store, 'cleanup_deleted_streams', side_effect=ControlledExit):
            with self.assertRaises(ControlledExit):
                self.store.delete_stream(self.sid)
        self.assertEqual(self.client.get(f'/v1/streams/{self.sid}', headers=ADMIN).status_code, 404)
        self.assertTrue((self.settings.materials_root / self.sid).exists())
        self.database.initialize()
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER deny_ack BEFORE UPDATE ON deleted_stream_cleanup "
                               "BEGIN SELECT RAISE(ABORT, 'controlled'); END")
        self.store.cleanup_deleted_streams()
        self.assertFalse((self.settings.materials_root / self.sid).exists())
        with self.database.connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM deleted_stream_cleanup WHERE status='pending'").fetchone()[0], 2)
            connection.execute('DROP TRIGGER deny_ack')
        self.store.cleanup_deleted_streams()
        self.store.cleanup_deleted_streams()
        with self.database.connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM deleted_stream_cleanup WHERE status='pending'").fetchone()[0], 0)
