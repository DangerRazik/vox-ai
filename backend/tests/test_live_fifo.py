"""Opt-in durable FIFO acceptance using real REST, SQLite, workers and models."""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import httpx


@unittest.skipUnless(os.environ.get('RUN_LIVE_FIFO_TEST') == '1',
                     'Opt-in: real Whisper/LLM requests, potentially paid')
class LiveFifoTests(unittest.TestCase):
    def test_real_fifo_concurrency_workers_and_restarts(self):
        from backend.config import BackendSettings
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        audio = Path(os.environ.get('VOX_LIVE_AUDIO', str(project / 'call_002.mp3')))
        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live FIFO', text_correction_enabled=False, unwanted_expressions_enabled=False)
        with tempfile.TemporaryDirectory(prefix='vox-live-fifo-') as directory:
            root = Path(directory)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            key = 'live-fifo-admin-' + str(uuid4())
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'api.sqlite3'),
                   'VOX_MATERIALS_ROOT': str(root / 'materials'), 'VOX_INPUTS_ROOT': str(root / 'inputs'),
                   'VOX_WORKER_LOCK': str(root / 'worker.lock'), 'VOX_FFPROBE_PATH': probe,
                   'VOX_ADMIN_API_KEY': key}
            processes = []
            with (root / 'process.log').open('w', encoding='utf-8') as log:
                def launch(module, override=None):
                    command = [sys.executable, '-m', module]
                    if module == 'uvicorn':
                        command += ['backend.api:create_app', '--factory', '--host', '127.0.0.1', '--port', str(port)]
                    process = subprocess.Popen(command, cwd=project, env={**env, **(override or {})},
                                               stdout=log, stderr=log)
                    processes.append(process)
                    return process

                def stop(process):
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=15)

                try:
                    api = launch('uvicorn')
                    with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=30) as client:
                        admin = {'Authorization': f'Bearer {key}'}

                        def wait_api():
                            deadline = time.monotonic() + 30
                            while time.monotonic() < deadline:
                                try:
                                    if client.get('/v1/streams', headers=admin).status_code == 200:
                                        return
                                except httpx.TransportError:
                                    pass
                                time.sleep(0.1)
                            self.fail('API startup timeout')

                        def request(method, path, headers=None, **kwargs):
                            response = client.request(method, path, headers=headers or admin, **kwargs)
                            # Do not include response bodies/headers (customer creation contains keys).
                            self.assertLess(response.status_code, 300, f'{method} {path}: {response.status_code}')
                            return response.json()

                        def state(bid):
                            return request('GET', f'/v1/batches/{bid}')['status']

                        def wait_state(bid, wanted):
                            deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                            while time.monotonic() < deadline:
                                actual = state(bid)
                                if actual == wanted:
                                    return
                                self.assertNotEqual(actual, 'batch_failed', f'Unexpected failure waiting for {wanted}')
                                self.assertIsNone(worker.poll(), 'Worker exited')
                                time.sleep(0.02)
                            self.fail(f'Timeout waiting for {wanted}')

                        wait_api()
                        customers = []
                        for name in ('A', 'B'):
                            customer = request('POST', '/v1/admin/customers', json={'name': name})
                            owner = {'Authorization': f"Bearer {customer['api_key']}"}
                            stream = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                                             data={'config': json.dumps(config)},
                                             files={'knowledge_base': ('kb.txt', 'Возврат билета: заявка организатору.'.encode())})
                            customers.append((owner, stream['stream_id']))

                        def upload(customer_index):
                            owner, sid = customers[customer_index]
                            bid = request('POST', '/v1/batches', owner,
                                          json={'stream_id': sid, 'upload_id': str(uuid4())})['batch_id']
                            with audio.open('rb') as source:
                                call = request('POST', f'/v1/batches/{bid}/files', owner,
                                               files={'file': (audio.name, source, 'audio/mpeg')})
                            request('POST', f'/v1/batches/{bid}/complete', owner)
                            return bid, call['call_id']

                        # Reverse creation order proves that FIFO follows accepted starts.
                        last, last_call = upload(0)
                        middle, middle_call = upload(1)
                        interrupted, interrupted_call = upload(0)
                        with ThreadPoolExecutor(max_workers=8) as pool:
                            responses = list(pool.map(lambda _: client.post(
                                f'/v1/admin/batches/{interrupted}/start', headers=admin).status_code, range(16)))
                        self.assertEqual(responses.count(202), 1)
                        self.assertEqual(responses.count(200), 15)
                        request('POST', f'/v1/admin/batches/{middle}/start')
                        request('POST', f'/v1/admin/batches/{last}/start')
                        with closing(sqlite3.connect(root / 'api.sqlite3')) as db:
                            self.assertEqual([r[0] for r in db.execute('SELECT batch_id FROM batch_queue ORDER BY sequence')],
                                             [interrupted, middle, last])

                        # Restart API before any worker: persisted starts remain queued.
                        stop(api)
                        api = launch('uvicorn')
                        wait_api()
                        self.assertEqual([state(bid) for bid in (interrupted, middle, last)], ['queued'] * 3)
                        worker = launch('backend.worker')
                        wait_state(interrupted, 'processing')
                        self.assertEqual(client.post(f'/v1/admin/batches/{interrupted}/start', headers=admin).status_code, 200)
                        # A different configured lock cannot bypass canonical database ownership.
                        second = launch('backend.worker', {'VOX_WORKER_LOCK': str(root / 'other.lock')})
                        self.assertNotEqual(second.wait(timeout=15), 0)
                        self.assertEqual(state(interrupted), 'processing')
                        self.assertEqual(state(middle), 'queued')
                        with closing(sqlite3.connect(root / 'api.sqlite3')) as db:
                            db.execute('BEGIN IMMEDIATE')
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                            self.assertEqual(db.execute("SELECT COUNT(*) FROM batches WHERE status='processing'").fetchone()[0], 1)
                            db.rollback()
                        stop(worker)
                        self.assertEqual(state(interrupted), 'processing', 'API must not recover worker state')
                        self.assertTrue((root / 'inputs' / interrupted / interrupted_call).is_file())
                        worker = launch('backend.worker')
                        wait_state(middle, 'processing')
                        self.assertEqual(state(interrupted), 'batch_failed')
                        self.assertEqual(request('GET', f'/v1/batches/{interrupted}')['error'], 'worker_interrupted')
                        self.assertTrue((root / 'inputs' / interrupted / interrupted_call).is_file())

                        # API-only restart while the worker is running must not fail its batch.
                        stop(api)
                        api = launch('uvicorn')
                        wait_api()
                        self.assertIn(state(middle), ('processing', 'completed'))
                        # Uploads still work during genuine model processing (not queued for analysis).
                        extra, _ = upload(1)
                        self.assertEqual(state(extra), 'ready')
                        wait_state(middle, 'completed')
                        wait_state(last, 'completed')
                        for bid, cid in ((middle, middle_call), (last, last_call)):
                            report = request('GET', f'/v1/calls/{cid}/report')
                            self.assertEqual(report['status'], 'successful')
                            self.assertEqual(len(report['result']['scores']), 11)
                            summary = request('GET', f'/v1/batches/{bid}/report')
                            self.assertEqual(summary['average_total'], report['result']['total'])
                        middle_batch = request('GET', f'/v1/batches/{middle}')
                        last_batch = request('GET', f'/v1/batches/{last}')
                        self.assertLessEqual(middle_batch['processing_finished_at'], last_batch['processing_started_at'])
                        published = request('GET', f'/v1/calls/{middle_call}/report')
                        stop(worker)
                        worker = launch('backend.worker')
                        time.sleep(1)
                        self.assertIsNone(worker.poll())
                        for bid in (middle, last):
                            self.assertEqual(client.post(f'/v1/admin/batches/{bid}/start', headers=admin).status_code, 200)
                            self.assertEqual(state(bid), 'completed')
                        self.assertEqual(request('GET', f'/v1/calls/{middle_call}/report'), published)
                        with closing(sqlite3.connect(root / 'api.sqlite3')) as db:
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM batch_queue').fetchone()[0], 0)
                            self.assertEqual(db.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 2)
                        print('Live FIFO: 16 competing starts, second worker rejected, worker/API restarts, '
                              'two organizations, 2 real successful model results, published reports unchanged')
                finally:
                    for process in reversed(processes):
                        stop(process)