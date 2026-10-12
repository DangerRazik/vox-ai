"""Opt-in real HTTP/audio acceptance; no worker or model requests."""
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import httpx


@unittest.skipUnless(os.environ.get('RUN_LIVE_UPLOAD_TEST') == '1',
                     'Opt-in: real HTTP server, audio fixture and ffprobe')
class LiveUploadTests(unittest.TestCase):
    def test_real_rest_upload(self):
        from backend.config import BackendSettings
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        audio = Path(os.environ.get('VOX_LIVE_AUDIO', str(project / 'call_002.mp3')))
        key = 'live-upload-admin-' + str(uuid4())
        probe = BackendSettings(admin_api_key=key).ffprobe_path
        self.assertIsNotNone(shutil.which(probe), 'Real ffprobe is required')
        self.assertTrue(audio.is_file(), 'Real audio fixture missing')
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live upload acceptance', text_correction_enabled=False,
                      unwanted_expressions_enabled=False)
        with tempfile.TemporaryDirectory(prefix='vox-live-upload-') as directory:
            root = Path(directory)
            with socket.socket() as port_socket:
                port_socket.bind(('127.0.0.1', 0))
                port = port_socket.getsockname()[1]
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'api.sqlite3'),
                   'VOX_MATERIALS_ROOT': str(root / 'materials'),
                   'VOX_INPUTS_ROOT': str(root / 'inputs'),
                   'VOX_WORKER_LOCK': str(root / 'worker.lock'),
                   'VOX_FFPROBE_PATH': probe, 'VOX_ADMIN_API_KEY': key}
            with (root / 'process.log').open('w', encoding='utf-8') as log:
                process = subprocess.Popen(
                    [sys.executable, '-m', 'uvicorn', 'backend.api:create_app', '--factory',
                     '--host', '127.0.0.1', '--port', str(port)], cwd=project,
                    env=env, stdout=log, stderr=log)
                try:
                    with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=90,
                                      trust_env=False) as client:
                        admin = {'Authorization': f'Bearer {key}'}
                        deadline = time.monotonic() + 30
                        while True:
                            self.assertIsNone(process.poll(), 'API exited during startup')
                            try:
                                if client.get('/v1/streams', headers=admin).status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            self.assertLess(time.monotonic(), deadline, 'API startup timeout')
                            time.sleep(0.2)

                        def request(method, path, expected=200, headers=None, **kwargs):
                            response = client.request(method, path, headers=headers or admin, **kwargs)
                            self.assertEqual(response.status_code, expected, response.text)
                            return response.json()

                        customer = request('POST', '/v1/admin/customers', 201,
                                           json={'name': 'Live upload acceptance'})
                        owner = {'Authorization': f"Bearer {customer['api_key']}"}
                        stream = request('POST',
                                         f"/v1/admin/customers/{customer['customer_id']}/streams", 201,
                                         data={'config': json.dumps(config)},
                                         files={'knowledge_base': ('kb.txt', b'Upload acceptance material')})
                        body = {'stream_id': stream['stream_id'], 'upload_id': str(uuid4())}
                        batch = request('POST', '/v1/batches', 201, owner, json=body)
                        bid = batch['batch_id']
                        path = f'/v1/batches/{bid}'
                        start = f'/v1/admin/batches/{bid}/start'
                        self.assertEqual(batch['upload_id'], body['upload_id'])
                        self.assertEqual(batch['stream_id'], body['stream_id'])
                        self.assertEqual(batch['status'], 'uploading')
                        self.assertEqual(batch['total_calls'], 0)
                        repeated = request('POST', '/v1/batches', headers=owner, json=body)
                        self.assertEqual(repeated['batch_id'], bid)
                        self.assertEqual(request('GET', path, headers=owner)['status'], 'uploading')
                        error = request('POST', path + '/complete', 409, owner)
                        self.assertEqual(error['error']['code'], 'empty_batch')
                        error = request('POST', start, 409)
                        self.assertEqual(error['error']['code'], 'batch_not_ready')

                        def upload(expected):
                            with audio.open('rb') as source:
                                return request('POST', path + '/files', expected, owner,
                                               files={'file': (audio.name, source, 'audio/mpeg')},
                                               data={'external_employee_id': 'upload-employee',
                                                     'called_at': '2026-10-07T10:00:00Z'})

                        call = upload(201)
                        self.assertFalse(call['duplicate'])
                        call_id = call['call_id']
                        managed = root / 'inputs' / bid / call_id
                        self.assertTrue(managed.is_file())
                        self.assertEqual(hashlib.sha256(managed.read_bytes()).hexdigest(),
                                         hashlib.sha256(audio.read_bytes()).hexdigest())
                        duplicate = upload(200)
                        self.assertTrue(duplicate['duplicate'])
                        self.assertEqual(duplicate['call_id'], call_id)
                        self.assertEqual(list(managed.parent.iterdir()), [managed])
                        status = request('GET', path, headers=owner)
                        self.assertEqual(status['status'], 'uploading')
                        self.assertEqual(status['total_calls'], 1)
                        calls = request('GET', path + '/calls', headers=owner)['items']
                        self.assertEqual(len(calls), 1)
                        self.assertEqual(calls[0]['call_id'], call_id)
                        self.assertEqual(calls[0]['original_name'], audio.name)
                        self.assertEqual(calls[0]['external_employee_id'], 'upload-employee')
                        self.assertEqual(calls[0]['called_at'], '2026-10-07T10:00:00Z')
                        self.assertGreater(calls[0]['duration_seconds'], 0)
                        error = request('POST', start, 409)
                        self.assertEqual(error['error']['code'], 'batch_not_ready')
                        self.assertEqual(request('GET', path, headers=owner)['status'], 'uploading')
                        completed = request('POST', path + '/complete', headers=owner)
                        self.assertEqual(completed['status'], 'ready')
                        self.assertEqual(completed['total_calls'], 1)
                        self.assertEqual(request('GET', path, headers=owner)['status'], 'ready')
                        self.assertEqual(request('POST', path + '/complete', headers=owner)['status'], 'ready')
                        error = upload(409)
                        self.assertEqual(error['error']['code'], 'upload_closed')
                        self.assertEqual(list(managed.parent.iterdir()), [managed])
                        self.assertEqual(request('GET', path, headers=owner)['total_calls'], 1)
                        with closing(sqlite3.connect(root / 'api.sqlite3')) as connection:
                            self.assertEqual(connection.execute(
                                'SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                finally:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=15)