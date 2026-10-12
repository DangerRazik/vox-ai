"""Restoration through the existing API with real SQLite, files and ffprobe."""
import io
import json
import sqlite3
import tempfile
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.batches import BatchStore
from backend.config import BackendSettings
from backend.database import Database
from backend.streams import StreamStore
from tests.test_stream_api import ADMIN, stream_config


def audio_bytes(frequency=1):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(bytes([frequency, 0]) * 8000)
    return output.getvalue()


class BatchRestorationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='vox-restoration-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        probe = BackendSettings(admin_api_key='test-admin-key-not-for-production').ffprobe_path
        self.settings = BackendSettings(database_path=self.root / 'db.sqlite3',
                                        materials_root=self.root / 'materials', inputs_root=self.root / 'inputs',
                                        ffprobe_path=probe, admin_api_key='test-admin-key-not-for-production')
        self.client = self.enterContext(TestClient(create_app(self.settings)))
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
        self.owner = {'Authorization': f"Bearer {customer['api_key']}"}
        self.customer_id = customer['customer_id']
        self.sid = self.new_stream()
        self.body = {'stream_id': self.sid, 'upload_id': str(uuid4())}
        self.bid = self.client.post('/v1/batches', headers=self.owner, json=self.body).json()['batch_id']
        self.contents = [audio_bytes(1), audio_bytes(2)]
        self.calls = [self.upload(content).json()['call_id'] for content in self.contents]
        self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).raise_for_status()
        self.database = Database(self.settings.database_path)
        self.store = BatchStore(self.database, StreamStore(self.database, self.settings.materials_root),
                                self.settings.inputs_root, probe)

    def new_stream(self):
        return self.client.post(f'/v1/admin/customers/{self.customer_id}/streams', headers=ADMIN,
                                data={'config': json.dumps(stream_config(text_correction_enabled=False,
                                                                        unwanted_expressions_enabled=False))},
                                files={'knowledge_base': ('kb.txt', b'Answers')}).json()['stream_id']

    def upload(self, content, **kwargs):
        return self.client.post(f'/v1/batches/{self.bid}/files', headers=self.owner,
                                files={'file': ('renamed.wav', content, 'audio/wav')}, **kwargs)

    def state(self):
        return self.client.get(f'/v1/batches/{self.bid}', headers=self.owner).json()

    def interrupt(self):
        self.store.start(self.bid)
        self.assertEqual(self.store.claim_next(), self.bid)
        with self.store.processing_lock:
            self.store.recover_interrupted()
        self.assertEqual(self.state()['status'], 'batch_failed')

    def test_requires_all_original_files_despite_preserved_inputs_and_keeps_progress(self):
        self.interrupt()
        response = self.client.post('/v1/batches', headers=self.owner, json=self.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['batch_id'], self.bid)
        self.assertEqual(self.state()['status'], 'restoring')
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).status_code, 409)
        self.assertEqual(self.client.post(f'/v1/admin/batches/{self.bid}/start', headers=ADMIN).status_code, 409)
        first = self.upload(self.contents[0])
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['call_id'], self.calls[0])
        self.client.post('/v1/batches', headers=self.owner, json=self.body).raise_for_status()
        with TestClient(create_app(self.settings)) as restarted:
            self.assertEqual(restarted.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).status_code, 409)
        self.assertEqual(self.upload(self.contents[0]).status_code, 200)
        self.assertEqual(self.upload(audio_bytes(3)).status_code, 409)
        self.assertEqual(self.upload(self.contents[0], data={'external_employee_id': 'changed'}).status_code, 409)
        different_stream = {**self.body, 'stream_id': self.new_stream()}
        self.assertEqual(self.client.post('/v1/batches', headers=self.owner, json=different_stream).status_code, 409)
        self.assertEqual(self.upload(self.contents[1]).status_code, 200)
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).json()['status'], 'ready')
        self.assertEqual(self.state()['total_calls'], 2)
        self.assertEqual(self.state()['error'], 'worker_interrupted')
        self.assertEqual(self.store.calls(self.bid)[0]['original_name'], 'renamed.wav')
        self.assertEqual(self.state()['stream_id'], self.sid)
        self.assertEqual(list(self.store.list(status='queued')), [])

    def test_concurrent_recovery_repeats_and_new_attempt_goes_to_fifo_tail(self):
        self.interrupt()
        with ThreadPoolExecutor(max_workers=8) as pool:
            statuses = list(pool.map(lambda _: self.client.post('/v1/batches', headers=self.owner,
                                                                json=self.body).status_code, range(16)))
        self.assertEqual(statuses, [200] * 16)
        self.store.path(self.bid, self.calls[0]).unlink()
        with ThreadPoolExecutor(max_workers=8) as pool:
            uploads = list(pool.map(lambda _: self.upload(self.contents[0]).status_code, range(8)))
        self.assertEqual(uploads, [200] * 8)
        self.assertEqual(self.store.path(self.bid, self.calls[0]).read_bytes(), self.contents[0])
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).status_code, 409)
        waiting, _ = self.store.create(self.customer_id, self.sid, str(uuid4()))
        waiting_id = waiting['batch_id']
        self.store.add(waiting_id, self.customer_id, io.BytesIO(self.contents[0]), 'waiting.wav')
        self.store.complete(waiting_id, self.customer_id)
        self.store.start(waiting_id)
        self.upload(self.contents[1]).raise_for_status()
        self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).raise_for_status()
        self.store.start(self.bid)
        self.assertIsNone(self.state()['error'])
        self.assertEqual(self.store.claim_next(), waiting_id)
        with self.store.processing_lock:
            self.store.recover_interrupted()
        self.assertEqual(self.store.claim_next(), self.bid)
        # A second failed attempt requires every original file again.
        with self.store.processing_lock:
            self.store.recover_interrupted()
        self.client.post('/v1/batches', headers=self.owner, json=self.body).raise_for_status()
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).status_code, 409)

    def test_failed_receipt_commit_does_not_count_file_or_delete_preserved_input(self):
        self.interrupt()
        self.client.post('/v1/batches', headers=self.owner, json=self.body).raise_for_status()
        with self.database.connection() as connection:
            connection.execute("CREATE TRIGGER reject_receipt BEFORE INSERT ON restoration_receipts "
                               "BEGIN SELECT RAISE(ABORT, 'injected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.upload(self.contents[0])
        self.assertEqual(self.store.path(self.bid, self.calls[0]).read_bytes(), self.contents[0])
        with self.database.connection() as connection:
            connection.execute('DROP TRIGGER reject_receipt')
        self.upload(self.contents[1]).raise_for_status()
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).status_code, 409)
        self.upload(self.contents[0]).raise_for_status()
        self.assertEqual(self.client.post(f'/v1/batches/{self.bid}/complete', headers=self.owner).json()['status'], 'ready')