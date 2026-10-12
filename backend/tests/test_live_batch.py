"""Opt-in REST acceptance with real worker and potentially paid model calls."""
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


@unittest.skipUnless(os.environ.get('RUN_LIVE_BATCH_TEST') == '1',
                     'Opt-in: real Whisper/LLM requests, potentially paid')
class LiveBatchTests(unittest.TestCase):
    def test_real_rest_batch(self):
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        audio = Path(os.environ.get('VOX_LIVE_AUDIO', str(project / 'call_002.mp3')))
        from backend.config import BackendSettings

        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        self.assertIsNotNone(shutil.which(probe), 'ffprobe unavailable; live acceptance blocked')
        self.assertTrue(audio.is_file(), 'Real audio fixture missing')
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live acceptance', text_correction_enabled=False,
                      unwanted_expressions_enabled=False)
        with tempfile.TemporaryDirectory(prefix='vox-live-batch-') as directory:
            root = Path(directory)
            with socket.socket() as port_socket:
                port_socket.bind(('127.0.0.1', 0))
                port = port_socket.getsockname()[1]
            key = 'live-test-admin-' + str(uuid4())
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'api.sqlite3'),
                   'VOX_MATERIALS_ROOT': str(root / 'materials'),
                   'VOX_INPUTS_ROOT': str(root / 'inputs'),
                   'VOX_WORKER_LOCK': str(root / 'worker.lock'),
                   'VOX_FFPROBE_PATH': probe, 'VOX_ADMIN_API_KEY': key}
            processes = []
            with (root / 'process.log').open('w', encoding='utf-8') as log:
                try:
                    processes.append(subprocess.Popen(
                        [sys.executable, '-m', 'uvicorn', 'backend.api:create_app', '--factory',
                         '--host', '127.0.0.1', '--port', str(port)], cwd=project,
                        env=env, stdout=log, stderr=log))
                    with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=90) as client:
                        admin = {'Authorization': f'Bearer {key}'}
                        deadline = time.monotonic() + 30
                        while True:
                            try:
                                response = client.get('/v1/streams', headers=admin)
                                if response.status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            self.assertLess(time.monotonic(), deadline, 'API startup failed')
                            time.sleep(0.2)

                        def request(method, path, headers=None, **kwargs):
                            response = client.request(method, path, headers=headers or admin, **kwargs)
                            response.raise_for_status()
                            return response.json()

                        customer = request('POST', '/v1/admin/customers', json={'name': 'Live'})
                        owner = {'Authorization': f"Bearer {customer['api_key']}"}
                        stream = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                                         data={'config': json.dumps(config)},
                                         files={'knowledge_base': ('kb.txt',
                                                'Возврат билета: заявка организатору.'.encode())})
                        batch = request('POST', '/v1/batches', owner,
                                        json={'stream_id': stream['stream_id'], 'upload_id': str(uuid4())})
                        bid = batch['batch_id']
                        with audio.open('rb') as source:
                            call = request('POST', f'/v1/batches/{bid}/files', owner,
                                           files={'file': (audio.name, source, 'audio/mpeg')})
                        request('POST', f'/v1/batches/{bid}/complete', owner)
                        self.assertEqual(client.post(f'/v1/admin/batches/{bid}/start', headers=owner).status_code, 403)
                        self.assertEqual(client.get(f'/v1/batches/{bid}/report', headers=owner).status_code, 409)
                        with closing(sqlite3.connect(root / 'api.sqlite3')) as connection:
                            self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                        input_path = root / 'inputs' / bid / call['call_id']
                        self.assertTrue(input_path.is_file())
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        processes.append(subprocess.Popen([sys.executable, '-m', 'backend.worker'],
                                                          cwd=project, env=env, stdout=log, stderr=log))
                        deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                        processing_reads = 0
                        while True:
                            status = request('GET', f'/v1/batches/{bid}', owner)['status']
                            self.assertNotEqual(status, 'batch_failed', 'Worker failed')
                            if status == 'completed':
                                break
                            if status == 'processing':
                                processing_reads += 1
                                self.assertEqual(client.get('/v1/streams', headers=owner, timeout=5).status_code, 200)
                                with closing(sqlite3.connect(root / 'api.sqlite3')) as connection:
                                    connection.execute('BEGIN IMMEDIATE')
                                    db_status = connection.execute('SELECT status FROM batches WHERE id = ?', (bid,)).fetchone()[0]
                                    if db_status == 'processing':
                                        self.assertEqual(connection.execute('SELECT COUNT(*) FROM call_results').fetchone()[0], 0)
                                    connection.rollback()
                            pending_report = client.get(f'/v1/batches/{bid}/report', headers=owner)
                            self.assertIn(pending_report.status_code, (409, 200))
                            if pending_report.status_code == 200:
                                self.assertEqual(request('GET', f'/v1/batches/{bid}', owner)['status'], 'completed')
                            self.assertLess(time.monotonic(), deadline, 'Processing timeout')
                            time.sleep(0.5)
                        self.assertGreater(processing_reads, 0, 'No API read observed during real processing')
                        summary = request('GET', f'/v1/batches/{bid}/report', owner)
                        report = request('GET', f"/v1/calls/{call['call_id']}/report", owner)
                        self.assertEqual(report['status'], 'successful', report)
                        result = report['result']
                        self.assertEqual(len(result['scores']), 11)
                        from checklist import CHECKLIST

                        self.assertEqual(set(result['scores']), {c['id'] for c in CHECKLIST})
                        self.assertEqual(result['max_total'], 11)
                        self.assertEqual(result['critical_violation'], result['scores']['5.2']['score'] == 0)
                        self.assertEqual(result['original_total'], sum(s['score'] for s in result['scores'].values()))
                        self.assertEqual(result['total'], 0 if result['critical_violation'] and config['zero_total_on_critical']
                                         else result['original_total'])
                        self.assertEqual(summary['successful_calls'], 1)
                        self.assertEqual(summary['average_total'], result['total'])
                        self.assertEqual(summary['critical_violation_rate'], int(result['critical_violation']))
                        for cid, score in result['scores'].items():
                            self.assertIn(score['score'], (0, 1) if cid == '5.2' else (0, 0.5, 1))
                            self.assertTrue(score['reason'].strip())
                            self.assertEqual(summary['criterion_averages'][cid], score['score'])
                        self.assertTrue(result['_segments'])
                        input_path = root / 'inputs' / bid / call['call_id']
                        deadline = time.monotonic() + 10
                        while input_path.exists() and time.monotonic() < deadline:
                            time.sleep(0.1)
                        self.assertFalse(input_path.exists())
                        self.assertEqual((root / 'materials' / stream['stream_id'] / 'knowledge_base').read_bytes(),
                                         'Возврат билета: заявка организатору.'.encode())
                        metadata = request('GET', f'/v1/batches/{bid}/calls', owner)['items']
                        self.assertEqual(metadata[0]['call_id'], call['call_id'])
                        self.assertEqual(metadata[0]['original_name'], audio.name)
                        print(f'Live acceptance: processing_reads={processing_reads}, '
                              f'segments={len(result["_segments"])}, original_total={result["original_total"]}, '
                              f'total={result["total"]}, critical={result["critical_violation"]}')
                finally:
                    for process in reversed(processes):
                        if process.poll() is None:
                            process.terminate()
                        try:
                            process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=15)