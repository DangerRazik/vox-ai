import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings
from tests.test_stream_api import ADMIN, stream_config
from backend.batches import BatchStore
from backend.database import Database
from backend.streams import StreamInput, StreamStore


class BatchApiTests(unittest.TestCase):
    def test_broken_stream_preserves_input_without_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = Database(root / 'db.sqlite3')
            database.initialize()
            customer = database.create_customer('A')['customer_id']
            streams = StreamStore(database, root / 'materials')
            stream = streams.create(customer, StreamInput.model_validate(stream_config(
                text_correction_enabled=False, unwanted_expressions_enabled=False)),
                {'knowledge_base': b'Answers'})
            store = BatchStore(database, streams, root / 'inputs', 'ffprobe')
            batch, _ = store.create(customer, stream['stream_id'], str(uuid4()))
            batch_id, call_id = batch['batch_id'], str(uuid4())
            input_path = store.path(batch_id, call_id)
            input_path.parent.mkdir(parents=True)
            input_path.write_bytes(b'preserved input')
            with database.connection() as connection:
                connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                                   (call_id, batch_id, 'call.mp3', 'hash', None, None, 1))
            for material in (root / 'materials').rglob('*'):
                if material.is_file():
                    material.write_bytes(b'corrupted')
            store.complete(batch_id, customer)
            store.start(batch_id)
            self.assertFalse(store.process(batch_id))
            self.assertEqual(store.get(batch_id)['status'], 'batch_failed')
            self.assertEqual(input_path.read_bytes(), b'preserved input')
            with database.connection() as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
            with self.assertRaises(ValueError):
                store.report(batch_id, customer)

    def test_processing_error_publishes_no_data_and_cleans_managed_input(self):
        self.check_failed_call_publication(False)

    def test_failed_commit_rolls_back_outcomes_and_preserves_input(self):
        self.check_failed_call_publication(True)

    def test_failed_second_outcome_rolls_back_entire_publication(self):
        self.check_failed_call_publication('second_outcome')

    def check_failed_call_publication(self, reject_publication):
        # Existing managed files; inject an input I/O failure before model requests.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = Database(root / 'db.sqlite3')
            database.initialize()
            customer = database.create_customer('A')['customer_id']
            streams = StreamStore(database, root / 'materials')
            stream = streams.create(customer, StreamInput.model_validate(stream_config(
                text_correction_enabled=False, unwanted_expressions_enabled=False)),
                {'knowledge_base': b'Answers'})
            store = BatchStore(database, streams, root / 'inputs', 'ffprobe')
            batch, _ = store.create(customer, stream['stream_id'], str(uuid4()))
            batch_id, call_id = batch['batch_id'], str(uuid4())
            input_path = store.path(batch_id, call_id)
            input_path.parent.mkdir(parents=True)
            input_path.write_bytes(b'preserved input')
            input_paths = [input_path]
            with database.connection() as connection:
                connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                                   (call_id, batch_id, 'missing.mp3', 'hash', None, None, 1))
                if reject_publication:
                    connection.executescript("""
                        CREATE TRIGGER reject_publication BEFORE UPDATE ON batches
                        WHEN NEW.status = 'completed' BEGIN
                            SELECT RAISE(ABORT, 'test publication failure');
                        END;
                    """)
                if reject_publication == 'second_outcome':
                    connection.execute('DROP TRIGGER reject_publication')
                    second_id = str(uuid4())
                    second_path = store.path(batch_id, second_id)
                    second_path.write_bytes(b'preserved second input')
                    input_paths.append(second_path)
                    connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                                       (second_id, batch_id, 'missing2.mp3', 'hash2', None, None, 1))
                    connection.executescript("""
                        CREATE TRIGGER reject_second_outcome BEFORE INSERT ON call_results
                        WHEN (SELECT COUNT(*) FROM call_results) = 1 BEGIN
                            SELECT RAISE(ABORT, 'test second outcome failure');
                        END;
                    """)
            store.complete(batch_id, customer)
            with TestClient(create_app(BackendSettings(
                database_path=database.path, materials_root=root / 'materials', inputs_root=root / 'inputs',
                admin_api_key='test-admin-key-not-for-production'))) as client:
                response = client.post(f'/v1/admin/batches/{batch_id}/start', headers=ADMIN)
                self.assertEqual(response.status_code, 202, response.text)
                self.assertEqual(response.json()['status'], 'queued')
                self.assertEqual(client.post(f'/v1/admin/batches/{batch_id}/start', headers=ADMIN).status_code, 200)
            with patch('transcriber.open', side_effect=OSError('test input read failure')):
                self.assertEqual(store.process(batch_id), not reject_publication)
            if reject_publication:
                for path in input_paths:
                    self.assertTrue(path.is_file())
                    self.assertTrue(path.read_bytes().startswith(b'preserved'))
                self.assertEqual(store.get(batch_id)['status'], 'batch_failed')
                with database.connection() as connection:
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                    batch_row = connection.execute('SELECT summary, processing_finished_at FROM batches WHERE id = ?',
                                                   (batch_id,)).fetchone()
                    self.assertIsNone(batch_row['summary'])
                    self.assertIsNone(batch_row['processing_finished_at'])
                with self.assertRaises(ValueError):
                    store.call_report(call_id, customer)
                return
            summary = store.report(batch_id, customer)
            self.assertEqual(summary['processing_errors'], 1)
            self.assertEqual(summary['successful_calls'], 0)
            self.assertIsNone(summary['average_total'])
            self.assertIsNone(summary['critical_violation_rate'])
            self.assertTrue(all(value is None for value in summary['criterion_averages'].values()))
            report = store.call_report(call_id, customer)
            self.assertEqual(report['status'], 'processing_error')
            self.assertIsNone(report['result'])
            self.assertFalse(store.path(batch_id, call_id).exists())
            self.assertFalse(store.process(batch_id))

    def test_empty_batch_is_private_and_cannot_start_or_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = BackendSettings(database_path=root / 'db.sqlite3',
                                       materials_root=root / 'materials', inputs_root=root / 'inputs',
                                       admin_api_key='test-admin-key-not-for-production')
            with TestClient(create_app(settings)) as client:
                customer = client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
                other = client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'B'}).json()
                headers = {'Authorization': f"Bearer {customer['api_key']}"}
                other_headers = {'Authorization': f"Bearer {other['api_key']}"}
                stream = client.post(f"/v1/admin/customers/{customer['customer_id']}/streams", headers=ADMIN,
                                     data={'config': json.dumps(stream_config(text_correction_enabled=False,
                                                                             unwanted_expressions_enabled=False))},
                                     files={'knowledge_base': ('kb.txt', b'Answers')}).json()
                body = {'stream_id': stream['stream_id'], 'upload_id': str(uuid4())}
                response = client.post('/v1/batches', headers=headers, json=body)
                self.assertEqual(response.status_code, 201, response.text)
                batch_id = response.json()['batch_id']
                self.assertEqual(response.json()['status'], 'uploading')
                unavailable_settings = settings.model_copy(update={'ffprobe_path': str(root / 'missing-ffprobe.exe')})
                with TestClient(create_app(unavailable_settings)) as unavailable:
                    upload = unavailable.post(f'/v1/batches/{batch_id}/files', headers=headers,
                                              files={'file': ('call.mp3', b'audio')})
                    self.assertEqual(upload.status_code, 503, upload.text)
                    self.assertEqual(upload.json()['error']['code'], 'audio_probe_unavailable')
                self.assertEqual(list((root / 'inputs' / batch_id).iterdir()), [])
                repeated = client.post('/v1/batches', headers=headers, json=body)
                self.assertEqual(repeated.status_code, 200)
                self.assertEqual(repeated.json()['batch_id'], batch_id)
                self.assertEqual(client.get(f'/v1/batches/{batch_id}', headers=other_headers).status_code, 404)
                self.assertEqual(client.get('/v1/batches', headers=other_headers).json()['items'], [])
                self.assertEqual(client.post(f'/v1/batches/{batch_id}/complete', headers=headers).status_code, 409)
                self.assertEqual(client.post(f'/v1/admin/batches/{batch_id}/start', headers=headers).status_code, 403)
                self.assertEqual(client.post(f'/v1/admin/batches/{batch_id}/start', headers=ADMIN).status_code, 409)
                self.assertEqual(client.get(f'/v1/batches/{batch_id}/report', headers=headers).status_code, 409)
                self.assertEqual(list((root / 'inputs').rglob('*.*')), [])