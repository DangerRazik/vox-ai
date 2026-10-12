"""Opt-in ZIP -> actual HTTP -> worker -> Whisper/LLM -> report and cleanup."""
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from uuid import uuid4

import httpx


@unittest.skipUnless(os.environ.get('RUN_LIVE_ARCHIVE_TEST') == '1',
                     'Opt-in: real audio, ffprobe and potentially paid Whisper/LLM requests')
class LiveArchiveTests(unittest.TestCase):
    def test_zip_publishes_real_results_and_removes_only_managed_inputs(self):
        from backend.config import BackendSettings
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        sources = [Path(os.environ.get(name, str(project / filename))) for name, filename in (
            ('VOX_LIVE_AUDIO', 'call_001.mp3'), ('VOX_LIVE_AUDIO_SECOND', 'call_002.mp3'))]
        self.assertTrue(all(source.is_file() for source in sources), 'Two real recordings required')
        self.assertNotEqual(sources[0].read_bytes(), sources[1].read_bytes())
        admin_key = 'live-zip-admin-' + str(uuid4())
        probe = BackendSettings(admin_api_key=admin_key).ffprobe_path
        self.assertIsNotNone(shutil.which(probe), 'Real ffprobe required')
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live ZIP acceptance', text_correction_enabled=False,
                      unwanted_expressions_enabled=False)
        archive_bytes = io.BytesIO()
        with zipfile.ZipFile(archive_bytes, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(sources[0], 'calls/one.mp3')
            archive.write(sources[1], 'calls/two.mp3')
            archive.write(sources[0], 'copy.mp3')
            archive.writestr('broken.wav', b'not audio')
            archive.writestr('../outside.wav', b'unsafe archive path')
        metadata = json.dumps({'calls/one.mp3': {'external_employee_id': 'live-employee',
            'called_at': '2026-10-07T10:00:00Z'}}).encode()
        with tempfile.TemporaryDirectory(prefix='vox-live-zip-') as directory:
            root = Path(directory)
            with socket.socket() as port_socket:
                port_socket.bind(('127.0.0.1', 0))
                port = port_socket.getsockname()[1]
            env = {**os.environ, 'VOX_DATABASE_PATH': str(root / 'db.sqlite3'),
                'VOX_MATERIALS_ROOT': str(root / 'materials'), 'VOX_INPUTS_ROOT': str(root / 'inputs'),
                'VOX_WORKER_LOCK': str(root / 'worker.lock'), 'VOX_FFPROBE_PATH': probe,
                'VOX_ADMIN_API_KEY': admin_key}
            processes = []
            try:
                processes.append(subprocess.Popen([sys.executable, '-m', 'uvicorn',
                    'backend.api:create_app', '--factory', '--host', '127.0.0.1', '--port', str(port)],
                    env=env, cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=120, trust_env=False) as client:
                    admin = {'Authorization': 'Bearer ' + admin_key}
                    deadline = time.monotonic() + 30
                    while True:
                        self.assertIsNone(processes[0].poll(), 'API exited')
                        try:
                            if client.get('/v1/streams', headers=admin).status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        self.assertLess(time.monotonic(), deadline, 'API startup timeout')
                        time.sleep(0.1)

                    def request(method, path, expected=200, headers=admin, **kwargs):
                        response = client.request(method, path, headers=headers, **kwargs)
                        self.assertEqual(response.status_code, expected, response.text)
                        return response.json()

                    customer = request('POST', '/v1/admin/customers', 201, json={'name': 'Live ZIP'})
                    owner = {'Authorization': 'Bearer ' + customer['api_key']}
                    stream = request('POST', '/v1/admin/customers/' + customer['customer_id'] + '/streams', 201,
                        data={'config': json.dumps(config)}, files={'knowledge_base': ('kb.txt',
                            'Сотрудник должен вежливо приветствовать клиента, уточнить обращение и помочь ему.'.encode())})
                    body = {'upload_id': str(uuid4()), 'stream_id': stream['stream_id']}
                    files = {'archive': ('calls.zip', archive_bytes.getvalue(), 'application/zip'),
                             'metadata_file': ('metadata.json', metadata, 'application/json')}
                    batch = request('POST', '/v1/batch-archives', 201, owner, data=body, files=files)
                    self.assertEqual(batch['status'], 'ready')
                    self.assertEqual(batch['total_calls'], 2)
                    self.assertEqual(batch['upload_errors'], 2)
                    self.assertEqual(sum(item['status'] == 'duplicate' for item in batch['items']), 1)
                    batch_id = batch['batch_id']
                    path = '/v1/batches/' + batch_id
                    original_input_paths = [root / 'inputs' / batch_id / item['call_id']
                        for item in batch['items'] if item['status'] == 'accepted']
                    original_input_paths.append(root / 'inputs' / batch_id / 'archive.zip')
                    self.assertTrue(all(input_path.is_file() for input_path in original_input_paths))
                    materials = {p: p.read_bytes() for p in (root / 'materials').rglob('*') if p.is_file()}
                    request('GET', path + '/report', 409, owner)
                    request('POST', '/v1/admin/batches/' + batch_id + '/start', 202)
                    processes.append(subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
                        cwd=project, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                    deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                    while True:
                        state = request('GET', path, headers=owner)
                        self.assertIsNone(processes[-1].poll(), 'Worker exited')
                        self.assertNotEqual(state['status'], 'batch_failed')
                        if state['status'] == 'completed':
                            break
                        request('GET', path + '/report', 409, owner)
                        self.assertLess(time.monotonic(), deadline, 'Model processing timeout')
                        time.sleep(0.2)
                    summary = request('GET', path + '/report', headers=owner)
                    calls = request('GET', path + '/calls', headers=owner)['items']
                    results = []
                    criteria = {'1.1', '1.2', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '4.1', '5.1', '5.2'}
                    for call in calls:
                        report = request('GET', '/v1/calls/' + call['call_id'] + '/report', headers=owner)
                        self.assertEqual(report['status'], 'successful')
                        result = report['result']
                        self.assertEqual(set(result['scores']), criteria)
                        self.assertEqual(result['max_total'], 11)
                        for criterion in result['scores'].values():
                            self.assertIn(criterion['score'], (0, 0.5, 1))
                            self.assertTrue(criterion['reason'].strip())
                        self.assertIn(result['scores']['5.2']['score'], (0, 1))
                        self.assertEqual(result['critical_violation'], result['scores']['5.2']['score'] == 0)
                        expected_total = 0 if result['critical_violation'] else sum(c['score'] for c in result['scores'].values())
                        self.assertEqual(result['total'], expected_total)
                        self.assertTrue(result['_segments'])
                        self.assertTrue(result['_metrics'])
                        results.append(result)
                    self.assertEqual(summary['total_calls'], 2)
                    self.assertEqual(summary['successful_calls'], 2)
                    self.assertEqual(summary['processing_errors'], 0)
                    self.assertEqual(summary['upload_errors'], 2)
                    self.assertEqual(summary['average_total'], round(sum(r['total'] for r in results) / 2, 2))
                    for cid in criteria:
                        self.assertEqual(summary['criterion_averages'][cid],
                            round(sum(r['scores'][cid]['score'] for r in results) / 2, 2))
                    critical = sum(r['critical_violation'] for r in results)
                    self.assertEqual(summary['critical_violation_count'], critical)
                    self.assertEqual(summary['critical_violation_rate'], critical / 2)
                    cleanup_deadline = time.monotonic() + 5
                    while any(p.exists() for p in original_input_paths) and time.monotonic() < cleanup_deadline:
                        time.sleep(0.05)
                    self.assertFalse(any(p.exists() for p in original_input_paths))
                    self.assertTrue(materials)
                    self.assertTrue(all(p.read_bytes() == content for p, content in materials.items()))
                    repeated = request('POST', '/v1/batch-archives', headers=owner, data=body, files=files)
                    self.assertEqual(repeated['status'], 'completed')
                    self.assertEqual(repeated['batch_id'], batch_id)
                    self.assertEqual(request('GET', path + '/report', headers=owner), summary)
                    self.assertFalse(any(p.exists() for p in original_input_paths))
                    print('Live ZIP: 2 successful calls, 2 intake errors, 1 duplicate; reports and cleanup verified')
            finally:
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)
