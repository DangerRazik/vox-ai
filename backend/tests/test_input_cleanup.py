"""Durable cleanup at BatchStore boundaries with real SQLite and files."""
import tempfile
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from backend.batches import BatchStore
from backend.database import Database
from backend.streams import StreamInput, StreamStore
from tests.test_stream_api import stream_config


class InputCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vox-cleanup-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / 'db.sqlite3')
        self.database.initialize()
        self.owner = self.database.create_customer('A')['customer_id']
        self.streams = StreamStore(self.database, self.root / 'materials')
        self.stream = self.streams.create(self.owner, StreamInput.model_validate(stream_config(
            text_correction_enabled=False, unwanted_expressions_enabled=False)), {'knowledge_base': b'Answers'})
        self.store = BatchStore(self.database, self.streams, self.root / 'inputs', 'ffprobe')
        self.bid, self.cid = self.new_batch()

    def new_batch(self):
        batch, _ = self.store.create(self.owner, self.stream['stream_id'], str(uuid4()))
        bid, cid = batch['batch_id'], str(uuid4())
        path = self.store.path(bid, cid)
        path.parent.mkdir(parents=True)
        path.write_bytes(b'input preserved until commit')
        with self.database.connection() as connection:
            connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                               (cid, bid, 'call.mp3', cid, None, None, 1))
        self.store.complete(bid, self.owner)
        return bid, cid

    def publish_processing_error(self):
        self.store.start(self.bid)
        # Fail reading this actual input before any service request; no model responses replaced.
        original = Path.open

        def fail_input(path, *args, **kwargs):
            if path == self.store.path(self.bid, self.cid):
                raise PermissionError('controlled input read failure')
            return original(path, *args, **kwargs)

        with patch.object(Path, 'open', fail_input):
            self.assertTrue(self.store.process(self.bid))

    def test_deletion_failure_preserves_completed_report_and_retries_after_reopen(self):
        other_bid, other_cid = self.new_batch()
        archive = self.root / 'inputs' / self.bid / 'source.zip'
        archive.write_bytes(b'managed archive')
        materials = {p: p.read_bytes() for p in (self.root / 'materials').rglob('*') if p.is_file()}
        with patch('backend.batches.shutil.rmtree', side_effect=PermissionError('do not expose secret paths')):
            self.publish_processing_error()
        state = self.store.get(self.bid)
        self.assertEqual(state['status'], 'completed')
        self.assertIsNone(state['error'])
        self.assertEqual(state['cleanup']['status'], 'pending')
        self.assertEqual(state['cleanup']['error'], 'input_cleanup_permission_denied')
        report = self.store.report(self.bid)
        self.assertEqual(report['processing_errors'], 1)
        self.assertTrue(archive.is_file())
        self.database.initialize()
        reopened = BatchStore(self.database, self.streams, self.root / 'inputs', 'ffprobe')
        with patch('pipeline.process_call', side_effect=AssertionError('cleanup must never analyze')):
            reopened.cleanup_pending()
            reopened.cleanup_pending()
        self.assertEqual(reopened.get(self.bid)['cleanup']['status'], 'completed')
        self.assertIsNone(reopened.get(self.bid)['cleanup']['error'])
        self.assertEqual(reopened.report(self.bid), report)
        self.assertFalse(archive.parent.exists())
        self.assertTrue(self.store.path(other_bid, other_cid).is_file())
        self.assertTrue(self.database.path.is_file())
        self.assertEqual({p: p.read_bytes() for p in materials}, materials)

    def test_crash_after_commit_keeps_intent_and_missing_directory_is_safe(self):
        class ControlledCrash(BaseException):
            pass

        with patch.object(self.store, 'cleanup_pending', side_effect=ControlledCrash):
            with self.assertRaises(ControlledCrash):
                self.publish_processing_error()
        self.assertEqual(self.store.get(self.bid)['status'], 'completed')
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'pending')
        self.store.path(self.bid, self.cid).unlink()
        self.store.path(self.bid, self.cid).parent.rmdir()
        report = self.store.report(self.bid)
        self.store.cleanup_pending()
        self.store.cleanup_pending()
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'completed')
        self.assertEqual(self.store.report(self.bid), report)

    def test_directory_junction_cannot_redirect_cleanup_outside_batch(self):
        with patch.object(self.store, 'cleanup_pending'):
            self.publish_processing_error()
        directory = self.store.path(self.bid, self.cid).parent
        self.store.path(self.bid, self.cid).unlink()
        directory.rmdir()
        outside = self.root / 'outside'
        outside.mkdir()
        protected = outside / 'preserve.txt'
        protected.write_bytes(b'outside managed inputs')
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(directory), str(outside)], capture_output=True)
        self.assertEqual(result.returncode, 0)
        try:
            self.store.cleanup_pending()
            self.assertEqual(self.store.get(self.bid)['cleanup']['error'], 'input_cleanup_unsafe_path')
            self.assertEqual(protected.read_bytes(), b'outside managed inputs')
        finally:
            directory.rmdir()
        self.store.cleanup_pending()
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'completed')

    def test_cleanup_intent_failure_rolls_back_publication_and_preserves_inputs(self):
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER reject_cleanup BEFORE INSERT ON input_cleanup "
                               "BEGIN SELECT RAISE(ABORT, 'controlled'); END")
        self.store.start(self.bid)
        # Fail only input reading to reach the publication transaction.
        original = Path.open

        def fail_input(path, *args, **kwargs):
            if path == self.store.path(self.bid, self.cid):
                raise PermissionError('controlled input failure')
            return original(path, *args, **kwargs)

        with patch.object(Path, 'open', fail_input):
            self.assertFalse(self.store.process(self.bid))
        self.assertEqual(self.store.get(self.bid)['status'], 'batch_failed')
        self.assertIsNone(self.store.get(self.bid)['cleanup'])
        self.store.cleanup_pending()
        self.assertTrue(self.store.path(self.bid, self.cid).is_file())
        with self.assertRaises(ValueError):
            self.store.report(self.bid)

    def test_acknowledgement_failure_retries_already_deleted_inputs(self):
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER reject_cleanup_ack BEFORE UPDATE ON input_cleanup "
                               "BEGIN SELECT RAISE(ABORT, 'controlled'); END")
        self.publish_processing_error()
        self.assertFalse(self.store.path(self.bid, self.cid).exists())
        self.assertEqual(self.store.get(self.bid)['status'], 'completed')
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'pending')
        with self.database.connection() as connection:
            connection.execute('DROP TRIGGER reject_cleanup_ack')
        self.store.cleanup_pending()
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'completed')

    def test_upgrade_schedules_existing_completed_inputs_without_reanalysis(self):
        self.publish_processing_error()
        report = self.store.report(self.bid)
        with self.database.connection() as connection:
            connection.execute('DROP TABLE input_cleanup')
        remaining = self.store.path(self.bid, 'legacy.zip')
        remaining.parent.mkdir(parents=True)
        remaining.write_bytes(b'legacy managed archive')
        self.database.initialize()
        self.assertEqual(self.store.get(self.bid)['cleanup']['status'], 'pending')
        self.store.cleanup_pending()
        self.assertFalse(remaining.exists())
        self.assertEqual(self.store.report(self.bid), report)