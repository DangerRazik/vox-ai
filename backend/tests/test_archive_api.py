"""ZIP intake through REST with real archives/SQLite and a controlled ffprobe boundary."""
import io
import json
import subprocess
import struct
import stat
import os
import sys
import time
import tempfile
import unittest
import zipfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.api import create_app
from backend.config import BackendSettings
from tests.test_stream_api import ADMIN, stream_config


def zip_bytes(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries:
            if isinstance(name, str):
                info = zipfile.ZipInfo(name)
                # Preserve the wire path: ZipInfo otherwise normalizes Windows separators.
                info.filename = name
                info.compress_type = zipfile.ZIP_DEFLATED
            else:
                info = name
            archive.writestr(info, content)
    return output.getvalue()


class ArchiveApiTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.settings = BackendSettings(database_path=self.root / 'db.sqlite3',
            materials_root=self.root / 'materials', inputs_root=self.root / 'inputs',
            admin_api_key='test-admin-key-not-for-production')
        self.client = self.enterContext(TestClient(create_app(self.settings)))
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
        self.owner = {'Authorization': 'Bearer ' + customer['api_key']}
        self.customer_id = customer['customer_id']
        stream = self.client.post('/v1/admin/customers/' + self.customer_id + '/streams', headers=ADMIN,
            data={'config': json.dumps(stream_config(text_correction_enabled=False,
                unwanted_expressions_enabled=False))}, files={'knowledge_base': ('kb.txt', b'Rules')})
        self.assertEqual(stream.status_code, 201)
        self.stream_id = stream.json()['stream_id']
        self.upload_id = str(uuid4())

    def import_zip(self, content, metadata=None, archive_name='calls.zip', **data):
        def probe(command, **kwargs):
            valid = Path(command[-1]).read_bytes().startswith(b'audio')
            return subprocess.CompletedProcess(command, 0 if valid else 1,
                stdout=b'{"streams":[{"codec_type":"audio"}],"format":{"duration":"2"}}')
        files = {'archive': (archive_name, content, 'application/zip')}
        if metadata is not None:
            files['metadata_file'] = ('metadata.json', metadata, 'application/json')
        with patch('subprocess.run', side_effect=probe):
            return self.client.post('/v1/batch-archives', headers=self.owner, files=files,
                data={'stream_id': self.stream_id, 'upload_id': self.upload_id, **data})

    def test_archive_name_survives_retry_restart_and_independent_upload(self):
        content = zip_bytes([('one.wav', b'audio one')])
        first = self.import_zip(content, archive_name='Звонки 09.10.ZIP')
        self.assertEqual(first.status_code, 201)
        batch = first.json()
        self.assertEqual(batch['name'], 'Звонки 09.10')
        self.assertEqual(batch['archive_name'], 'Звонки 09.10.ZIP')
        replay = self.import_zip(content, archive_name='renamed.zip').json()
        self.assertEqual(replay['batch_id'], batch['batch_id'])
        self.assertEqual(replay['name'], batch['name'])
        with TestClient(create_app(self.settings)) as restarted:
            detail = restarted.get('/v1/batches/' + batch['batch_id'], headers=self.owner).json()
            self.assertEqual(detail['name'], batch['name'])
            listed = restarted.get('/v1/batches', headers=self.owner).json()['items']
            self.assertEqual(listed[0]['archive_name'], batch['archive_name'])
        second = self.import_zip(content, archive_name='Звонки 09.10.ZIP', upload_id=str(uuid4())).json()
        self.assertEqual(second['name'], batch['name'])
        self.assertNotEqual(second['batch_id'], batch['batch_id'])
        self.fail_processing(batch['batch_id'])
        restored = self.import_zip(content, archive_name='Восстановление.zip').json()
        self.assertEqual(restored['status'], 'ready')
        self.assertEqual(restored['batch_id'], batch['batch_id'])
        self.assertEqual(restored['name'], batch['name'])

    def test_failed_intake_keeps_initial_archive_name_when_fixed(self):
        failed = self.import_zip(zip_bytes([('nested.zip', b'not audio')]), archive_name='Исходный.zip').json()
        self.assertEqual(failed['status'], 'upload_failed')
        fixed = self.import_zip(zip_bytes([('one.wav', b'audio one')]), archive_name='Исправленный.zip').json()
        self.assertEqual(fixed['batch_id'], failed['batch_id'])
        self.assertEqual(fixed['name'], 'Исходный')

    def fail_processing(self, batch_id):
        # A missing stream material fails context loading before any model request.
        material = self.settings.materials_root / self.stream_id / 'knowledge_base'
        unavailable = material.with_name('knowledge_base.disabled')
        material.rename(unavailable)
        env = {**os.environ, 'VOX_DATABASE_PATH': str(self.settings.database_path),
            'VOX_MATERIALS_ROOT': str(self.settings.materials_root),
            'VOX_INPUTS_ROOT': str(self.settings.inputs_root),
            'VOX_WORKER_LOCK': str(self.root / 'worker.lock'),
            'VOX_ADMIN_API_KEY': 'test-admin-key-not-for-production',
            'WHISPER_BASE_URL': 'http://127.0.0.1:1/v1', 'GPL_BASE_URL': 'http://127.0.0.1:1/v1',
            'WHISPER_API_KEY': 'unavailable', 'GPL_API_KEY': 'unavailable'}
        self.client.post('/v1/admin/batches/' + batch_id + '/start', headers=ADMIN).raise_for_status()
        worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            deadline = time.monotonic() + 15
            while self.client.get('/v1/batches/' + batch_id, headers=self.owner).json()['status'] != 'batch_failed':
                self.assertIsNone(worker.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.05)
        finally:
            worker.terminate()
            worker.wait(timeout=10)
            unavailable.rename(material)

    def test_failed_zip_requires_original_composition_and_restores_same_batch_after_restart(self):
        original = zip_bytes([('one.wav', b'audio-one'), ('two.wav', b'audio-two')])
        metadata = b'{"one.wav":{"external_employee_id":"employee-17"}}'
        first = self.import_zip(original, metadata).json()
        bid = first['batch_id']
        calls = [item['call_id'] for item in first['items'] if item['status'] == 'accepted']
        self.fail_processing(bid)
        partial = self.import_zip(zip_bytes([('renamed.wav', b'audio-one')]))
        self.assertEqual(partial.status_code, 409, partial.text)
        self.assertEqual(partial.json()['error']['code'], 'restoration_incomplete')
        self.assertEqual(self.client.get('/v1/batches/' + bid, headers=self.owner).json()['status'], 'restoring')
        self.assertEqual(self.client.post('/v1/admin/batches/' + bid + '/start', headers=ADMIN).status_code, 409)
        changed = self.import_zip(zip_bytes([('new.wav', b'audio-new')]))
        self.assertEqual(changed.status_code, 409, changed.text)
        self.assertEqual(changed.json()['error']['code'], 'composition_conflict')
        conflicting = self.import_zip(original, b'{"one.wav":{"external_employee_id":"changed"}}')
        self.assertEqual(conflicting.status_code, 409, conflicting.text)
        self.assertEqual(conflicting.json()['error']['code'], 'metadata_conflict')
        restored_archive = zip_bytes([('renamed.wav', b'audio-one'), ('two.wav', b'audio-two')])
        with TestClient(create_app(self.settings)) as restarted:
            self.client = restarted
            restored = self.import_zip(restored_archive)
            self.assertEqual(restored.status_code, 200, restored.text)
            body = restored.json()
            self.assertEqual(body['status'], 'ready')
            self.assertEqual(body['batch_id'], bid)
            self.assertEqual(body['upload_id'], self.upload_id)
            self.assertEqual(body['stream_id'], self.stream_id)
            self.assertCountEqual([i['call_id'] for i in body['items'] if i['status'] == 'accepted'], calls)
            self.assertEqual(body['items'][0]['external_employee_id'], 'employee-17')
            repeat = self.import_zip(restored_archive)
            self.assertEqual(repeat.status_code, 200, repeat.text)
            self.assertEqual(repeat.json()['batch_id'], bid)
            self.assertEqual(self.client.get('/v1/batches/' + bid + '/report', headers=self.owner).status_code, 409)
            self.assertEqual(len(self.client.get('/v1/batches', headers=self.owner).json()['items']), 1)

    def test_nested_mixed_archive_creates_ready_batch_with_metadata_and_duplicates(self):
        archive = zip_bytes([('calls/', b''), ('calls/first.unknown', b'audio-first'),
            ('second.wav', b'audio-second'), ('copy.mp3', b'audio-first'), ('broken.mp3', b'broken')])
        metadata = json.dumps({'calls/first.unknown': {'external_employee_id': 'employee-17',
            'called_at': '2026-10-07T10:00:00Z'}}).encode()
        response = self.import_zip(archive, metadata)
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        self.assertEqual(batch['status'], 'ready')
        self.assertEqual(batch['total_calls'], 2)
        self.assertEqual(batch['upload_errors'], 1)
        self.assertEqual(batch['upload_id'], self.upload_id)
        path = '/v1/batches/' + batch['batch_id']
        items = self.client.get(path + '/files', headers=self.owner).json()['items']
        self.assertCountEqual([item['status'] for item in items], ['accepted', 'accepted', 'duplicate', 'rejected'])
        first = next(item for item in items if item['original_name'] == 'calls/first.unknown')
        self.assertEqual(first['external_employee_id'], 'employee-17')
        self.assertEqual(first['called_at'], '2026-10-07T10:00:00Z')
        second = next(item for item in items if item['original_name'] == 'second.wav')
        self.assertIsNone(second['external_employee_id'])
        duplicate = next(item for item in items if item['status'] == 'duplicate')
        self.assertEqual(duplicate['call_id'], first['call_id'])
        self.assertEqual(self.client.get(path + '/report', headers=self.owner).status_code, 409)
        repeated = self.import_zip(archive, metadata)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json()['batch_id'], batch['batch_id'])
        self.assertEqual(repeated.json()['upload_errors'], 1)

    def test_unreadable_empty_and_encrypted_archives_remain_retryable_and_cannot_start(self):
        encrypted = bytearray(zip_bytes([('call.wav', b'audio-first')]))
        for marker, offset in ((b'PK\x03\x04', 6), (b'PK\x01\x02', 8)):
            position = encrypted.index(marker) + offset
            flags = struct.unpack_from('<H', encrypted, position)[0]
            struct.pack_into('<H', encrypted, position, flags | 1)
        unsupported = bytearray(zip_bytes([('call.wav', b'audio-first')]))
        struct.pack_into('<H', unsupported, unsupported.index(b'PK\x01\x02') + 6, 100)
        bad_name = bytearray(zip_bytes([('call.wav', b'audio-first')]))
        header = bad_name.index(b'PK\x01\x02')
        flags = struct.unpack_from('<H', bad_name, header + 8)[0]
        struct.pack_into('<H', bad_name, header + 8, flags | 0x800)
        bad_name[header + 46] = 0xff  # Claimed UTF-8 name cannot be decoded.
        cases = [(b'not a zip', 'invalid_archive'), (zip_bytes([]), 'empty_archive'),
                 (bytes(encrypted), 'encrypted_archive'), (bytes(unsupported), 'invalid_archive'),
                 (bytes(bad_name), 'invalid_archive')]
        for archive, code in cases:
            with self.subTest(code=code):
                self.upload_id = str(uuid4())
                rejected = self.import_zip(archive)
                self.assertEqual(rejected.status_code, 422, rejected.text)
                self.assertEqual(rejected.json()['error']['code'], code)
                batch = rejected.json()['error']['details']['batch']
                self.assertEqual(batch['status'], 'upload_failed')
                self.assertEqual(batch['total_calls'], 0)
                start = self.client.post('/v1/admin/batches/' + batch['batch_id'] + '/start', headers=ADMIN)
                self.assertEqual(start.status_code, 409)
                retried = self.import_zip(zip_bytes([('valid.wav', b'audio-fixed')]))
                self.assertEqual(retried.status_code, 200, retried.text)
                self.assertEqual(retried.json()['batch_id'], batch['batch_id'])
                self.assertEqual(retried.json()['status'], 'ready')

    def test_all_rejected_files_are_reported_without_accepted_calls_or_start(self):
        archive = zip_bytes([('bad.wav', b'bad'), ('nested.zip', zip_bytes([('audio.wav', b'audio')]))])
        response = self.import_zip(archive)
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        self.assertEqual(batch['status'], 'upload_failed')
        self.assertEqual(batch['total_calls'], 0)
        self.assertEqual(batch['upload_errors'], 2)
        self.assertTrue(all(item['status'] == 'rejected' for item in batch['items']))
        repeated = self.import_zip(archive)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json()['upload_errors'], 2)
        self.assertEqual(self.client.post('/v1/admin/batches/' + batch['batch_id'] + '/start', headers=ADMIN).status_code, 409)

    def test_unsafe_paths_and_links_are_rejected_while_safe_audio_survives(self):
        link = zipfile.ZipInfo('calls/link.wav')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        sentinel = self.root / 'outside.wav'
        sentinel.write_bytes(b'keep me')
        unsafe = ['../../outside.wav', '/absolute.wav', 'C:/outside.wav',
                  'calls\\outside.wav', 'calls/../outside.wav']
        entries = [(name, b'audio-unsafe') for name in unsafe]
        entries.extend([(link, b'audio-link'), ('nested/safe.wav', b'audio-safe')])
        response = self.import_zip(zip_bytes(entries))
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        self.assertEqual(batch['status'], 'ready')
        self.assertEqual(batch['total_calls'], 1)
        self.assertEqual(batch['upload_errors'], 6)
        rejected = [item for item in batch['items'] if item['status'] == 'rejected']
        self.assertCountEqual([item['original_name'] for item in rejected], unsafe + ['calls/link.wav'])
        self.assertTrue(all(item['error']['code'] == 'unsafe_archive_entry' for item in rejected))
        self.assertEqual(sentinel.read_bytes(), b'keep me')

    def test_corrupt_entry_does_not_prevent_subsequent_audio_intake(self):
        stored = zipfile.ZipInfo('broken.wav')
        archive = bytearray(zip_bytes([(stored, b'audio-corrupted'), ('valid.wav', b'audio-valid')]))
        position = archive.index(b'audio-corrupted')
        archive[position] ^= 1  # Intact central directory, invalid content CRC for one member.
        response = self.import_zip(bytes(archive))
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        self.assertEqual(batch['status'], 'ready')
        self.assertEqual(batch['total_calls'], 1)
        self.assertEqual(batch['upload_errors'], 1)
        rejected = next(item for item in batch['items'] if item['status'] == 'rejected')
        self.assertEqual(rejected['original_name'], 'broken.wav')
        self.assertEqual(rejected['error']['code'], 'unreadable_archive_entry')

    def test_archive_import_cannot_be_overwritten_or_completed_while_receiving(self):
        entered, released = Event(), Event()
        def delayed_probe(command, **kwargs):
            entered.set()
            if not released.wait(10):
                raise AssertionError('Archive test barrier timed out')
            return subprocess.CompletedProcess(command, 0,
                stdout=b'{"streams":[{"codec_type":"audio"}],"format":{"duration":"2"}}')
        archive = zip_bytes([('first.wav', b'audio-first'), ('second.wav', b'audio-second')])
        with patch('subprocess.run', side_effect=delayed_probe), ThreadPoolExecutor(max_workers=1) as executor:
            pending = executor.submit(self.client.post, '/v1/batch-archives', headers=self.owner,
                files={'archive': ('calls.zip', archive)},
                data={'stream_id': self.stream_id, 'upload_id': self.upload_id})
            try:
                self.assertTrue(entered.wait(5))
                batch = self.client.get('/v1/batches', headers=self.owner).json()['items'][0]
                path = '/v1/batches/' + batch['batch_id']
                complete = self.client.post(path + '/complete', headers=self.owner)
                self.assertEqual(complete.status_code, 409)
                repeated = self.client.post('/v1/batch-archives', headers=self.owner,
                    files={'archive': ('calls.zip', archive)},
                    data={'stream_id': self.stream_id, 'upload_id': self.upload_id})
                self.assertEqual(repeated.status_code, 409, repeated.text)
                self.assertEqual(repeated.json()['error']['code'], 'upload_in_progress')
            finally:
                released.set()
            response = pending.result(timeout=10)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['status'], 'ready')
        self.assertEqual(response.json()['total_calls'], 2)

    def test_invalid_metadata_is_explained_and_can_be_corrected_without_a_new_batch(self):
        archive = zip_bytes([('call.wav', b'audio-first')])
        cases = [b'not json', b'[]', b'{"call.wav":{"unknown":"secret-input"}}',
                 b'{"call.wav":{"external_employee_id":17}}',
                 b'{"call.wav":{"called_at":"yesterday"}}',
                 b'{"../outside.wav":{}}', b'{"call.wav":{},"call.wav":{}}']
        for metadata in cases:
            with self.subTest(metadata=metadata):
                self.upload_id = str(uuid4())
                response = self.import_zip(archive, metadata)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()['error']['code'], 'invalid_metadata')
                self.assertNotIn('secret-input', response.text)
                batch = response.json()['error']['details']['batch']
                self.assertEqual(batch['total_calls'], 0)
                corrected = self.import_zip(archive, b'{"call.wav":{"external_employee_id":"employee-17"}}')
                self.assertEqual(corrected.status_code, 200, corrected.text)
                self.assertEqual(corrected.json()['batch_id'], batch['batch_id'])
                self.assertEqual(corrected.json()['items'][0]['external_employee_id'], 'employee-17')

    def test_closed_archive_repacking_is_idempotent_but_changed_inputs_conflict(self):
        original = zip_bytes([('one.wav', b'audio-one'), ('two.wav', b'audio-two')])
        first = self.import_zip(original)
        self.assertEqual(first.status_code, 201, first.text)
        batch_id = first.json()['batch_id']
        stored = zipfile.ZipInfo('one.wav')
        stored.date_time = (2026, 10, 7, 12, 0, 0)
        repacked = zip_bytes([('two.wav', b'audio-two'), (stored, b'audio-one')])
        self.assertNotEqual(original, repacked)
        repeated = self.import_zip(repacked)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json()['batch_id'], batch_id)
        changed = self.import_zip(zip_bytes([('one.wav', b'audio-new'), ('two.wav', b'audio-two')]))
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()['error']['code'], 'upload_conflict')
        changed_metadata = self.import_zip(original, b'{"one.wav":{"external_employee_id":"different"}}')
        self.assertEqual(changed_metadata.status_code, 409)
        self.assertEqual(self.client.get('/v1/batches/' + batch_id, headers=self.owner).json()['total_calls'], 2)

    def test_interrupted_probe_can_resume_the_same_archive_after_api_restart(self):
        archive = zip_bytes([('one.wav', b'audio-one'), ('two.wav', b'audio-two')])
        valid = subprocess.CompletedProcess([], 0,
            stdout=b'{"streams":[{"codec_type":"audio"}],"format":{"duration":"2"}}')
        with patch('subprocess.run', side_effect=[valid, FileNotFoundError('private path and service detail')]):
            interrupted = self.client.post('/v1/batch-archives', headers=self.owner,
                files={'archive': ('calls.zip', archive)},
                data={'stream_id': self.stream_id, 'upload_id': self.upload_id})
        self.assertEqual(interrupted.status_code, 503, interrupted.text)
        self.assertNotIn('private path', interrupted.text)
        batch = self.client.get('/v1/batches', headers=self.owner).json()['items'][0]
        self.assertEqual(batch['status'], 'uploading')
        self.assertEqual(batch['total_calls'], 1)
        self.assertEqual(batch['upload_errors'], 0)
        path = '/v1/batches/' + batch['batch_id']
        premature = self.client.post(path + '/complete', headers=self.owner)
        self.assertEqual(premature.status_code, 409, premature.text)
        self.assertEqual(premature.json()['error']['code'], 'archive_managed')
        self.assertEqual(self.client.post('/v1/admin/batches/' + batch['batch_id'] + '/start', headers=ADMIN).status_code, 409)
        changed = self.import_zip(zip_bytes([('one.wav', b'audio-one'), ('changed.wav', b'audio-changed')]))
        self.assertEqual(changed.status_code, 409)
        with TestClient(create_app(self.settings)) as restarted:
            self.client = restarted
            resumed = self.import_zip(archive)
        self.assertEqual(resumed.status_code, 200, resumed.text)
        self.assertEqual(resumed.json()['batch_id'], batch['batch_id'])
        self.assertEqual(resumed.json()['status'], 'ready')
        self.assertEqual(resumed.json()['total_calls'], 2)
        self.assertEqual(resumed.json()['upload_errors'], 0)

    def test_archive_keys_streams_and_upload_channels_cannot_change_ownership_or_composition(self):
        archive = zip_bytes([('one.wav', b'audio-one')])
        response = self.import_zip(archive)
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        customer = self.client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'B'}).json()
        other = {'Authorization': 'Bearer ' + customer['api_key']}
        body = {'stream_id': self.stream_id, 'upload_id': self.upload_id}
        denied = self.client.post('/v1/batch-archives', headers=other,
            data=body, files={'archive': ('calls.zip', archive)})
        self.assertEqual(denied.status_code, 404)
        path = '/v1/batches/' + batch['batch_id']
        self.assertEqual(self.client.get(path + '/files', headers=other).status_code, 404)
        self.assertEqual(self.client.post('/v1/batch-archives', headers=ADMIN,
            data=body, files={'archive': ('calls.zip', archive)}).status_code, 403)
        self.assertEqual(self.client.post('/v1/batch-archives',
            data=body, files={'archive': ('calls.zip', archive)}).status_code, 401)
        stream = self.client.post('/v1/admin/customers/' + self.customer_id + '/streams', headers=ADMIN,
            data={'config': json.dumps(stream_config(text_correction_enabled=False,
                unwanted_expressions_enabled=False))}, files={'knowledge_base': ('kb.txt', b'Rules')})
        self.assertEqual(stream.status_code, 201)
        wrong_stream = self.import_zip(archive, stream_id=stream.json()['stream_id'])
        self.assertEqual(wrong_stream.status_code, 409)
        independent = self.import_zip(archive, upload_id=str(uuid4()))
        self.assertEqual(independent.status_code, 201)
        self.assertNotEqual(independent.json()['batch_id'], batch['batch_id'])

    def test_worker_cleans_archive_after_publication_and_keeps_stream_materials(self):
        response = self.import_zip(zip_bytes([('one.wav', b'audio-one'), ('two.wav', b'audio-two')]))
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        batch_id = batch['batch_id']
        archive_path = self.root / 'inputs' / batch_id / 'archive.zip'
        self.assertTrue(archive_path.is_file())
        materials = {path: path.read_bytes() for path in (self.root / 'materials').rglob('*') if path.is_file()}
        for item in batch['items']:
            if item['status'] == 'accepted':
                (self.root / 'inputs' / batch_id / item['call_id']).unlink()
        env = {**os.environ, 'VOX_DATABASE_PATH': str(self.settings.database_path),
            'VOX_MATERIALS_ROOT': str(self.settings.materials_root), 'VOX_INPUTS_ROOT': str(self.settings.inputs_root),
            'VOX_WORKER_LOCK': str(self.root / 'worker.lock'),
            'VOX_ADMIN_API_KEY': 'test-admin-key-not-for-production'}
        started = self.client.post('/v1/admin/batches/' + batch_id + '/start', headers=ADMIN)
        self.assertEqual(started.status_code, 202)
        worker = subprocess.Popen([sys.executable, '-m', 'backend.worker'], env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=Path(__file__).resolve().parents[1])
        try:
            deadline = time.monotonic() + 10
            path = '/v1/batches/' + batch_id
            while self.client.get(path, headers=self.owner).json()['status'] != 'completed':
                self.assertIsNone(worker.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.05)
            while archive_path.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse(archive_path.exists(), 'Published batch archive must be removed')
            report = self.client.get(path + '/report', headers=self.owner).json()
            self.assertEqual(report['processing_errors'], 2)
            self.assertIsNone(report['average_total'])
            self.assertEqual(len(self.client.get(path + '/calls', headers=self.owner).json()['items']), 2)
            self.assertTrue(materials)
            self.assertTrue(all(path.read_bytes() == content for path, content in materials.items()))
        finally:
            worker.terminate()
            try:
                worker.wait(timeout=10)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=10)

    def test_conflicting_duplicate_metadata_rejects_only_that_entry(self):
        archive = zip_bytes([('one.wav', b'audio-one'), ('copy.wav', b'audio-one'),
                             ('two.wav', b'audio-two')])
        metadata = json.dumps({'one.wav': {'external_employee_id': 'employee-17'},
            'copy.wav': {'external_employee_id': 'employee-22'}}).encode()
        response = self.import_zip(archive, metadata)
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        self.assertEqual(batch['status'], 'ready')
        self.assertEqual(batch['total_calls'], 2)
        self.assertEqual(batch['upload_errors'], 1)
        rejected = next(item for item in batch['items'] if item['status'] == 'rejected')
        self.assertEqual(rejected['original_name'], 'copy.wav')
        self.assertEqual(rejected['error']['code'], 'metadata_conflict')
        original = next(item for item in batch['items'] if item['original_name'] == 'one.wav')
        self.assertEqual(original['external_employee_id'], 'employee-17')

    def test_stream_deletion_removes_zip_intake_history_and_preserves_neighbor(self):
        archive = zip_bytes([('one.wav', b'audio-one'), ('copy.wav', b'audio-one'), ('bad.wav', b'bad')])
        response = self.import_zip(archive)
        self.assertEqual(response.status_code, 201, response.text)
        batch = response.json()
        stream = self.client.post('/v1/admin/customers/' + self.customer_id + '/streams', headers=ADMIN,
            data={'config': json.dumps(stream_config(text_correction_enabled=False,
                unwanted_expressions_enabled=False))}, files={'knowledge_base': ('kb.txt', b'Neighbor rules')})
        self.assertEqual(stream.status_code, 201)
        deleted = self.client.delete('/v1/admin/streams/' + self.stream_id, headers=ADMIN)
        self.assertEqual(deleted.status_code, 204, deleted.text)
        path = '/v1/batches/' + batch['batch_id']
        self.assertEqual(self.client.get(path + '/files', headers=self.owner).status_code, 404)
        self.assertEqual(self.client.get('/v1/streams/' + stream.json()['stream_id'], headers=self.owner).status_code, 200)
        self.assertEqual(self.client.get('/v1/customers/' + self.customer_id, headers=self.owner).status_code, 200)
        self.assertFalse((self.root / 'inputs' / batch['batch_id']).exists())

    def test_zip_replay_returns_not_found_if_stream_deleted_before_receiving(self):
        from backend.batches import BatchStore

        archive = zip_bytes([('one.wav', b'audio-one')])
        self.assertEqual(self.import_zip(archive).status_code, 201)
        create = BatchStore.create

        def delete_after_lookup(store, *args, **kwargs):
            result = create(store, *args, **kwargs)
            deleted = self.client.delete('/v1/admin/streams/' + self.stream_id, headers=ADMIN)
            self.assertEqual(deleted.status_code, 204, deleted.text)
            return result

        with patch.object(BatchStore, 'create', delete_after_lookup):
            response = self.import_zip(archive)
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()['error']['code'], 'not_found')
