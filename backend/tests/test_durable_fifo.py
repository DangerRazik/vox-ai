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