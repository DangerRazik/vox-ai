"""Comparison at the public REST boundary with isolated persisted history."""
import json
import io
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


class ComparisonApiTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='vox-comparison-')
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

    def new_batch(self, sid=None, owner=None):
        response = self.client.post('/v1/batches', headers=owner or self.owner,
            json={'stream_id': sid or self.sid, 'upload_id': str(uuid4())})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['batch_id']

    def compare(self, ids, sid=None, headers=None):
        return self.client.post(f'/v1/streams/{sid or self.sid}/comparisons',
            headers=self.owner if headers is None else headers, json={'batch_ids': ids})

    def test_unpublished_batches_cannot_be_compared(self):
        ids = [self.new_batch(), self.new_batch()]
        response = self.compare(ids)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['error']['code'], 'report_not_available')

    def test_selection_requires_two_distinct_uuid_identifiers(self):
        bid = self.new_batch()
        for ids in ([], [bid], [bid, bid], [bid, 'not-a-uuid']):
            with self.subTest(ids=ids):
                response = self.compare(ids)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()['error']['code'], 'invalid_request')

    def test_inaccessible_batches_do_not_disclose_their_state(self):
        own = self.new_batch()
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'B'}).json()
        other_owner = {'Authorization': 'Bearer ' + customer['api_key']}
        other_sid = self.new_stream(customer['customer_id'])
        foreign = self.new_batch(other_sid, other_owner)
        for ids in ([own, foreign], [foreign, own], [own, str(uuid4())]):
            self.assertEqual(self.compare(ids).status_code, 404)
        self.assertEqual(self.compare([own, foreign], sid=other_sid).status_code, 404)
        self.assertEqual(self.compare([own, foreign], headers={}).status_code, 401)
        self.assertEqual(self.compare([own, foreign], headers={'Authorization': 'Bearer invalid'}).status_code, 401)

    def test_batches_of_other_stream_cannot_be_mixed_even_for_admin(self):
        own = self.new_batch()
        other = self.new_batch(self.new_stream(self.customer_id))
        for headers in (self.owner, ADMIN):
            response = self.compare([other, own], headers=headers)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['error']['code'], 'comparison_stream_mismatch')

    def test_published_no_data_is_ordered_deduplicated_and_survives_restart(self):
        ids = [self.new_batch(), self.new_batch()]
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as wav:
            wav.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\0\0' * 800)
        for bid in ids:
            response = self.client.post(f'/v1/batches/{bid}/files', headers=self.owner,
                files={'file': ('call.wav', audio.getvalue(), 'audio/wav')})
            self.assertEqual(response.status_code, 201, response.text)
            cid = response.json()['call_id']
            rejected = self.client.post(f'/v1/batches/{bid}/files', headers=self.owner,
                files={'file': ('broken.wav', b'not audio')})
            self.assertEqual(rejected.status_code, 422, rejected.text)
            # Real local input failure before Whisper; no invented model response.
            (self.settings.inputs_root / bid / cid).unlink()
            self.assertEqual(self.client.post(f'/v1/batches/{bid}/complete', headers=self.owner).status_code, 200)
            self.assertEqual(self.client.post(f'/v1/admin/batches/{bid}/start', headers=ADMIN).status_code, 202)
        env = {**os.environ, 'VOX_DATABASE_PATH': str(self.settings.database_path),
            'VOX_MATERIALS_ROOT': str(self.settings.materials_root), 'VOX_INPUTS_ROOT': str(self.settings.inputs_root),
            'VOX_WORKER_LOCK': str(self.settings.worker_lock), 'VOX_FFPROBE_PATH': self.settings.ffprobe_path,
            'VOX_ADMIN_API_KEY': self.settings.admin_api_key.get_secret_value()}
        worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
            cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 15
            def published_and_cleaned(bid):
                batch = self.client.get(f'/v1/batches/{bid}', headers=self.owner).json()
                return batch['status'] == 'completed' and batch['cleanup']['status'] == 'completed'

            while not all(published_and_cleaned(bid) for bid in ids):
                self.assertIsNone(worker.poll())
                self.assertLess(time.monotonic(), deadline, 'Publication timeout')
                time.sleep(0.05)
        finally:
            worker.terminate()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)
        reports = [self.client.get(f'/v1/batches/{bid}/report', headers=self.owner).json() for bid in reversed(ids)]
        # External HTTP guard fails on any attempted model request; returns no fake data.
        with patch('httpx.Client.send', side_effect=AssertionError('Comparison must not call external services')):
            response = self.compare([ids[1], ids[0], ids[1]])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {'stream_id': self.sid, 'items': reports})
            for report in response.json()['items']:
                self.assertEqual((report['total_calls'], report['successful_calls'], report['processing_errors'],
                                  report['upload_errors']), (1, 0, 1, 1))
                self.assertEqual(report['max_total'], 11)
                self.assertIsNone(report['average_total'])
                self.assertEqual(len(report['criterion_averages']), 11)
                self.assertTrue(all(value is None for value in report['criterion_averages'].values()))
                self.assertEqual(report['critical_violation_count'], 0)
                self.assertIsNone(report['critical_violation_rate'])
            with TestClient(create_app(self.settings)) as restarted:
                response = restarted.post(f'/v1/streams/{self.sid}/comparisons', headers=self.owner,
                    json={'batch_ids': [ids[1], ids[0], ids[1]]})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['items'], reports)
            for report in reports:
                self.assertEqual(self.client.get(f"/v1/batches/{report['batch_id']}/report",
                    headers=self.owner).json(), report)
        self.assertEqual(self.client.delete(f'/v1/admin/streams/{self.sid}', headers=ADMIN).status_code, 204)
        self.assertEqual(self.compare(ids).status_code, 404)
