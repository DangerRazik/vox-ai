"""Opt-in actual models, SQLite, Windows deletion denial and worker restart."""
import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.batches import BatchStore
from backend.config import BackendSettings
from backend.database import Database
from backend.streams import StreamStore


@unittest.skipUnless(os.environ.get('RUN_LIVE_STREAM_DELETION_TEST') == '1' and sys.platform == 'win32',
                     'Opt-in: real Whisper/LLM, Windows delete denial')
class LiveStreamDeletionTests(unittest.TestCase):
    def test_completed_history_delete_denial_and_restart(self):
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live stream deletion', text_correction_enabled=False, unwanted_expressions_enabled=False)
        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        with tempfile.TemporaryDirectory(prefix='vox-live-delete-') as directory:
            root = Path(directory)
            key = 'live-delete-admin-' + str(uuid4())
            settings = BackendSettings(database_path=root / 'db.sqlite3', materials_root=root / 'materials',
                                       inputs_root=root / 'inputs', worker_lock=root / 'worker.lock',
                                       ffprobe_path=probe, admin_api_key=key)
            env = {**os.environ, 'VOX_DATABASE_PATH': str(settings.database_path),
                   'VOX_MATERIALS_ROOT': str(settings.materials_root), 'VOX_INPUTS_ROOT': str(settings.inputs_root),
                   'VOX_WORKER_LOCK': str(settings.worker_lock), 'VOX_FFPROBE_PATH': probe, 'VOX_ADMIN_API_KEY': key}
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                                          ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
            kernel.CreateFileW.restype = ctypes.c_void_p
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = None
            worker = None
            try:
                with TestClient(create_app(settings)) as client:
                    admin = {'Authorization': f'Bearer {key}'}

                    def request(method, path, headers=None, **kwargs):
                        response = client.request(method, path, headers=headers or admin, **kwargs)
                        self.assertLess(response.status_code, 300, f'{method} {path}: {response.status_code}')
                        return response.json()

                    customer = request('POST', '/v1/admin/customers', json={'name': 'Delete acceptance'})
                    owner = {'Authorization': f"Bearer {customer['api_key']}"}

                    def stream():
                        return request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                                       data={'config': json.dumps(config)},
                                       files={'knowledge_base': ('kb.txt', 'Возврат билета: заявка организатору.'.encode())})['stream_id']

                    sid, neighbor = stream(), stream()
                    bid = request('POST', '/v1/batches', owner,
                                  json={'stream_id': sid, 'upload_id': str(uuid4())})['batch_id']
                    with (project / 'call_002.mp3').open('rb') as audio:
                        cid = request('POST', f'/v1/batches/{bid}/files', owner,
                                      files={'file': ('call.mp3', audio, 'audio/mpeg')})['call_id']
                    request('POST', f'/v1/batches/{bid}/complete', owner)
                    request('POST', f'/v1/admin/batches/{bid}/start')
                    database = Database(settings.database_path)
                    batches = BatchStore(database, StreamStore(database, settings.materials_root),
                                         settings.inputs_root, probe)
                    self.assertTrue(batches.process(bid))
                    report = request('GET', f'/v1/calls/{cid}/report', owner)
                    self.assertEqual(report['status'], 'successful')
                    self.assertEqual(len(report['result']['scores']), 11)
                    self.assertEqual(request('GET', f'/v1/batches/{bid}/report', owner)['successful_calls'], 1)
                    kept = settings.materials_root / neighbor / 'knowledge_base'
                    kept_bytes = kept.read_bytes()
                    target = settings.materials_root / sid / 'knowledge_base'
                    handle = kernel.CreateFileW(str(target), 0x80000000, 3, None, 3, 0x80, None)
                    self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
                    self.assertEqual(client.delete(f'/v1/admin/streams/{sid}', headers=admin).status_code, 204)
                    for resource in (f'/v1/streams/{sid}', f'/v1/batches/{bid}', f'/v1/calls/{cid}/report'):
                        self.assertEqual(client.get(resource, headers=owner).status_code, 404)
                    with database.connection() as connection:
                        for table in ('batches', 'calls', 'call_results', 'batch_queue', 'input_cleanup', 'restoration_receipts'):
                            self.assertEqual(connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0], 0)
                        job = connection.execute("SELECT status, error FROM deleted_stream_cleanup WHERE kind='materials'").fetchone()
                        self.assertEqual(tuple(job), ('pending', 'stream_cleanup_permission_denied'))
                    self.assertTrue(target.exists())
                    kernel.CloseHandle(handle)
                    handle = None
                    # A fail-fast guard rejects any accidental analysis; never fabricates model answers.
                    script = ('import pipeline\ndef fail(*args, **kwargs):\n '
                              'raise SystemExit("unexpected analysis")\n'
                              'pipeline.process_call = fail\nfrom backend.worker import main\nmain()')
                    with (root / 'worker.log').open('w', encoding='utf-8') as log:
                        worker = subprocess.Popen([sys.executable, '-c', script], cwd=project, env=env,
                                                  stdout=log, stderr=log)
                        deadline = time.monotonic() + 30
                        while target.parent.exists():
                            self.assertIsNone(worker.poll())
                            self.assertLess(time.monotonic(), deadline, 'Cleanup retry timeout')
                            time.sleep(0.05)
                        self.assertEqual(kept.read_bytes(), kept_bytes)
                        self.assertEqual(client.get(f'/v1/streams/{neighbor}', headers=owner).status_code, 200)
                        self.assertEqual(client.get(f"/v1/customers/{customer['customer_id']}", headers=owner).status_code, 200)
                        self.assertEqual(client.delete(f'/v1/admin/streams/{sid}', headers=admin).status_code, 404)
                        time.sleep(0.2)
                        self.assertIsNone(worker.poll())
                        with database.connection() as connection:
                            self.assertEqual(connection.execute("SELECT COUNT(*) FROM deleted_stream_cleanup WHERE status='pending'").fetchone()[0], 0)
                    print('Live deletion: real successful Whisper/LLM report removed, genuine Windows deletion '
                          'denial persisted, new worker cleaned without models, neighboring stream/customer intact')
            finally:
                if worker is not None:
                    worker.kill()
                    worker.wait(timeout=15)
                if handle is not None:
                    kernel.CloseHandle(handle)