import hashlib
import json
import os
import shutil
import stat
import tempfile
import zipfile
import zlib
from contextlib import contextmanager
from datetime import datetime
from uuid import uuid4

from backend.batches import AudioProbeUnavailable, BatchConflict, UploadRejected


def safe_archive_path(name):
    return bool(name and not any(char in name for char in ('\\', ':', '\x00'))
        and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.split('/')))


def parse_metadata(upload):
    if upload is None:
        return {}

    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError('Duplicate metadata key')
            value[key] = item
        return value

    metadata = json.loads(upload.read().decode('utf-8-sig'), object_pairs_hook=unique_pairs)
    if not isinstance(metadata, dict):
        raise ValueError('Metadata must be an object')
    for path, fields in metadata.items():
        if not safe_archive_path(path) or not isinstance(fields, dict):
            raise ValueError('Invalid metadata path or fields')
        if fields.keys() - {'external_employee_id', 'called_at'}:
            raise ValueError('Unknown metadata field')
        if any(value is not None and not isinstance(value, str) for value in fields.values()):
            raise ValueError('Metadata values must be strings or null')
        if fields.get('called_at') is not None:
            if datetime.fromisoformat(fields['called_at']).tzinfo is None:
                raise ValueError('Date must include a timezone')
    return metadata


def archive_signature(archive, metadata):
    items = [item for item in archive.infolist() if not item.is_dir()]
    if not items:
        raise ValueError('empty_archive')
    if any(item.flag_bits & 1 for item in archive.infolist()):
        raise ValueError('encrypted_archive')
    if metadata.keys() - {item.filename for item in items}:
        raise ValueError('invalid_metadata')
    manifest = []
    for item in items:
        digest = hashlib.sha256()
        try:
            with archive.open(item) as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
            content = digest.hexdigest()
        except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error):
            content = f'unreadable:{item.CRC}:{item.file_size}'
        manifest.append((item.orig_filename, content, stat.S_IFMT(item.external_attr >> 16)))
    return hashlib.sha256(json.dumps([sorted(manifest), metadata], sort_keys=True).encode()).hexdigest()


class ArchiveRejected(ValueError):
    MESSAGES = {
        'invalid_archive': 'Archive could not be read as ZIP',
        'empty_archive': 'Archive contains no files',
        'encrypted_archive': 'Password-protected archives are not supported',
        'invalid_metadata': 'Metadata must map archive paths to employee/date fields',
    }

    def __init__(self, code, batch):
        self.code = code
        self.batch = batch
        super().__init__(self.MESSAGES[code])


class ArchiveStore:
    def __init__(self, batches):
        self.batches = batches

    @contextmanager
    def receiving(self, batch_id):
        receipt = None
        with self.batches.database.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if connection.execute('SELECT 1 FROM active_uploads WHERE batch_id = ?', (batch_id,)).fetchone():
                raise BatchConflict('upload_in_progress')
            row = connection.execute('SELECT status FROM batches WHERE id = ?', (batch_id,)).fetchone()
            if row is None:
                raise LookupError('Batch not found')
            state = row[0]
            if state in ('uploading', 'upload_failed', 'restoring'):
                existing = connection.execute('SELECT 1 FROM batch_archives WHERE batch_id = ?', (batch_id,)).fetchone()
                if not existing and connection.execute('SELECT 1 FROM calls WHERE batch_id = ?', (batch_id,)).fetchone():
                    raise BatchConflict('upload_conflict')
                if state == 'upload_failed':
                    connection.execute("UPDATE batches SET status = 'uploading', error = NULL WHERE id = ?", (batch_id,))
                    connection.execute('DELETE FROM upload_errors WHERE batch_id = ?', (batch_id,))
                receipt = str(uuid4())
                connection.execute('INSERT INTO active_uploads VALUES (?, ?)', (receipt, batch_id))
                connection.execute('INSERT OR IGNORE INTO batch_archives VALUES (?, ?, ?)', (batch_id, '', ''))
        try:
            yield receipt
        finally:
            if receipt:
                with self.batches.database.connection() as connection:
                    connection.execute('DELETE FROM active_uploads WHERE id = ?', (receipt,))

    def save_signature(self, batch_id, signature, name):
        with self.batches.database.connection() as connection:
            connection.execute("UPDATE batch_archives SET signature = ?, original_name = "
                "CASE WHEN original_name = '' THEN ? ELSE original_name END WHERE batch_id = ?",
                (signature, name, batch_id))

    def fail(self, batch_id, owner, code):
        with self.batches.database.connection() as connection:
            connection.execute("UPDATE batches SET status = CASE WHEN EXISTS "
                "(SELECT 1 FROM calls WHERE batch_id = batches.id) THEN 'uploading' ELSE 'upload_failed' END, "
                "error = ? WHERE id = ? AND status = 'uploading'",
                (code, batch_id))
        return self.batches.get(batch_id, owner)

    def reject_entry(self, batch_id, item, code):
        identity = hashlib.sha256(json.dumps(
            [code, item.orig_filename, item.CRC, item.file_size]).encode()).hexdigest()
        try:
            self.batches.reject_file(batch_id, identity, item.orig_filename, code)
        except UploadRejected:
            pass

    def import_zip(self, owner, stream_id, upload_id, upload, name, metadata=None):
        batch, created = self.batches.create(owner, stream_id, upload_id)
        batch_id = batch['batch_id']
        with self.receiving(batch_id) as receipt, tempfile.TemporaryFile() as incoming:
            if receipt:
                with self.batches.database.connection() as connection:
                    connection.execute("UPDATE batch_archives SET original_name = ? "
                        "WHERE batch_id = ? AND original_name = ''", (name, batch_id))
            while chunk := upload.read(1024 * 1024):
                incoming.write(chunk)
            incoming.seek(0)
            try:
                parsed_metadata = parse_metadata(metadata)
            except ValueError:
                raise ArchiveRejected('invalid_metadata', self.fail(batch_id, owner, 'invalid_metadata'))
            with self.batches.database.connection() as connection:
                prior = connection.execute('SELECT signature FROM batch_archives WHERE batch_id = ?',
                    (batch_id,)).fetchone()
            try:
                with zipfile.ZipFile(incoming) as archive:
                    try:
                        signature = archive_signature(archive, parsed_metadata)
                    except ValueError as exc:
                        if receipt is None:
                            raise BatchConflict('upload_conflict')
                        code = str(exc)
                        raise ArchiveRejected(code, self.fail(batch_id, owner, code))
                    if receipt is None:
                        if prior is None or prior['signature'] != signature:
                            raise BatchConflict('upload_conflict')
                        return {**self.batches.get(batch_id, owner), 'items': self.batches.files(batch_id, owner)}, False
                    restoring = batch['status'] == 'restoring'
                    if not restoring and prior['signature'] and prior['signature'] != signature and self.batches.get(batch_id, owner)['total_calls']:
                        raise BatchConflict('upload_conflict')
                    directory = self.batches.root / batch_id
                    directory.mkdir(parents=True, exist_ok=True)
                    incoming.seek(0)
                    with (directory / 'archive.zip').open('wb') as output:
                        shutil.copyfileobj(incoming, output)
                        output.flush()
                        os.fsync(output.fileno())
                    if not restoring:
                        self.save_signature(batch_id, signature, name)
                    items = [item for item in archive.infolist() if not item.is_dir()]
                    for item in items:
                        fields = parsed_metadata.get(item.filename, {})
                        try:
                            mode = stat.S_IFMT(item.external_attr >> 16)
                            if not safe_archive_path(item.orig_filename) or mode not in (0, stat.S_IFREG):
                                self.reject_entry(batch_id, item, 'unsafe_archive_entry')
                                continue
                            with archive.open(item) as audio:
                                self.batches.add(batch_id, owner, audio, item.filename,
                                    fields.get('external_employee_id'), fields.get('called_at'), archive_receipt=receipt)
                        except UploadRejected:
                            continue
                        except BatchConflict as exc:
                            if restoring or str(exc) != 'metadata_conflict':
                                raise
                            self.reject_entry(batch_id, item, 'metadata_conflict')
                        except AudioProbeUnavailable:
                            raise
                        except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, zlib.error):
                            self.reject_entry(batch_id, item, 'unreadable_archive_entry')
            except (zipfile.BadZipFile, NotImplementedError, UnicodeError, EOFError):
                if receipt is None:
                    raise BatchConflict('upload_conflict')
                raise ArchiveRejected('invalid_archive', self.fail(batch_id, owner, 'invalid_archive'))
            if self.batches.get(batch_id, owner)['total_calls']:
                batch = self.batches.complete(batch_id, owner, archive_receipt=receipt)
                if restoring:
                    # Only the successfully restored ZIP becomes the idempotent replay manifest.
                    self.save_signature(batch_id, signature, name)
            else:
                batch = self.fail(batch_id, owner, 'no_accepted_records')
        return {**batch, 'items': self.batches.files(batch_id, owner)}, created
