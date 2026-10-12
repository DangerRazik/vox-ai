"""Opt-in real-model restoration after SQLite publication failure and worker kill."""
import json
import os
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


@unittest.skipUnless(os.environ.get('RUN_LIVE_RESTORATION_TEST') == '1',
                     'Opt-in: real Whisper/LLM requests, potentially paid')
class LiveRestorationTests(unittest.TestCase):
    def test_restore_after_publication_failure_and_worker_interruption(self):
        from backend.config import BackendSettings
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        audio_paths = [project / 'call_002.mp3', project / 'call_003.mp3']
        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live restoration', text_correction_enabled=False, unwanted_expressions_enabled=False)
        with tempfile.TemporaryDirectory(prefix='vox-live-restoration-') as directory:
            root = Path(directory)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            key = 'live-restoration-admin-' + str(uuid4())
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'db.sqlite3'),
                   'VOX_MATERIALS_ROOT': str(root / 'materials'), 'VOX_INPUTS_ROOT': str(root / 'inputs'),
                   'VOX_WORKER_LOCK': str(root / 'worker.lock'), 'VOX_FFPROBE_PATH': probe,
                   'VOX_ADMIN_API_KEY': key}
            processes = []
            with (root / 'process.log').open('w', encoding='utf-8') as log:
                def launch(module):
                    command = [sys.executable, '-m', module]
                    if module == 'uvicorn':
                        command += ['backend.api:create_app', '--factory', '--host', '127.0.0.1', '--port', str(port)]
                    process = subprocess.Popen(command, cwd=project, env=env, stdout=log, stderr=log)
                    processes.append(process)
                    return process

                def stop(process):
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=15)

                try:
                    launch('uvicorn')
                    with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=60) as client:
                        admin = {'Authorization': f'Bearer {key}'}
                        deadline = time.monotonic() + 30
                        while True:
                            try:
                                if client.get('/v1/streams', headers=admin).status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            self.assertLess(time.monotonic(), deadline, 'API startup timeout')
                            time.sleep(0.1)

                        def request(method, path, headers=None, **kwargs):
                            response = client.request(method, path, headers=headers or admin, **kwargs)
                            self.assertLess(response.status_code, 300, f'{method} {path}: {response.status_code}')
                            return response.json()

                        customer = request('POST', '/v1/admin/customers', json={'name': 'Restoration'})
                        owner = {'Authorization': f"Bearer {customer['api_key']}"}
                        sid = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                                      data={'config': json.dumps(config)},
                                      files={'knowledge_base': ('kb.txt', 'Возврат билета: заявка организатору.'.encode())})['stream_id']
                        body = {'stream_id': sid, 'upload_id': str(uuid4())}
                        bid = request('POST', '/v1/batches', owner, json=body)['batch_id']

                        def upload(path):
                            with path.open('rb') as source:
                                return request('POST', f'/v1/batches/{bid}/files', owner,
                                               files={'file': (path.name, source, 'audio/mpeg')})

                        calls = [upload(path)['call_id'] for path in audio_paths]
                        request('POST', f'/v1/batches/{bid}/complete', owner)

                        def state():
                            return request('GET', f'/v1/batches/{bid}', owner)['status']

                        def wait_state(wanted):
                            deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                            while time.monotonic() < deadline:
                                actual = state()
                                if actual == wanted:
                                    return
                                if wanted != 'batch_failed':
                                    self.assertNotEqual(actual, 'batch_failed', 'Unexpected processing failure')
                                self.assertIsNone(worker.poll(), 'Worker exited')
                                time.sleep(0.02)
                            self.fail(f'Timeout waiting for {wanted}')

                        # Reject publication after both calls have made genuine model requests.
                        # A second-outcome INSERT fails, proving the first INSERT rolls back too.
                        with closing(sqlite3.connect(root / 'db.sqlite3')) as db:
                            db.execute("CREATE TRIGGER reject_second_result BEFORE INSERT ON call_results "
                                       "WHEN (SELECT COUNT(*) FROM call_results) = 1 "
                                       "BEGIN SELECT RAISE(ABORT, 'controlled_local_failure'); END")
                            db.commit()
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        worker = launch('backend.worker')
                        wait_state('batch_failed')
                        self.assertEqual(request('GET', f'/v1/batches/{bid}')['error'], 'batch_processing_failed')
                        with closing(sqlite3.connect(root / 'db.sqlite3')) as db:
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                            self.assertIsNone(db.execute('SELECT summary FROM batches WHERE id=?', (bid,)).fetchone()[0])
                            db.execute('DROP TRIGGER reject_second_result')
                            db.commit()
                        for cid in calls:
                            self.assertTrue((root / 'inputs' / bid / cid).is_file())
                        self.assertEqual(client.get(f'/v1/batches/{bid}/report', headers=owner).status_code, 409)

                        def restore():
                            self.assertEqual(request('POST', '/v1/batches', owner, json=body)['batch_id'], bid)
                            self.assertEqual(state(), 'restoring')
                            self.assertEqual(client.post(f'/v1/admin/batches/{bid}/start', headers=admin).status_code, 409)
                            upload(audio_paths[0])
                            request('POST', '/v1/batches', owner, json=body)
                            self.assertEqual(client.post(f'/v1/batches/{bid}/complete', headers=owner).status_code, 409)
                            upload(audio_paths[1])
                            self.assertEqual(request('POST', f'/v1/batches/{bid}/complete', owner)['status'], 'ready')
                            self.assertEqual(state(), 'ready', 'Recovery must not auto-start')

                        restore()
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        wait_state('processing')
                        stop(worker)
                        worker = launch('backend.worker')
                        wait_state('batch_failed')
                        self.assertEqual(request('GET', f'/v1/batches/{bid}')['error'], 'worker_interrupted')
                        restore()
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        wait_state('completed')
                        reports = [request('GET', f'/v1/calls/{cid}/report', owner) for cid in calls]
                        self.assertEqual([report['status'] for report in reports], ['successful', 'successful'])
                        self.assertTrue(all(len(report['result']['scores']) == 11 for report in reports))
                        summary = request('GET', f'/v1/batches/{bid}/report', owner)
                        self.assertEqual(summary['successful_calls'], 2)
                        self.assertEqual(summary['average_total'], round(sum(r['result']['total'] for r in reports) / 2, 2))
                        # Simulate lost commit acknowledgement: replay every original operation.
                        self.assertEqual(request('POST', '/v1/batches', owner, json=body)['status'], 'completed')
                        for path, cid in zip(audio_paths, calls):
                            self.assertEqual(upload(path)['call_id'], cid)
                        request('POST', f'/v1/batches/{bid}/complete', owner)
                        self.assertEqual(client.post(f'/v1/admin/batches/{bid}/start', headers=admin).status_code, 200)
                        stop(worker)
                        worker = launch('backend.worker')
                        time.sleep(1)
                        self.assertIsNone(worker.poll())
                        self.assertEqual([request('GET', f'/v1/calls/{cid}/report', owner) for cid in calls], reports)
                        with closing(sqlite3.connect(root / 'db.sqlite3')) as db:
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 2)
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM calls').fetchone()[0], 2)
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM batch_queue').fetchone()[0], 0)
                        print('Live restoration: real-model 2-call publication rollback, worker interruption, '
                              'two complete original reuploads, 2 successful results, full replay without republishing')
                finally:
                    for process in reversed(processes):
                        stop(process)