"""Public REST behavior with real SQLite; ffprobe is the controlled process boundary.

Model acceptance is separate and uses actual Whisper/LLM, without pipeline mocks.
"""
import json
import os
import subprocess
import tempfile
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings
from tests.test_stream_api import ADMIN, stream_config


class MultiFileApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.settings = BackendSettings(database_path=self.root / 'db.sqlite3',
            materials_root=self.root / 'materials', inputs_root=self.root / 'inputs',
            admin_api_key='test-admin-key-not-for-production')
        self.client = self.enterContext(TestClient(create_app(self.settings)))
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
        self.owner = {'Authorization': f"Bearer {customer['api_key']}"}
        self.customer_id = customer['customer_id']
        self.stream = self.create_stream()
        self.body = {'stream_id': self.stream['stream_id'], 'upload_id': str(uuid4())}
        batch = self.client.post('/v1/batches', headers=self.owner, json=self.body)
        self.assertEqual(batch.status_code, 201, batch.text)
        self.path = '/v1/batches/' + batch.json()['batch_id']

    def create_stream(self):
        response = self.client.post(f'/v1/admin/customers/{self.customer_id}/streams',
            headers=ADMIN,
            data={'config': json.dumps(stream_config(text_correction_enabled=False,
                                                    unwanted_expressions_enabled=False))},
            files={'knowledge_base': ('kb.txt', b'Answers')})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def upload(self, name, content, valid=True, **data):
        probe = subprocess.CompletedProcess([], 0 if valid else 1,
            stdout=b'{"streams":[{"codec_type":"audio"}],"format":{"duration":"1"}}')
        with patch('subprocess.run', return_value=probe):
            return self.client.post(self.path + '/files', headers=self.owner,
                files={'file': (name, content)}, data=data)

    def test_rejected_file_is_visible_once_and_does_not_count_as_a_call(self):
        rejected = self.upload('broken.wav', b'broken audio', valid=False)
        self.assertEqual(rejected.status_code, 422)
        files = self.client.get(self.path + '/files', headers=self.owner)
        self.assertEqual(files.status_code, 200, files.text)
        self.assertEqual(len(files.json()['items']), 1)
        self.assertEqual(files.json()['items'][0]['status'], 'rejected')
        self.assertEqual(files.json()['items'][0]['error']['code'], 'invalid_audio')
        self.assertEqual(self.upload('renamed.bad', b'broken audio', valid=False).status_code, 422)
        self.assertEqual(len(self.client.get(self.path + '/files', headers=self.owner).json()['items']), 1)
        batch = self.client.get(self.path, headers=self.owner).json()
        self.assertEqual(batch['total_calls'], 0)
        self.assertEqual(batch['upload_errors'], 1)
        self.assertEqual(self.client.post(self.path + '/complete', headers=self.owner).status_code, 409)

    def test_mixed_intake_and_renamed_duplicate_keep_original_metadata(self):
        self.assertEqual(self.upload('broken.wav', b'broken', valid=False).status_code, 422)
        first = self.upload('first.unusual', b'first audio', external_employee_id='employee-17',
                            called_at='2026-10-07T10:00:00+03:00')
        self.assertEqual(first.status_code, 201, first.text)
        second = self.upload('second', b'second audio')
        self.assertEqual(second.status_code, 201, second.text)
        duplicate = self.upload('renamed.xyz', b'first audio')
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        self.assertEqual(duplicate.json()['call_id'], first.json()['call_id'])
        self.assertTrue(duplicate.json()['duplicate'])
        self.assertEqual(self.upload('renamed.xyz', b'first audio').status_code, 200)
        calls = self.client.get(self.path + '/calls', headers=self.owner).json()['items']
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]['external_employee_id'], 'employee-17')
        self.assertEqual(calls[0]['called_at'], '2026-10-07T10:00:00+03:00')
        self.assertIsNone(calls[1]['external_employee_id'])
        self.assertIsNone(calls[1]['called_at'])
        files = self.client.get(self.path + '/files', headers=self.owner).json()['items']
        duplicates = [item for item in files if item['status'] == 'duplicate']
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0]['call_id'], first.json()['call_id'])
        self.assertEqual(duplicates[0]['original_name'], 'renamed.xyz')
        self.assertEqual(duplicates[0]['duplicate_of'], 'first.unusual')
        completed = self.client.post(self.path + '/complete', headers=self.owner)
        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(completed.json()['total_calls'], 2)
        self.assertEqual(completed.json()['upload_errors'], 1)

    def test_closed_batch_and_independent_uploads_preserve_their_compositions(self):
        original = self.upload('one.wav', b'one')
        self.assertEqual(original.status_code, 201)
        self.assertEqual(self.upload('one.wav', b'one', external_employee_id='changed').status_code, 409)
        self.assertEqual(self.client.post(self.path + '/complete', headers=self.owner).status_code, 200)
        for content in (b'one', b'new', b'invalid'):
            self.assertEqual(self.upload('later.wav', content, valid=False).status_code, 409)
        repeated = self.client.post('/v1/batches', headers=self.owner, json=self.body)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual('/v1/batches/' + repeated.json()['batch_id'], self.path)
        self.assertEqual(repeated.json()['total_calls'], 1)
        self.assertEqual(repeated.json()['upload_errors'], 0)
        changed = {**self.body, 'stream_id': self.create_stream()['stream_id']}
        self.assertEqual(self.client.post('/v1/batches', headers=self.owner, json=changed).status_code, 409)
        new_body = {**self.body, 'upload_id': str(uuid4())}
        separate = self.client.post('/v1/batches', headers=self.owner, json=new_body)
        self.assertEqual(separate.status_code, 201)
        previous_path = self.path
        self.path = '/v1/batches/' + separate.json()['batch_id']
        independent = self.upload('same.wav', b'one')
        self.assertEqual(independent.status_code, 201)
        self.assertNotEqual(independent.json()['call_id'], original.json()['call_id'])
        self.assertEqual(self.client.get(previous_path, headers=self.owner).json()['total_calls'], 1)

    def test_upload_errors_and_duplicate_links_are_private_and_durable(self):
        self.assertEqual(self.upload('bad', b'bad', valid=False).status_code, 422)
        self.assertEqual(self.upload('one', b'one').status_code, 201)
        self.assertEqual(self.upload('copy', b'one').status_code, 200)
        other = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'B'}).json()
        stranger = {'Authorization': f"Bearer {other['api_key']}"}
        self.assertEqual(self.client.get(self.path + '/files', headers=stranger).status_code, 404)
        self.assertEqual(self.client.post(self.path + '/files', headers=stranger,
            files={'file': ('bad', b'bad')}).status_code, 404)
        expected = self.client.get(self.path + '/files', headers=self.owner).json()
        with TestClient(create_app(self.settings)) as restarted:
            response = restarted.get(self.path + '/files', headers=self.owner)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), expected)
            self.assertEqual(restarted.get(self.path, headers=self.owner).json()['upload_errors'], 1)

    def test_probe_service_failure_is_not_a_rejected_file(self):
        with patch('subprocess.run', side_effect=FileNotFoundError('private executable path')):
            response = self.client.post(self.path + '/files', headers=self.owner,
                files={'file': ('one.wav', b'one')})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private executable path', response.text)
        self.assertEqual(self.client.get(self.path + '/files', headers=self.owner).json()['items'], [])
        self.assertEqual(self.upload('retry.wav', b'one').status_code, 201)
        self.assertEqual(self.client.post(self.path + '/complete', headers=self.owner).status_code, 200)

    def test_complete_waits_for_an_active_file_request(self):
        self.assertEqual(self.upload('one.wav', b'one').status_code, 201)
        entered, release = Event(), Event()

        def probe(*args, **kwargs):
            entered.set()
            if not release.wait(timeout=10):
                raise RuntimeError('Test did not release external probe')
            return subprocess.CompletedProcess([], 0,
                stdout=b'{"streams":[{"codec_type":"audio"}],"format":{"duration":"1"}}')

        with ThreadPoolExecutor(max_workers=1) as pool, patch('subprocess.run', side_effect=probe):
            pending = pool.submit(self.client.post, self.path + '/files', headers=self.owner,
                                  files={'file': ('two.wav', b'two')})
            try:
                self.assertTrue(entered.wait(timeout=5))
                complete = self.client.post(self.path + '/complete', headers=self.owner)
                self.assertEqual(complete.status_code, 409, complete.text)
                self.assertEqual(complete.json()['error']['code'], 'upload_in_progress')
                self.assertEqual(self.client.get(self.path, headers=self.owner).json()['status'], 'uploading')
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=5).status_code, 201)
        completed = self.client.post(self.path + '/complete', headers=self.owner)
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()['total_calls'], 2)

    def test_invalid_probe_metadata_is_explained_and_counted_once(self):
        probe = subprocess.CompletedProcess([], 0, stdout=b'not JSON', stderr=b'private probe output')
        with patch('subprocess.run', return_value=probe):
            response = self.client.post(self.path + '/files', headers=self.owner,
                files={'file': ('invalid.wav', b'invalid metadata')})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['error']['code'], 'invalid_audio')
        self.assertNotIn('private probe output', response.text)
        self.assertEqual(self.client.get(self.path, headers=self.owner).json()['upload_errors'], 1)

    def test_no_audio_stream_has_an_explicit_reason(self):
        probe = subprocess.CompletedProcess([], 0, stdout=b'{"streams":[{"codec_type":"video"}]}')
        with patch('subprocess.run', return_value=probe):
            response = self.client.post(self.path + '/files', headers=self.owner,
                files={'file': ('video.mp4', b'video')})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['error']['code'], 'no_audio_stream')
        self.assertEqual(self.client.get(self.path, headers=self.owner).json()['upload_errors'], 1)

    def test_worker_publishes_all_failed_calls_with_upload_errors_and_no_scores(self):
        self.assertEqual(self.upload('bad', b'bad', valid=False).status_code, 422)
        for filename, content in [('one.wav', b'one'), ('two.wav', b'two')]:
            response = self.upload(filename, content)
            self.assertEqual(response.status_code, 201)
            # External filesystem failure: both managed inputs disappear before reading.
            (self.root / 'inputs' / self.path.rsplit('/', 1)[1] / response.json()['call_id']).unlink()
        self.assertEqual(self.client.post(self.path + '/complete', headers=self.owner).status_code, 200)
        self.assertEqual(self.client.post(self.path.replace('/v1/', '/v1/admin/') + '/start', headers=ADMIN).status_code, 202)
        self.assertEqual(self.client.get(self.path + '/report', headers=self.owner).status_code, 409)
        env = {**os.environ, 'VOX_ADMIN_API_KEY': 'test-admin-key-not-for-production',
            'VOX_DATABASE_PATH': str(self.settings.database_path),
            'VOX_MATERIALS_ROOT': str(self.settings.materials_root),
            'VOX_INPUTS_ROOT': str(self.settings.inputs_root),
            'VOX_WORKER_LOCK': str(self.root / 'worker.lock'),
            'WHISPER_API_KEY': 'test-only', 'WHISPER_BASE_URL': 'http://127.0.0.1:1',
            'GPL_BASE_URL': 'http://127.0.0.1:1', 'GPL_MODEL': 'test-only'}
        worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
            cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 15
            while self.client.get(self.path, headers=self.owner).json()['status'] != 'completed':
                self.assertIsNone(worker.poll(), 'Worker exited')
                self.assertLess(time.monotonic(), deadline, 'Batch did not complete')
                time.sleep(0.05)
            summary = self.client.get(self.path + '/report', headers=self.owner).json()
            self.assertEqual(summary['total_calls'], 2)
            self.assertEqual(summary['successful_calls'], 0)
            self.assertEqual(summary['processing_errors'], 2)
            self.assertEqual(summary['upload_errors'], 1)
            self.assertEqual(summary['critical_violation_count'], 0)
            self.assertIsNone(summary['average_total'])
            self.assertIsNone(summary['critical_violation_rate'])
            self.assertTrue(all(value is None for value in summary['criterion_averages'].values()))
            calls = self.client.get(self.path + '/calls', headers=self.owner).json()['items']
            for call in calls:
                result = self.client.get('/v1/calls/' + call['call_id'] + '/report', headers=self.owner).json()
                self.assertEqual(result['status'], 'processing_error')
                self.assertIsNone(result['result'])
        finally:
            worker.terminate()
            worker.wait(timeout=10)
