"""Queue behavior against real isolated SQLite, without model substitutions."""
import tempfile
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from backend.batches import BatchStore
from backend.database import Database
from backend.streams import StreamInput, StreamStore
from tests.test_stream_api import stream_config


class DurableFifoTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vox-fifo-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / 'db.sqlite3')
        self.database.initialize()
        self.streams = StreamStore(self.database, self.root / 'materials')
        self.store = BatchStore(self.database, self.streams, self.root / 'inputs', 'ffprobe')

    def ready_batch(self, name):
        owner = self.database.create_customer(name)['customer_id']
        stream = self.streams.create(owner, StreamInput.model_validate(stream_config(
            text_correction_enabled=False, unwanted_expressions_enabled=False)),
            {'knowledge_base': b'Answers'})
        batch, _ = self.store.create(owner, stream['stream_id'], str(uuid4()))
        bid, cid = batch['batch_id'], str(uuid4())
        path = self.store.path(bid, cid)
        path.parent.mkdir(parents=True)
        path.write_bytes(b'preserved input')
        with self.database.connection() as connection:
            connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                               (cid, bid, 'call.mp3', cid, None, None, 1))
        self.store.complete(bid, owner)
        return bid

    def test_pause_waits_for_current_call_then_resumes_without_repeating(self):
        import threading
        import time
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from backend.api import create_app
        from backend.config import BackendSettings
        bid = self.ready_batch('Pause')
        cid = str(uuid4())
        self.store.path(bid, cid).write_bytes(b'second input')
        with self.database.connection() as connection:
            connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                               (cid, bid, 'second.mp3', cid, None, None, 1))
        started = threading.Event()
        release = threading.Event()
        calls = []
        def process(path, **kwargs):
            calls.append(path)
            if len(calls) == 1:
                started.set()
                release.wait(5)
            raise RuntimeError('test call failure')
        settings = BackendSettings(database_path=self.database.path, materials_root=self.root/'materials',
                                   inputs_root=self.root/'inputs', admin_api_key='test-admin-key-not-for-production')
        admin = {'Authorization': 'Bearer test-admin-key-not-for-production'}
        other = self.database.create_customer('Other key')
        outsider = {'Authorization': 'Bearer '+other['api_key']}
        self.store.start(bid)
        with TestClient(create_app(settings)) as client, patch('pipeline.process_call', side_effect=process), ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.store.process, bid)
            try:
                self.assertTrue(started.wait(5))
                endpoint = f'/v1/admin/batches/{bid}'
                self.assertEqual(client.post(endpoint+'/pause').status_code, 401)
                self.assertEqual(client.post(endpoint+'/pause', headers=outsider).status_code, 403)
                self.assertEqual(client.post(endpoint+'/resume', headers=outsider).status_code, 403)
                pending = client.post(endpoint+'/pause', headers=admin)
                self.assertEqual(pending.status_code, 200)
                self.assertTrue(pending.json()['processing_progress']['pause_requested'])
                self.assertFalse(pending.json()['processing_progress']['paused'])
                self.assertEqual(client.post(endpoint+'/pause', headers=admin).status_code, 200)
                release.set()
                deadline = time.monotonic()+5
                while time.monotonic()<deadline and not self.store.get(bid)['processing_progress']['paused']:
                    time.sleep(.01)
                paused = self.store.get(bid)
                self.assertTrue(paused['processing_progress']['paused'])
                self.assertEqual(paused['processing_progress']['processed_calls'], 1)
                self.assertEqual(len(calls), 1)
                self.assertFalse(future.done())
                self.assertIsNone(self.store.claim_next())
                with self.database.connection() as connection:
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                with self.assertRaises(ValueError): self.store.report(bid)
                resumed = client.post(endpoint+'/resume', headers=admin)
                self.assertEqual(resumed.status_code, 200)
                self.assertFalse(resumed.json()['processing_progress']['pause_requested'])
                self.assertTrue(future.result(5))
                self.assertEqual(len(calls), 2)
                self.assertEqual(len(set(calls)), 2)
                self.assertEqual(self.store.get(bid)['status'], 'completed')
                self.assertEqual(client.post(endpoint+'/pause', headers=admin).status_code, 409)
                self.assertEqual(client.post(f'/v1/admin/batches/{uuid4()}/pause', headers=admin).status_code, 404)
            finally:
                release.set()
                if self.store.get(bid)['status']=='processing': self.store.pause(bid, requested=False)

    def test_restart_of_paused_attempt_requires_full_restoration(self):
        bid = self.ready_batch('Interrupted pause')
        self.store.start(bid)
        self.assertEqual(self.store.claim_next(), bid)
        self.store.pause(bid)
        with self.database.connection() as connection:
            connection.execute('UPDATE batches SET processing_paused = 1 WHERE id = ?', (bid,))
        with self.store.processing_lock:
            self.store.recover_interrupted()
        result = self.store.get(bid)
        self.assertEqual(result['status'], 'batch_failed')
        self.assertFalse(result['processing_progress']['paused'])
        self.assertFalse(result['processing_progress']['pause_requested'])
        self.assertTrue(any((self.root/'inputs'/bid).iterdir()))
        with self.database.connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)

    def test_resource_analytics_include_failed_calls_and_exclude_pauses(self):
        from unittest.mock import patch
        from usage_metrics import usage_request
        from types import SimpleNamespace
        from unittest.mock import Mock
        import json
        bid = self.ready_batch('Resource usage')
        with self.database.connection() as connection:
            connection.execute('UPDATE calls SET duration_seconds = 100 WHERE batch_id = ?', (bid,))
        def process(*args, **kwargs):
            for stage, tokens in [('whisper',60),('llm_roles',10),('llm_analysis',30)]:
                with usage_request(stage) as request: request.capture({'total_tokens':tokens})
            raise RuntimeError('failed after provider consumed tokens')
        self.store.start(bid)
        with patch('pipeline.process_call',side_effect=process), patch.object(self.store,'_wait_if_paused',side_effect=[0,100]), patch('backend.batches.time',SimpleNamespace(perf_counter=Mock(side_effect=[0,1,5,125]))):
            self.assertTrue(self.store.process(bid))
        report=self.store.report(bid)
        metrics=report['processing_analytics']
        self.assertEqual(metrics['total_audio_seconds'],100)
        self.assertEqual(metrics['active_duration_seconds'],25)
        self.assertEqual(metrics['pause_duration_seconds'],100)
        self.assertEqual(metrics['speed_ratio'],4)
        self.assertEqual(metrics['whisper_usage']['total_tokens'],60)
        self.assertEqual(metrics['llm_usage']['total_tokens'],40)
        self.assertEqual(report['processing_errors'],1)
        # Historical reports retain duration, but never invent active time or tokens.
        report.pop('processing_analytics')
        with self.database.connection() as connection:
            connection.execute('UPDATE batches SET summary = ? WHERE id = ?', (json.dumps(report),bid))
        historical=self.store.report(bid)['processing_analytics']
        self.assertEqual(historical['total_audio_seconds'],100)
        self.assertIsNone(historical['active_duration_seconds'])
        self.assertIsNone(historical['speed_ratio'])
        self.assertIsNone(historical['whisper_usage'])

    def test_progress_counts_finished_attempts_without_publishing_partial_results(self):
        from unittest.mock import patch
        bid = self.ready_batch('Progress')
        cid = str(uuid4())
        self.store.path(bid, cid).write_bytes(b'second input')
        with self.database.connection() as connection:
            connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                               (cid, bid, 'second.mp3', cid, None, None, 1))
        self.store.start(bid)
        seen = []
        def process(*args, **kwargs):
            details = self.store.get(bid)
            seen.append(details['processing_progress']['processed_calls'])
            self.assertEqual(details['status'], 'processing')
            self.assertEqual(details['processing_progress']['total_calls'], 2)
            with self.database.connection() as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
            with self.assertRaises(ValueError):
                self.store.report(bid)
            raise RuntimeError('failed call still counts as finished')
        with patch('pipeline.process_call', side_effect=process):
            self.assertTrue(self.store.process(bid))
        self.assertEqual(seen, [0, 1])
        self.assertEqual(self.store.get(bid)['processing_progress'], {'processed_calls': 2, 'total_calls': 2, 'paused': False, 'pause_requested': False})
        self.assertEqual(self.store.report(bid)['processing_errors'], 2)
        with self.assertRaises(LookupError):
            self.store.get(bid, 'other-owner')

    def test_existing_database_upgrades_and_new_attempt_resets_progress(self):
        bid = self.ready_batch('Migration')
        with self.database.connection() as connection:
            connection.execute('ALTER TABLE batches DROP COLUMN processed_calls')
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: Database(self.database.path).initialize(), range(2)))
        self.assertEqual(self.store.get(bid)['processing_progress']['processed_calls'], 0)
        with self.database.connection() as connection:
            connection.execute('UPDATE batches SET processed_calls = 1 WHERE id = ?', (bid,))
        self.store.start(bid)
        self.assertEqual(self.store.get(bid)['processing_progress']['processed_calls'], 0)

    def test_fifo_is_accepted_start_not_batch_creation_and_survives_reopen(self):
        first_created = self.ready_batch('A')
        second_created = self.ready_batch('B')
        self.store.start(second_created)
        self.store.start(first_created)
        reopened = BatchStore(Database(self.database.path), self.streams, self.root / 'inputs', 'ffprobe')
        self.assertEqual(reopened.claim_next(), second_created)
        self.assertEqual(reopened.get(second_created)['status'], 'processing')
        self.assertIsNone(reopened.claim_next())
        self.assertEqual(reopened.get(first_created)['status'], 'queued')

    def test_concurrent_starts_and_claims_create_one_attempt(self):
        bid = self.ready_batch('A')
        with ThreadPoolExecutor(max_workers=8) as pool:
            accepted = list(pool.map(lambda _: self.store.start(bid)[1], range(16)))
        self.assertEqual(sum(accepted), 1)
        with ThreadPoolExecutor(max_workers=8) as pool:
            claims = list(pool.map(lambda _: self.store.claim_next(), range(16)))
        self.assertEqual(claims.count(bid), 1)
        self.assertEqual(claims.count(None), 15)
        self.assertFalse(self.store.start(bid)[1])

    def test_recovery_fails_unpublished_preserves_inputs_and_releases_old_attempt(self):
        interrupted = self.ready_batch('A')
        waiting = self.ready_batch('B')
        self.store.start(interrupted)
        self.store.start(waiting)
        self.assertEqual(self.store.claim_next(), interrupted)
        self.store.recover_interrupted()
        batch = self.store.get(interrupted)
        self.assertEqual(batch['status'], 'batch_failed')
        self.assertEqual(batch['error'], 'worker_interrupted')
        self.assertTrue(next((self.root / 'inputs' / interrupted).iterdir()).is_file())
        self.assertEqual(self.store.claim_next(), waiting)
        with self.database.connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM batch_queue WHERE batch_id = ?',
                                                 (interrupted,)).fetchone())

    def test_failed_processing_releases_queue_and_does_not_skip_fifo(self):
        first = self.ready_batch('A')
        second = self.ready_batch('B')
        self.store.start(first)
        self.store.start(second)
        self.assertFalse(self.store.process(second))
        for material in (self.root / 'materials').rglob('knowledge_base'):
            material.write_bytes(b'corrupted')
        self.assertFalse(self.store.process(first))
        self.assertEqual(self.store.get(first)['status'], 'batch_failed')
        self.assertEqual(self.store.claim_next(), second)
        with self.database.connection() as connection:
            self.assertIsNone(connection.execute('SELECT 1 FROM batch_queue WHERE batch_id = ?',
                                                 (first,)).fetchone())

    def test_enqueue_failure_rolls_back_status_and_claim_failure_rolls_back_queue(self):
        bid = self.ready_batch('A')
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER reject_enqueue BEFORE UPDATE OF status ON batches "
                               "WHEN NEW.status = 'queued' BEGIN SELECT RAISE(ABORT, 'injected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.start(bid)
        self.assertEqual(self.store.get(bid)['status'], 'ready')
        with self.database.connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM batch_queue').fetchone()[0], 0)
            connection.execute('DROP TRIGGER reject_enqueue')
        self.store.start(bid)
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER reject_claim BEFORE UPDATE OF status ON batches "
                               "WHEN NEW.status = 'processing' BEGIN SELECT RAISE(ABORT, 'injected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.claim_next()
        self.assertEqual(self.store.get(bid)['status'], 'queued')
        with self.database.connection() as connection:
            self.assertIsNone(connection.execute('SELECT claimed_at FROM batch_queue').fetchone()[0])
            connection.execute('DROP TRIGGER reject_claim')
        self.assertEqual(self.store.claim_next(), bid)

    def test_database_initialization_does_not_recover_active_worker(self):
        bid = self.ready_batch('A')
        self.store.start(bid)
        self.store.claim_next()
        Database(self.database.path).initialize()
        self.assertEqual(self.store.get(bid)['status'], 'processing')

    def test_legacy_queued_without_saved_start_order_is_explicit_failure(self):
        bid = self.ready_batch('Legacy')
        with self.database.connection() as connection:
            connection.execute("UPDATE batches SET status = 'queued' WHERE id = ?", (bid,))
        self.store.recover_interrupted()
        batch = self.store.get(bid)
        self.assertEqual(batch['status'], 'batch_failed')
        self.assertEqual(batch['error'], 'queue_order_unavailable')
        self.assertTrue(next((self.root / 'inputs' / bid).iterdir()).is_file())