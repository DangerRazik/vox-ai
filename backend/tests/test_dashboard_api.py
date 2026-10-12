"""Stream dashboard history through REST, with real isolated SQLite and files."""
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings
from tests.test_stream_api import ADMIN, stream_config


class DashboardApiTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='vox-dashboard-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.settings = BackendSettings(database_path=self.root / 'db.sqlite3',
            materials_root=self.root / 'materials', inputs_root=self.root / 'inputs',
            worker_lock=self.root / 'worker.lock', admin_api_key='test-admin-key-not-for-production')
        self.client = self.enterContext(TestClient(create_app(self.settings)))
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
        self.customer_id = customer['customer_id']
        self.owner = {'Authorization': 'Bearer ' + customer['api_key']}
        self.sid = self.new_stream(self.customer_id)

    def new_stream(self, customer_id):
        response = self.client.post(f'/v1/admin/customers/{customer_id}/streams', headers=ADMIN,
            data={'config': json.dumps(stream_config(text_correction_enabled=False,
                unwanted_expressions_enabled=False))}, files={'knowledge_base': ('kb.txt', b'Rules')})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['stream_id']

    def new_batch(self, sid=None):
        response = self.client.post('/v1/batches', headers=self.owner,
            json={'stream_id': sid or self.sid, 'upload_id': str(uuid4())})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_empty_history_omits_unpublished_batches(self):
        path = f'/v1/streams/{self.sid}/dashboard'
        expected = {'stream_id': self.sid, 'items': []}
        response = self.client.get(path, headers=self.owner)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), expected)
        self.new_batch()
        self.assertEqual(self.client.get(path, headers=self.owner).json(), expected)

    def test_history_enforces_customer_access_and_disappears_with_stream(self):
        path = f'/v1/streams/{self.sid}/dashboard'
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'B'}).json()
        outsider = {'Authorization': 'Bearer ' + customer['api_key']}
        foreign_sid = self.new_stream(customer['customer_id'])
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get(path, headers={'Authorization': 'Bearer invalid'}).status_code, 401)
        self.assertEqual(self.client.get(path, headers=outsider).status_code, 404)
        self.assertEqual(self.client.get(f'/v1/streams/{foreign_sid}/dashboard', headers=self.owner).status_code, 404)
        self.assertEqual(self.client.get(f'/v1/streams/{uuid4()}/dashboard', headers=self.owner).status_code, 404)
        self.assertEqual(self.client.get('/v1/streams/invalid/dashboard', headers=self.owner).status_code, 422)
        self.assertEqual(self.client.get(f'/v1/streams/{foreign_sid}/dashboard', headers=ADMIN).json(),
                         {'stream_id': foreign_sid, 'items': []})
        self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 204)
        self.assertEqual(self.client.get(path, headers=self.owner).status_code, 404)
        self.assertEqual(self.client.get(path, headers=ADMIN).status_code, 404)
        self.assertEqual(self.client.get(f'/v1/streams/{foreign_sid}/dashboard', headers=outsider).status_code, 200)

    def test_history_reuses_published_reports_in_completion_order_and_preserves_no_data(self):
        first, second = self.new_batch(), self.new_batch()
        neighbor_sid = self.new_stream(self.customer_id)
        neighbor = self.new_batch(neighbor_sid)
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as wav:
            wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * 800)
        for batch in (first, second, neighbor):
            bid = batch['batch_id']
            response = self.client.post(f'/v1/batches/{bid}/files', headers=self.owner,
                files={'file': ('call.wav', audio.getvalue(), 'audio/wav')})
            self.assertEqual(response.status_code, 201, response.text)
            rejected = self.client.post(f'/v1/batches/{bid}/files', headers=self.owner,
                files={'file': ('broken.wav', b'not audio')})
            self.assertEqual(rejected.status_code, 422)
            # Local filesystem failure happens before any model request.
            (self.settings.inputs_root / bid / response.json()['call_id']).unlink()
            self.assertEqual(self.client.post(f'/v1/batches/{bid}/complete', headers=self.owner).status_code, 200)
        unpublished = self.new_batch()
        for batch in (neighbor, second, first):
            self.assertEqual(self.client.post(f"/v1/admin/batches/{batch['batch_id']}/start", headers=ADMIN).status_code, 202)
        env = {**os.environ, 'VOX_DATABASE_PATH': str(self.settings.database_path),
            'VOX_MATERIALS_ROOT': str(self.settings.materials_root), 'VOX_INPUTS_ROOT': str(self.settings.inputs_root),
            'VOX_WORKER_LOCK': str(self.settings.worker_lock), 'VOX_FFPROBE_PATH': self.settings.ffprobe_path,
            'VOX_ADMIN_API_KEY': self.settings.admin_api_key.get_secret_value()}
        worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], cwd=Path(__file__).resolve().parents[1],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def stop_worker():
            worker.terminate()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)
        self.addCleanup(stop_worker)
        deadline = time.monotonic() + 15
        for batch in (neighbor, second, first):
            while True:
                value = self.client.get(f"/v1/batches/{batch['batch_id']}", headers=self.owner).json()
                if value['status'] == 'completed' and value['cleanup']['status'] == 'completed':
                    break
                self.assertIsNone(worker.poll())
                self.assertLess(time.monotonic(), deadline, 'Publication/cleanup timeout')
                time.sleep(0.05)
        ids = [second['batch_id'], first['batch_id']]
        reports = [self.client.get(f'/v1/batches/{bid}/report', headers=self.owner).json() for bid in ids]
        path = f'/v1/streams/{self.sid}/dashboard'
        with patch('httpx.Client.send', side_effect=AssertionError('History must not request models')):
            response = self.client.get(path, headers=self.owner)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {'stream_id': self.sid, 'items': reports})
            self.assertEqual(self.client.get(path, headers=ADMIN).json(), response.json())
            comparison = self.client.post(f'/v1/streams/{self.sid}/comparisons', headers=self.owner,
                json={'batch_ids': ids}).json()
            self.assertEqual(response.json(), comparison)
            for report in response.json()['items']:
                self.assertEqual((report['total_calls'], report['successful_calls'], report['processing_errors'],
                                  report['upload_errors']), (1, 0, 1, 1))
                self.assertIsNone(report['average_total'])
                self.assertEqual(report['max_total'], 11)
                self.assertEqual(len(report['criterion_averages']), 11)
                self.assertTrue(all(value is None for value in report['criterion_averages'].values()))
                self.assertEqual(report['critical_violation_count'], 0)
                self.assertIsNone(report['critical_violation_rate'])
            self.assertLessEqual(reports[0]['processing_finished_at'], reports[1]['processing_finished_at'])
            repeated = self.client.post('/v1/batches', headers=self.owner,
                json={'stream_id': self.sid, 'upload_id': first['upload_id']})
            self.assertEqual(repeated.status_code, 200)
            self.assertEqual(repeated.json()['batch_id'], first['batch_id'])
            self.assertEqual(self.client.post(f"/v1/admin/batches/{first['batch_id']}/start", headers=ADMIN).status_code, 200)
            self.assertEqual(self.client.get(path, headers=self.owner).json()['items'], reports)
            self.assertTrue(all(not (self.settings.inputs_root / bid).exists() for bid in ids))
            with TestClient(create_app(self.settings)) as restarted:
                self.assertEqual(restarted.get(path, headers=self.owner).json()['items'], reports)
            self.assertEqual(self.client.get(f"/v1/batches/{unpublished['batch_id']}", headers=self.owner).json()['status'],
                             'uploading')
