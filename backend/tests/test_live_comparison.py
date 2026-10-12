"""Opt-in real models, HTTP comparison and dashboard history after restart."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

import httpx


@unittest.skipUnless(os.environ.get('RUN_LIVE_COMPARISON_TEST') == '1' or
                     os.environ.get('RUN_LIVE_DASHBOARD_TEST') == '1',
                     'Opt-in: two real audio files and potentially paid Whisper/LLM requests')
class LiveComparisonTests(unittest.TestCase):
    def test_real_reports_compare_after_audio_cleanup_and_api_restart(self):
        from backend.config import BackendSettings
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        audio_paths = [Path(os.environ.get(name, str(project / default))) for name, default in (
            ('VOX_LIVE_AUDIO', 'call_002.mp3'), ('VOX_LIVE_AUDIO_SECOND', 'call_003.mp3'))]
        self.assertTrue(all(path.is_file() for path in audio_paths), 'Real audio fixtures missing')
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live comparison', text_correction_enabled=False, unwanted_expressions_enabled=False)
        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        with tempfile.TemporaryDirectory(prefix='vox-live-comparison-') as directory:
            root = Path(directory)
            with socket.socket() as port_socket:
                port_socket.bind(('127.0.0.1', 0))
                port = port_socket.getsockname()[1]
            key = 'live-comparison-admin-' + str(uuid4())
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'db.sqlite3'),
                'VOX_MATERIALS_ROOT': str(root / 'materials'), 'VOX_INPUTS_ROOT': str(root / 'inputs'),
                'VOX_WORKER_LOCK': str(root / 'worker.lock'), 'VOX_FFPROBE_PATH': probe, 'VOX_ADMIN_API_KEY': key}
            # API process has no reachable model endpoint; only the worker may analyse.
            api_env = {**env, 'WHISPER_BASE_URL': 'http://127.0.0.1:1/v1', 'GPL_BASE_URL': 'http://127.0.0.1:1/v1',
                       'WHISPER_API_KEY': 'unavailable-for-api', 'GPL_API_KEY': 'unavailable-for-api'}
            processes = []

            def stop(process):
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)

            with (root / 'process.log').open('w', encoding='utf-8') as log, \
                    httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=90, trust_env=False) as client:
                admin = {'Authorization': 'Bearer ' + key}

                def start_api():
                    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.api:create_app', '--factory',
                        '--host', '127.0.0.1', '--port', str(port)], env=api_env, cwd=project, stdout=log, stderr=log)
                    processes.append(process)
                    deadline = time.monotonic() + 30
                    while True:
                        self.assertIsNone(process.poll(), 'API exited')
                        try:
                            if client.get('/v1/streams', headers=admin).status_code == 200:
                                return process
                        except httpx.TransportError:
                            pass
                        self.assertLess(time.monotonic(), deadline, 'API startup timeout')
                        time.sleep(0.1)

                def request(method, path, headers=None, **kwargs):
                    response = client.request(method, path, headers=headers or admin, **kwargs)
                    self.assertLess(response.status_code, 300, f'{method} {path}: {response.status_code}')
                    return response.json()

                try:
                    api = start_api()
                    customer = request('POST', '/v1/admin/customers', json={'name': 'Live comparison'})
                    owner = {'Authorization': 'Bearer ' + customer['api_key']}
                    sid = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                        data={'config': json.dumps(config)}, files={'knowledge_base': ('kb.txt',
                            'Возврат билета: заявка организатору.'.encode())})['stream_id']
                    history_path = f'/v1/streams/{sid}/dashboard'
                    self.assertEqual(request('GET', history_path, owner), {'stream_id': sid, 'items': []})
                    ids, calls = [], []
                    for audio in audio_paths:
                        bid = request('POST', '/v1/batches', owner,
                            json={'stream_id': sid, 'upload_id': str(uuid4())})['batch_id']
                        with audio.open('rb') as source:
                            cid = request('POST', f'/v1/batches/{bid}/files', owner,
                                files={'file': (audio.name, source, 'audio/mpeg')})['call_id']
                        request('POST', f'/v1/batches/{bid}/complete', owner)
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        ids.append(bid)
                        calls.append(cid)
                    self.assertEqual(request('GET', history_path, owner), {'stream_id': sid, 'items': []})
                    worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], cwd=project, env=env,
                                              stdout=log, stderr=log)
                    processes.append(worker)
                    deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                    for bid in ids:
                        while True:
                            self.assertIsNone(worker.poll(), 'Worker exited')
                            batch = request('GET', f'/v1/batches/{bid}', owner)
                            self.assertNotEqual(batch['status'], 'batch_failed', 'Real processing failed')
                            if batch['status'] == 'completed' and batch['cleanup']['status'] == 'completed':
                                break
                            self.assertLess(time.monotonic(), deadline, 'Processing/cleanup timeout')
                            time.sleep(0.25)
                    reports = [request('GET', f'/v1/batches/{bid}/report', owner) for bid in reversed(ids)]
                    call_reports = [request('GET', f'/v1/calls/{cid}/report', owner) for cid in calls]
                    for report, detailed in zip(reversed(reports), call_reports):
                        self.assertEqual(detailed['status'], 'successful', 'Real models did not produce valid scores')
                        result = detailed['result']
                        self.assertEqual(len(result['scores']), 11)
                        self.assertEqual(report['successful_calls'], 1)
                        self.assertEqual(report['average_total'], result['total'])
                        self.assertEqual(report['max_total'], 11)
                        self.assertEqual(report['critical_violation_count'], int(result['critical_violation']))
                        self.assertEqual(report['critical_violation_rate'], int(result['critical_violation']))
                        for criterion, score in result['scores'].items():
                            self.assertEqual(report['criterion_averages'][criterion], score['score'])
                    self.assertTrue(all(not (root / 'inputs' / bid).exists() for bid in ids))
                    path = f'/v1/streams/{sid}/comparisons'
                    selected = {'batch_ids': [ids[1], ids[0], ids[1]]}
                    expected = {'stream_id': sid, 'items': reports}
                    self.assertEqual(request('POST', path, owner, json=selected), expected)
                    self.assertEqual(request('POST', path, json=selected), expected)
                    history = {'stream_id': sid, 'items': sorted(reports,
                        key=lambda report: (report['processing_finished_at'], report['batch_id']))}
                    self.assertEqual(request('GET', history_path, owner), history)
                    self.assertEqual(request('GET', history_path), history)
                    for bid in ids:
                        request('POST', f'/v1/admin/batches/{bid}/start')
                    self.assertEqual(request('GET', history_path, owner), history)
                    outsider = request('POST', '/v1/admin/customers', json={'name': 'Other organization'})
                    outsider_key = {'Authorization': 'Bearer ' + outsider['api_key']}
                    self.assertEqual(client.post(path, headers=outsider_key, json=selected).status_code, 404)
                    self.assertEqual(client.get(history_path, headers=outsider_key).status_code, 404)
                    foreign_sid = request('POST', f"/v1/admin/customers/{outsider['customer_id']}/streams",
                        data={'config': json.dumps(config)}, files={'knowledge_base': ('kb.txt', b'Other rules')})['stream_id']
                    self.assertEqual(request('GET', f'/v1/streams/{foreign_sid}/dashboard', outsider_key),
                                     {'stream_id': foreign_sid, 'items': []})
                    stop(api)
                    start_api()
                    self.assertEqual(request('POST', path, owner, json=selected), expected)
                    self.assertEqual(client.post(path, headers=outsider_key, json=selected).status_code, 404)
                    self.assertEqual(request('GET', history_path, owner), history)
                    self.assertEqual(client.get(history_path, headers=outsider_key).status_code, 404)
                    for cid, detailed in zip(calls, call_reports):
                        self.assertEqual(request('GET', f'/v1/calls/{cid}/report', owner), detailed)
                    self.assertEqual(client.delete(f'/v1/admin/streams/{sid}', headers=admin).status_code, 204)
                    self.assertEqual(client.post(path, headers=owner, json=selected).status_code, 404)
                    self.assertEqual(client.get(history_path, headers=owner).status_code, 404)
                    self.assertEqual(request('GET', f'/v1/streams/{foreign_sid}/dashboard', outsider_key),
                                     {'stream_id': foreign_sid, 'items': []})
                    print('Live comparison/dashboard: two real reports, ordered/deduplicated API summaries, '
                          'history, isolation, unchanged scores, audio cleanup and API restart verified')
                finally:
                    for process in reversed(processes):
                        stop(process)
