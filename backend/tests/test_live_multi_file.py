"""Opt-in API acceptance with actual ffprobe and models; no service substitutes."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.api import create_app
from backend.config import BackendSettings


@unittest.skipUnless(os.environ.get('RUN_LIVE_MULTI_FILE_TEST') == '1',
                     'Opt-in: two audio files, real ffprobe and Whisper/LLM settings')
class LiveMultiFileTests(unittest.TestCase):
    def test_mixed_intake_and_processing_publish_one_consistent_report(self):
        from processing_context import ProcessingContext

        sources = [Path(os.environ[name]) for name in ('VOX_LIVE_AUDIO', 'VOX_LIVE_AUDIO_SECOND')]
        self.assertTrue(all(path.is_file() for path in sources), 'Two real audio files required')
        self.assertNotEqual(sources[0].read_bytes(), sources[1].read_bytes(), 'Audio must differ')
        admin_key = 'live-multi-' + str(uuid4())
        probe = BackendSettings(admin_api_key=admin_key).ffprobe_path
        self.assertIsNotNone(shutil.which(probe), 'Real ffprobe required')
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live multi-file', text_correction_enabled=False, unwanted_expressions_enabled=False)
        with tempfile.TemporaryDirectory(prefix='vox-live-multi-') as directory:
            root = Path(directory)
            settings = BackendSettings(database_path=root / 'db.sqlite3', materials_root=root / 'materials',
                inputs_root=root / 'inputs', worker_lock=root / 'worker.lock',
                ffprobe_path=probe, admin_api_key=admin_key)
            with TestClient(create_app(settings)) as client:
                admin = {'Authorization': 'Bearer ' + admin_key}

                def request(method, path, headers, expected=200, **kwargs):
                    response = client.request(method, path, headers=headers, **kwargs)
                    self.assertEqual(response.status_code, expected, response.text)
                    return response.json()

                customer = request('POST', '/v1/admin/customers', admin, 201, json={'name': 'Live'})
                owner = {'Authorization': 'Bearer ' + customer['api_key']}
                stream = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams", admin, 201,
                    data={'config': json.dumps(config)}, files={'knowledge_base': ('kb.txt', b'Call quality rules')})
                body = {'stream_id': stream['stream_id'], 'upload_id': str(uuid4())}
                batch = request('POST', '/v1/batches', owner, 201, json=body)
                path = '/v1/batches/' + batch['batch_id']
                self.assertEqual(request('POST', '/v1/batches', owner, json=body)['batch_id'], batch['batch_id'])
                request('POST', path + '/files', owner, 422, files={'file': ('broken.wav', b'not audio')})
                calls = []
                for source in sources:
                    with source.open('rb') as audio:
                        calls.append(request('POST', path + '/files', owner, 201,
                            files={'file': (source.name, audio)}))
                with sources[0].open('rb') as audio:
                    duplicate = request('POST', path + '/files', owner,
                        files={'file': ('renamed.audio', audio)})
                self.assertEqual(duplicate['call_id'], calls[0]['call_id'])
                self.assertTrue(duplicate['duplicate'])
                self.assertEqual(request('POST', path + '/complete', owner)['total_calls'], 2)
                # First input fails externally; the subsequent call must still reach real models.
                (root / 'inputs' / batch['batch_id'] / calls[0]['call_id']).unlink()
                request('POST', '/v1/admin/batches/' + batch['batch_id'] + '/start', admin, 202)
                env = {**os.environ, 'VOX_DATABASE_PATH': str(settings.database_path),
                    'VOX_MATERIALS_ROOT': str(settings.materials_root), 'VOX_INPUTS_ROOT': str(settings.inputs_root),
                    'VOX_WORKER_LOCK': str(settings.worker_lock), 'VOX_FFPROBE_PATH': probe,
                    'VOX_ADMIN_API_KEY': admin_key}
                worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
                    cwd=Path(__file__).resolve().parents[1], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    deadline = time.monotonic() + int(os.environ.get('VOX_LIVE_TIMEOUT', '1200'))
                    while request('GET', path, owner)['status'] != 'completed':
                        self.assertIsNone(worker.poll(), 'Worker exited')
                        self.assertNotEqual(request('GET', path, owner)['status'], 'batch_failed')
                        self.assertLess(time.monotonic(), deadline, 'Processing timeout')
                        time.sleep(0.2)
                    summary = request('GET', path + '/report', owner)
                    failed = request('GET', '/v1/calls/' + calls[0]['call_id'] + '/report', owner)
                    successful = request('GET', '/v1/calls/' + calls[1]['call_id'] + '/report', owner)
                    self.assertEqual(failed['status'], 'processing_error')
                    self.assertIsNone(failed['result'])
                    self.assertEqual(successful['status'], 'successful')
                    result = successful['result']
                    self.assertEqual(summary['total_calls'], 2)
                    self.assertEqual(summary['successful_calls'], 1)
                    self.assertEqual(summary['processing_errors'], 1)
                    self.assertEqual(summary['upload_errors'], 1)
                    self.assertEqual(summary['average_total'], result['total'])
                    self.assertEqual(summary['critical_violation_rate'], int(result['critical_violation']))
                    self.assertEqual(summary['critical_violation_count'], int(result['critical_violation']))
                    self.assertEqual(len(result['scores']), 11)
                    for cid, score in result['scores'].items():
                        self.assertEqual(summary['criterion_averages'][cid], score['score'])
                finally:
                    worker.terminate()
                    try:
                        worker.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        worker.kill()
                        worker.wait(timeout=10)
