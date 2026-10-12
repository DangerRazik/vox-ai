"""Real analysis, post-commit process exit and real Windows deletion denial."""
import ctypes
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import wave
import zipfile
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings


@unittest.skipUnless(os.environ.get('RUN_LIVE_CLEANUP_TEST') == '1' and sys.platform == 'win32',
                     'Opt-in: real Whisper/LLM and Windows file sharing lock')
class LiveCleanupTests(unittest.TestCase):
    def test_post_commit_crash_delete_denial_and_worker_restart(self):
        from processing_context import ProcessingContext

        project = Path(__file__).resolve().parents[1]
        context = ProcessingContext.from_defaults()
        config = {name: getattr(context, name) for name in (
            'whisper_model', 'llm_model', 'speech_lang', 'whisper_prompt', 'role_prompt',
            'analysis_system_prompt', 'analysis_user_prompt', 'long_pause_sec',
            'interruption_gap_sec', 'speech_rate_enabled', 'zero_total_on_critical')}
        config.update(name='Live cleanup', text_correction_enabled=False, unwanted_expressions_enabled=False)
        probe = BackendSettings(admin_api_key='live-probe-diagnostic-key').ffprobe_path
        with tempfile.TemporaryDirectory(prefix='vox-live-cleanup-') as directory:
            root = Path(directory)
            key = 'live-cleanup-admin-' + str(uuid4())
            settings = BackendSettings(database_path=root / 'db.sqlite3', materials_root=root / 'materials',
                                       inputs_root=root / 'inputs', worker_lock=root / 'worker.lock',
                                       ffprobe_path=probe, admin_api_key=key)
            env = {**os.environ, 'VOX_DATABASE_PATH': str(settings.database_path),
                   'VOX_MATERIALS_ROOT': str(settings.materials_root), 'VOX_INPUTS_ROOT': str(settings.inputs_root),
                   'VOX_WORKER_LOCK': str(settings.worker_lock), 'VOX_FFPROBE_PATH': probe, 'VOX_ADMIN_API_KEY': key}
            processes = []
            handle = None
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                                          ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
            kernel.CreateFileW.restype = ctypes.c_void_p
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            kernel.CloseHandle.restype = ctypes.c_int
            with (root / 'worker.log').open('w', encoding='utf-8') as log:
                def launch(script=None):
                    args = ['-c', script] if script else ['-m', 'backend.worker']
                    process = subprocess.Popen([sys.executable, *args], cwd=project, env=env, stdout=log, stderr=log)
                    processes.append(process)
                    return process

                def stop(process):
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=15)

                try:
                    with TestClient(create_app(settings)) as client:
                        admin = {'Authorization': f'Bearer {key}'}

                        def request(method, path, headers=None, **kwargs):
                            response = client.request(method, path, headers=headers or admin, **kwargs)
                            self.assertLess(response.status_code, 300, f'{method} {path}: {response.status_code}')
                            return response.json()

                        customer = request('POST', '/v1/admin/customers', json={'name': 'Cleanup'})
                        owner = {'Authorization': f"Bearer {customer['api_key']}"}
                        sid = request('POST', f"/v1/admin/customers/{customer['customer_id']}/streams",
                                      data={'config': json.dumps(config)},
                                      files={'knowledge_base': ('kb.txt', 'Возврат билета: заявка организатору.'.encode())})['stream_id']
                        body = {'stream_id': sid, 'upload_id': str(uuid4())}
                        bid = request('POST', '/v1/batches', owner, json=body)['batch_id']
                        with (project / 'call_002.mp3').open('rb') as source:
                            cid = request('POST', f'/v1/batches/{bid}/files', owner,
                                          files={'file': ('call.mp3', source, 'audio/mpeg')})['call_id']
                        wave_bytes = io.BytesIO()
                        with wave.open(wave_bytes, 'wb') as audio:
                            audio.setnchannels(1)
                            audio.setsampwidth(2)
                            audio.setframerate(8000)
                            audio.writeframes(b'\0\0' * 8000)
                        failed_cid = request('POST', f'/v1/batches/{bid}/files', owner,
                                             files={'file': ('second.wav', wave_bytes.getvalue(), 'audio/wav')})['call_id']
                        managed = settings.inputs_root / bid
                        # An actual I/O error before models for the second call; preserve its bytes.
                        (managed / failed_cid).rename(managed / 'failed-input.wav')
                        (managed / failed_cid).mkdir()
                        archive = managed / 'source.zip'
                        with zipfile.ZipFile(archive, 'w') as zipped:
                            zipped.write(project / 'call_002.mp3', 'call.mp3')
                        other = request('POST', '/v1/batches', owner,
                                        json={'stream_id': sid, 'upload_id': str(uuid4())})['batch_id']
                        sentinel = settings.inputs_root / other / 'preserve.bin'
                        sentinel.parent.mkdir(parents=True)
                        sentinel.write_bytes(b'other batch')
                        materials = {p: p.read_bytes() for p in settings.materials_root.rglob('*') if p.is_file()}
                        request('POST', f'/v1/batches/{bid}/complete', owner)
                        request('POST', f'/v1/admin/batches/{bid}/start')
                        # Exit exactly at the post-commit cleanup seam; all model calls are untouched.
                        worker = launch('import os; from backend.batches import BatchStore; '
                                        'BatchStore.cleanup_pending = lambda self, batch_id=None: '
                                        'os._exit(73) if batch_id else None; '
                                        'from backend.worker import main; main()')
                        worker.wait(timeout=int(os.environ.get('VOX_LIVE_TIMEOUT', '1200')))
                        self.assertEqual(worker.returncode, 73)

                        def state():
                            return request('GET', f'/v1/batches/{bid}', owner)

                        self.assertEqual(state()['status'], 'completed')
                        self.assertEqual(state()['cleanup']['status'], 'pending')
                        successful = request('GET', f'/v1/calls/{cid}/report', owner)
                        self.assertEqual(successful['status'], 'successful')
                        self.assertEqual(len(successful['result']['scores']), 11)
                        failed = request('GET', f'/v1/calls/{failed_cid}/report', owner)
                        self.assertEqual(failed['status'], 'processing_error')
                        summary = request('GET', f'/v1/batches/{bid}/report', owner)
                        self.assertEqual(summary['successful_calls'], 1)
                        self.assertEqual(summary['processing_errors'], 1)
                        self.assertTrue((managed / cid).is_file())
                        # Read/write allowed, FILE_SHARE_DELETE excluded: genuine Windows denial.
                        handle = kernel.CreateFileW(str(archive), 0x80000000, 3, None, 3, 0x80, None)
                        self.assertNotEqual(handle, ctypes.c_void_p(-1).value, 'Cannot establish deletion denial')
                        worker = launch()

                        def wait_cleanup(wanted, error=None):
                            deadline = time.monotonic() + 30
                            while time.monotonic() < deadline:
                                cleanup = state()['cleanup']
                                if cleanup['status'] == wanted and (error is None or cleanup['error'] == error):
                                    return
                                self.assertIsNone(worker.poll(), 'worker exited')
                                time.sleep(0.05)
                            self.fail('Cleanup timeout')

                        wait_cleanup('pending', 'input_cleanup_permission_denied')
                        self.assertIsNone(state()['error'])
                        self.assertEqual(state()['status'], 'completed')
                        self.assertTrue(archive.is_file())
                        self.assertEqual(request('GET', f'/v1/batches/{bid}/report', owner), summary)
                        stop(worker)
                        kernel.CloseHandle(handle)
                        handle = None
                        # Fail fast if retry erroneously reaches the pipeline; no fake model result.
                        worker = launch('import pipeline\ndef fail(*args, **kwargs):\n '
                                        'raise SystemExit("unexpected analysis")\n'
                                        'pipeline.process_call = fail\nfrom backend.worker import main\nmain()')
                        wait_cleanup('completed')
                        self.assertIsNone(state()['cleanup']['error'])
                        self.assertFalse(managed.exists())
                        self.assertEqual(sentinel.read_bytes(), b'other batch')
                        self.assertTrue(settings.database_path.is_file())
                        self.assertEqual({p: p.read_bytes() for p in materials}, materials)
                        self.assertEqual(request('GET', f'/v1/calls/{cid}/report', owner), successful)
                        self.assertEqual(request('GET', f'/v1/calls/{failed_cid}/report', owner), failed)
                        self.assertEqual(request('GET', f'/v1/batches/{bid}/report', owner), summary)
                        self.assertEqual(client.post(f'/v1/admin/batches/{bid}/start', headers=admin).status_code, 200)
                        stop(worker)
                        worker = launch()
                        time.sleep(1)
                        self.assertIsNone(worker.poll())
                        self.assertEqual(state()['cleanup']['status'], 'completed')
                        print('Live cleanup: real analysis, exit immediately after commit, actual Windows delete '
                              'denial, restart retry without models, ZIP/error inputs removed, other data intact')
                finally:
                    for process in reversed(processes):
                        stop(process)
                    if handle is not None:
                        kernel.CloseHandle(handle)