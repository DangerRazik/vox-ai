import hashlib
import json
import math
import os
import shutil
import sqlite3
import subprocess
import tempfile
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from filelock import FileLock, Timeout

from backend.database import Database
from backend.streams import StreamStore


def now():
    return datetime.now(timezone.utc).isoformat()


class BatchConflict(ValueError):
    pass


class AudioProbeUnavailable(RuntimeError):
    pass


class UploadRejected(ValueError):
    MESSAGES = {
        'invalid_audio': 'File could not be read as audio',
        'no_audio_stream': 'File contains no audio stream',
        'unsafe_archive_entry': 'Archive entry has an unsafe path or file type',
        'unreadable_archive_entry': 'Archive entry could not be decompressed or verified',
        'metadata_conflict': 'Duplicate metadata differs from the accepted recording',
    }

    def __init__(self, code):
        self.code = code
        super().__init__(self.MESSAGES[code])


class BatchStore:
    def __init__(self, database: Database, streams: StreamStore, root: Path, ffprobe: str):
        self.database = database
        self.streams = streams
        self.root = root.resolve()
        self.ffprobe = ffprobe

    def path(self, batch_id, call_id):
        return self.root / batch_id / call_id

    def require_archive_receipt(self, connection, batch_id, receipt):
        archive = connection.execute('SELECT 1 FROM batch_archives WHERE batch_id = ?', (batch_id,)).fetchone()
        if archive and not connection.execute('SELECT 1 FROM active_uploads WHERE id = ? AND batch_id = ?',
                                             (receipt, batch_id)).fetchone():
            raise BatchConflict('archive_managed')

    def get(self, batch_id, owner=None):
        with self.database.connection() as connection:
            row = connection.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
            if row is None or (owner is not None and row["customer_id"] != owner):
                raise LookupError("Batch not found")
            count = connection.execute("SELECT COUNT(*) FROM calls WHERE batch_id = ?", (batch_id,)).fetchone()[0]
            errors = connection.execute("SELECT COUNT(*) FROM upload_errors WHERE batch_id = ?", (batch_id,)).fetchone()[0]
            cleanup = connection.execute("SELECT status, error, attempts, updated_at FROM input_cleanup "
                                         "WHERE batch_id = ?", (batch_id,)).fetchone()
            archive = connection.execute("SELECT original_name FROM batch_archives WHERE batch_id = ?",
                                         (batch_id,)).fetchone()
        archive_name = archive['original_name'].replace('\\', '/').rsplit('/', 1)[-1].strip() if archive else ''
        name = archive_name[:-4] if archive_name.lower().endswith('.zip') else archive_name
        return {"batch_id": row["id"], "stream_id": row["stream_id"], "customer_id": row["customer_id"],
                "max_total": len(self.streams.get(row['stream_id'])['criteria']),
                "name": name or None, "archive_name": archive_name or None,
                "upload_id": row["upload_id"], "status": row["status"], "total_calls": count, "upload_errors": errors,
                "created_at": row["created_at"], "processing_started_at": row["processing_started_at"],
                "processing_finished_at": row["processing_finished_at"], "error": row["error"],
                "cleanup": dict(cleanup) if cleanup else None}

    def list(self, owner=None, stream_id=None, status=None):
        query = "SELECT id FROM batches WHERE 1=1"
        parameters = []
        for column, value in (("customer_id", owner), ("stream_id", stream_id), ("status", status)):
            if value is not None:
                query += f" AND {column} = ?"
                parameters.append(value)
        with self.database.connection() as connection:
            ids = [row[0] for row in connection.execute(query + " ORDER BY created_at, id", parameters)]
        return [self.get(batch_id, owner) for batch_id in ids]

    def create(self, owner, stream_id, upload_id):
        self.streams.get(stream_id, owner)
        batch_id = str(uuid4())
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if not connection.execute('SELECT 1 FROM streams WHERE id = ? AND customer_id = ?',
                                      (stream_id, owner)).fetchone():
                raise LookupError('Stream not found')
            existing = connection.execute(
                "SELECT id, stream_id FROM batches WHERE customer_id = ? AND upload_id = ?", (owner, upload_id),
            ).fetchone()
            if existing:
                if existing["stream_id"] != stream_id:
                    raise BatchConflict("upload_conflict")
                batch_id = existing["id"]
                # Only a new recovery cycle clears receipts. Idempotent repeats
                # while restoring must preserve already accepted original files.
                row = connection.execute("SELECT status FROM batches WHERE id = ?", (batch_id,)).fetchone()
                if row is None:
                    raise LookupError('Batch not found')
                state = row[0]
                if state == "batch_failed":
                    connection.execute("DELETE FROM restoration_receipts WHERE call_id IN "
                                       "(SELECT id FROM calls WHERE batch_id = ?)", (batch_id,))
                    connection.execute("UPDATE batches SET status = 'restoring' WHERE id = ?", (batch_id,))
            else:
                connection.execute("INSERT INTO batches (id, stream_id, customer_id, upload_id, status, created_at) "
                                   "VALUES (?, ?, ?, ?, 'uploading', ?)", (batch_id, stream_id, owner, upload_id, now()))
        return self.get(batch_id, owner), existing is None

    def add(self, batch_id, owner, upload, name, employee=None, called_at=None, *, archive_receipt=None):
        self.get(batch_id, owner)
        with self.input_lock(batch_id):
            return self._add(batch_id, owner, upload, name, employee, called_at, archive_receipt=archive_receipt)

    def input_lock(self, batch_id):
        # Outside batch inputs: cleanup must never unlink an active lock file.
        directory = self.root.parent / f'{self.root.name}-locks'
        directory.mkdir(parents=True, exist_ok=True)
        return FileLock(str(directory / f'{batch_id}.lock'), timeout=120)

    def _add(self, batch_id, owner, upload, name, employee=None, called_at=None, *, archive_receipt=None):
        self.get(batch_id, owner)
        receipt = str(uuid4())
        with self.database.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT status FROM batches WHERE id = ?', (batch_id,)).fetchone()
            if row is None:
                raise LookupError('Batch not found')
            state = row[0]
            if state not in ('uploading', 'restoring', 'completed'):
                raise BatchConflict('upload_closed')
            self.require_archive_receipt(connection, batch_id, archive_receipt)
            connection.execute('INSERT INTO active_uploads VALUES (?, ?)', (receipt, batch_id))
        directory = self.root / batch_id if state in ('uploading', 'restoring') else None
        temporary = None
        final = None
        try:
            if directory is not None:
                directory.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with tempfile.NamedTemporaryFile(dir=directory, delete=False) as output:
                temporary = Path(output.name)
                while chunk := upload.read(1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
                output.flush()
                os.fsync(output.fileno())
            try:
                probe = subprocess.run(
                    [self.ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(temporary)],
                    capture_output=True, timeout=60, check=False,
                )
            except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired) as exc:
                raise AudioProbeUnavailable("audio_probe_unavailable") from exc
            if probe.returncode:
                self.reject_file(batch_id, digest.hexdigest(), name, 'invalid_audio')
            try:
                info = json.loads(probe.stdout)
                has_audio = any(stream.get('codec_type') == 'audio' for stream in info.get('streams', []))
                duration = float(info.get('format', {}).get('duration', 0))
                if not math.isfinite(duration) or duration < 0:
                    raise ValueError('Invalid duration')
            except (ValueError, TypeError, AttributeError):
                self.reject_file(batch_id, digest.hexdigest(), name, 'invalid_audio')
            if not has_audio:
                self.reject_file(batch_id, digest.hexdigest(), name, 'no_audio_stream')
            call_id = str(uuid4())
            with self.database.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute("SELECT status FROM batches WHERE id = ?", (batch_id,)).fetchone()
                if row is None:
                    raise LookupError('Batch not found')
                state = row[0]
                existing = connection.execute("SELECT * FROM calls WHERE batch_id = ? AND content_hash = ?",
                                              (batch_id, digest.hexdigest())).fetchone()
                if state not in ("uploading", "restoring", "completed"):
                    raise BatchConflict("upload_closed")
                if state != "uploading" and existing is None:
                    raise BatchConflict("composition_conflict")
                if existing:
                    if ((employee is not None and employee != existing["external_employee_id"]) or
                            (called_at is not None and called_at != existing["called_at"])):
                        raise BatchConflict("metadata_conflict")
                    if state in ('uploading', 'restoring') and name != existing['original_name']:
                        connection.execute('INSERT OR IGNORE INTO file_duplicates VALUES (?, ?, ?)',
                                           (str(uuid4()), existing['id'], name))
                    if state == "restoring":
                        # Replace only with hash-identical input; a rollback leaves
                        # identical bytes, never deletes the preserved original.
                        os.replace(temporary, self.path(batch_id, existing["id"]))
                        connection.execute("INSERT OR IGNORE INTO restoration_receipts VALUES (?, ?)",
                                           (existing["id"], now()))
                    return {"call_id": existing["id"], "duplicate": True}, False
                final = self.path(batch_id, call_id)
                os.replace(temporary, final)
                connection.execute("INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   (call_id, batch_id, name, digest.hexdigest(), employee, called_at, duration))
            final = None  # Now owned by the committed call, not by this request.
            return {"call_id": call_id, "duplicate": False}, True
        finally:
            try:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
                if final is not None:
                    final.unlink(missing_ok=True)
            finally:
                with self.database.connection() as connection:
                    connection.execute('DELETE FROM active_uploads WHERE id = ?', (receipt,))

    def reject_file(self, batch_id, content_hash, name, code):
        with self.database.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT status FROM batches WHERE id = ?', (batch_id,)).fetchone()
            if row is None:
                raise LookupError('Batch not found')
            state = row[0]
            if state not in ('uploading', 'restoring'):
                raise BatchConflict('upload_closed')
            connection.execute('INSERT OR IGNORE INTO upload_errors VALUES (?, ?, ?, ?, ?)',
                               (str(uuid4()), batch_id, content_hash, name, code))
        raise UploadRejected(code)

    def files(self, batch_id, owner=None):
        self.get(batch_id, owner)
        accepted = [{**call, 'status': 'accepted', 'error': None} for call in self.calls(batch_id, owner)]
        with self.database.connection() as connection:
            rejected = connection.execute('SELECT id, original_name, code FROM upload_errors WHERE batch_id = ? ORDER BY rowid',
                                          (batch_id,)).fetchall()
            duplicates = connection.execute('SELECT d.id, d.call_id, d.original_name, c.original_name AS duplicate_of '
                'FROM file_duplicates d JOIN calls c ON c.id = d.call_id WHERE c.batch_id = ? ORDER BY d.rowid',
                (batch_id,)).fetchall()
        return accepted + [{**dict(row), 'status': 'duplicate', 'error': None} for row in duplicates] + [
                           {'file_id': row['id'], 'original_name': row['original_name'],
                            'status': 'rejected', 'error': {'code': row['code'],
                            'message': UploadRejected.MESSAGES[row['code']]}} for row in rejected]

    def complete(self, batch_id, owner, *, archive_receipt=None):
        self.get(batch_id, owner)
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT status FROM batches WHERE id = ?", (batch_id,)).fetchone()
            if row is None:
                raise LookupError('Batch not found')
            state = row[0]
            if state in ('uploading', 'restoring'):
                if connection.execute('SELECT 1 FROM active_uploads WHERE batch_id = ? AND id != ? LIMIT 1',
                                      (batch_id, archive_receipt or '')).fetchone():
                    raise BatchConflict('upload_in_progress')
                self.require_archive_receipt(connection, batch_id, archive_receipt)
            if state == "uploading":
                count = connection.execute("SELECT COUNT(*) FROM calls WHERE batch_id = ?", (batch_id,)).fetchone()[0]
                if not count:
                    raise BatchConflict("empty_batch")
                connection.execute("UPDATE batches SET status = 'ready' WHERE id = ?", (batch_id,))
            elif state == "restoring":
                missing = connection.execute(
                    "SELECT COUNT(*) FROM calls c WHERE c.batch_id = ? AND NOT EXISTS "
                    "(SELECT 1 FROM restoration_receipts r WHERE r.call_id = c.id)", (batch_id,),
                ).fetchone()[0]
                if missing:
                    raise BatchConflict("restoration_incomplete")
                connection.execute("UPDATE batches SET status = 'ready' WHERE id = ?", (batch_id,))
            elif state not in ("ready", "queued", "processing", "completed"):
                raise BatchConflict("batch_not_ready")
        return self.get(batch_id, owner)

    def start(self, batch_id):
        self.get(batch_id)
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT status FROM batches WHERE id = ?", (batch_id,)).fetchone()
            if row is None:
                raise LookupError('Batch not found')
            state = row[0]
            if state == "ready":
                connection.execute("INSERT INTO batch_queue (batch_id, accepted_at) VALUES (?, ?)",
                                   (batch_id, now()))
                connection.execute("UPDATE batches SET status = 'queued', error = NULL, summary = NULL, "
                                   "processing_started_at = NULL, processing_finished_at = NULL WHERE id = ?", (batch_id,))
            elif state not in ("queued", "processing", "completed"):
                raise BatchConflict("batch_not_ready")
        return self.get(batch_id), state == "ready"

    def claim_next(self, expected_batch_id=None):
        """Claim the oldest accepted start and transition it in one short transaction."""
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM batches WHERE status = 'processing'").fetchone():
                return None
            row = connection.execute(
                "SELECT q.batch_id FROM batch_queue q JOIN batches b ON b.id = q.batch_id "
                "WHERE b.status = 'queued' AND q.claimed_at IS NULL ORDER BY q.sequence LIMIT 1",
            ).fetchone()
            if row is None or (expected_batch_id is not None and row[0] != expected_batch_id):
                return None
            started = now()
            connection.execute("UPDATE batch_queue SET claimed_at = ? WHERE batch_id = ?", (started, row[0]))
            connection.execute("UPDATE batches SET status = 'processing', processing_started_at = ? "
                               "WHERE id = ? AND status = 'queued'", (started, row[0]))
            return row[0]

    @property
    def processing_lock(self):
        # One canonical lock per database, independent of configurable worker paths.
        return FileLock(str(self.database.path) + '.worker.lock', timeout=0)

    def recover_interrupted(self):
        """Worker startup only, after acquiring processing_lock for its lifetime."""
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("UPDATE batches SET status = 'batch_failed', error = 'worker_interrupted', "
                               "processing_finished_at = ? WHERE status = 'processing'", (now(),))
            # Pre-08 queued rows have no accepted-start order. Never fabricate FIFO.
            connection.execute("UPDATE batches SET status = 'batch_failed', error = 'queue_order_unavailable', "
                               "processing_finished_at = ? WHERE status = 'queued' AND NOT EXISTS "
                               "(SELECT 1 FROM batch_queue WHERE batch_id = batches.id)", (now(),))
            connection.execute("DELETE FROM batch_queue WHERE batch_id IN "
                               "(SELECT id FROM batches WHERE status IN ('batch_failed', 'completed'))")

    def calls(self, batch_id, owner=None):
        batch = self.get(batch_id, owner)
        with self.database.connection() as connection:
            rows = connection.execute("SELECT id AS call_id, batch_id, original_name, external_employee_id, "
                                      "called_at, duration_seconds FROM calls WHERE batch_id = ? ORDER BY rowid",
                                      (batch_id,)).fetchall()
        return [{**dict(row), "stream_id": batch["stream_id"]} for row in rows]

    def report(self, batch_id, owner=None):
        batch = self.get(batch_id, owner)
        if batch["status"] != "completed":
            raise BatchConflict("report_not_available")
        with self.database.connection() as connection:
            return json.loads(connection.execute("SELECT summary FROM batches WHERE id = ?", (batch_id,)).fetchone()[0])

    def compare(self, stream_id, batch_ids, owner=None):
        ids = list(dict.fromkeys(batch_ids))
        with self.database.connection() as connection:
            # One read snapshot: publication or deletion cannot split the selection.
            connection.execute('BEGIN')
            stream = connection.execute('SELECT customer_id FROM streams WHERE id = ?', (stream_id,)).fetchone()
            if stream is None or (owner is not None and stream['customer_id'] != owner):
                raise LookupError('Stream not found')
            rows = []
            for batch_id in ids:
                row = connection.execute('SELECT customer_id, stream_id, status, summary FROM batches WHERE id = ?',
                                         (batch_id,)).fetchone()
                if row is None or (owner is not None and row['customer_id'] != owner):
                    raise LookupError('Batch not found')
                rows.append(row)
            for row in rows:
                if row['stream_id'] != stream_id:
                    raise BatchConflict('comparison_stream_mismatch')
                if row['status'] != 'completed' or row['summary'] is None:
                    raise BatchConflict('report_not_available')
            return {'stream_id': stream_id, 'items': [json.loads(row['summary']) for row in rows]}

    def dashboard(self, stream_id, owner=None):
        with self.database.connection() as connection:
            connection.execute('BEGIN')
            stream = connection.execute('SELECT customer_id FROM streams WHERE id = ?', (stream_id,)).fetchone()
            if stream is None or (owner is not None and stream['customer_id'] != owner):
                raise LookupError('Stream not found')
            rows = connection.execute("SELECT summary FROM batches WHERE stream_id = ? AND customer_id = ? "
                                      "AND status = 'completed' AND summary IS NOT NULL "
                                      "ORDER BY processing_finished_at, id",
                                      (stream_id, stream['customer_id'])).fetchall()
            return {'stream_id': stream_id, 'items': [json.loads(row['summary']) for row in rows]}

    def call_report(self, call_id, owner=None):
        with self.database.connection() as connection:
            row = connection.execute("SELECT batch_id FROM calls WHERE id = ?", (call_id,)).fetchone()
        if row is None:
            raise LookupError("Call not found")
        self.report(row[0], owner)
        metadata = next(call for call in self.calls(row[0], owner) if call["call_id"] == call_id)
        with self.database.connection() as connection:
            result = connection.execute("SELECT * FROM call_results WHERE call_id = ?", (call_id,)).fetchone()
        return {**metadata, "status": result["status"], "result": json.loads(result["result"]) if result["result"] else None,
                "error": result["error"]}

    def process(self, batch_id):
        """Direct processing uses the same OS lock and FIFO as the worker."""
        try:
            with self.processing_lock:
                claimed = self.claim_next(batch_id)
                return self._process_claimed(claimed) if claimed else False
        except Timeout:
            return False

    def _process_claimed(self, batch_id):
        # Caller owns processing_lock; model requests never hold a DB transaction.
        from pipeline import process_call

        try:
            batch = self.get(batch_id)
            context = self.streams.load_context(batch["stream_id"], batch["customer_id"])
            calls = self.calls(batch_id)
            outcomes = []
            for call in calls:
                try:
                    result = process_call(str(self.path(batch_id, call["call_id"])), context=context)
                    outcomes.append((call["call_id"], "successful", result, None))
                except Exception:
                    # No service responses, secrets or local paths in public errors.
                    outcomes.append((call["call_id"], "processing_error", None, "call_processing_failed"))
            finished = now()
            successful = [outcome[2] for outcome in outcomes if outcome[2] is not None]
            count = len(successful)
            critical = sum(result["critical_violation"] for result in successful)
            summary = {"batch_id": batch_id, "stream_id": batch["stream_id"], "total_calls": len(calls),
                       "successful_calls": count, "processing_errors": len(calls) - count, "upload_errors": batch['upload_errors'],
                       "average_total": round(sum(r["total"] for r in successful) / count, 2) if count else None,
                       "max_total": len(context.enabled_criteria),
                       "criterion_averages": {cid: round(sum(r["scores"][cid]["score"] for r in successful) / count, 2)
                                              if count else None for cid in context.enabled_criteria},
                       "critical_violation_count": critical, "critical_violation_rate": critical / count if count else None,
                       "processing_started_at": batch["processing_started_at"], "processing_finished_at": finished,
                       "processing_duration_seconds": (datetime.fromisoformat(finished) -
                                                       datetime.fromisoformat(batch["processing_started_at"])).total_seconds()}
            with self.database.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for call_id, status, result, error in outcomes:
                    connection.execute("INSERT INTO call_results VALUES (?, ?, ?, ?)",
                                       (call_id, status, json.dumps(result, ensure_ascii=False, allow_nan=False) if result else None, error))
                updated = connection.execute("UPDATE batches SET status = 'completed', summary = ?, processing_finished_at = ? "
                                             "WHERE id = ? AND status = 'processing'",
                                             (json.dumps(summary, allow_nan=False), finished, batch_id)).rowcount
                if updated != 1:
                    raise BatchConflict("publication_conflict")
                connection.execute("DELETE FROM batch_queue WHERE batch_id = ?", (batch_id,))
                connection.execute("INSERT INTO input_cleanup (batch_id, status, updated_at) VALUES (?, 'pending', ?)",
                                   (batch_id, finished))
        except Exception:
            with self.database.connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("UPDATE batches SET status = 'batch_failed', error = 'batch_processing_failed' "
                                   "WHERE id = ? AND status = 'processing'", (batch_id,))
                connection.execute("DELETE FROM batch_queue WHERE batch_id = ?", (batch_id,))
            return False
        # Outside publication's exception scope: cleanup never changes analytics.
        self.cleanup_pending(batch_id)
        return True

    def cleanup_pending(self, batch_id=None):
        """Retry only published batches. Never calls the processing pipeline."""
        with self.database.connection() as connection:
            query = ("SELECT c.batch_id FROM input_cleanup c JOIN batches b ON b.id = c.batch_id "
                     "WHERE c.status = 'pending' AND b.status = 'completed'")
            parameters = ()
            if batch_id is not None:
                query += " AND c.batch_id = ?"
                parameters = (batch_id,)
            ids = [row[0] for row in connection.execute(query, parameters)]
        for bid in ids:
            error = None
            try:
                with self.input_lock(bid):
                    directory = self.root / bid
                    # No configured path or directory link may redirect deletion
                    # into another batch, materials or outside managed inputs.
                    if (directory.parent != self.root or directory.resolve() != directory or
                            directory.is_symlink() or directory.is_junction()):
                        raise ValueError('unsafe cleanup target')
                    try:
                        shutil.rmtree(directory)
                    except FileNotFoundError:
                        if directory.exists():
                            raise  # Missing child, not an already absent batch directory.
            except PermissionError:
                error = 'input_cleanup_permission_denied'
            except (OSError, Timeout):
                error = 'input_cleanup_io_failed'
            except ValueError:
                error = 'input_cleanup_unsafe_path'
            try:
                with self.database.connection() as connection:
                    connection.execute("UPDATE input_cleanup SET status = ?, error = ?, attempts = attempts + 1, "
                                       "updated_at = ? WHERE batch_id = ? AND status = 'pending'",
                                       ('pending' if error else 'completed', error, now(), bid))
            except sqlite3.Error:
                # Intent survives acknowledgement failure, so another pass is safe.
                continue

    def delete_stream(self, stream_id):
        """Delete history and register independent filesystem intents atomically."""
        with ExitStack() as locks, self.database.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            if not connection.execute('SELECT 1 FROM streams WHERE id = ?', (stream_id,)).fetchone():
                raise LookupError('Stream not found')
            rows = connection.execute('SELECT id, status FROM batches WHERE stream_id = ?', (stream_id,)).fetchall()
            for row in rows:
                if connection.execute('SELECT 1 FROM active_uploads WHERE batch_id = ?', (row['id'],)).fetchone():
                    raise BatchConflict('resource_busy')
                if row['status'] in ('processing', 'uploading', 'restoring'):
                    raise BatchConflict('resource_busy')
                lock = self.input_lock(row['id'])
                try:
                    locks.enter_context(lock.acquire(timeout=0))
                except Timeout:
                    raise BatchConflict('resource_busy') from None
            connection.execute("INSERT INTO deleted_stream_cleanup (stream_id, kind, target_id) VALUES (?, 'materials', ?)",
                               (stream_id, stream_id))
            for row in rows:
                bid = row['id']
                connection.execute("INSERT INTO deleted_stream_cleanup (stream_id, kind, target_id) VALUES (?, 'inputs', ?)",
                                   (stream_id, bid))
                for table in ('call_results', 'restoration_receipts', 'file_duplicates'):
                    connection.execute(f'DELETE FROM {table} WHERE call_id IN (SELECT id FROM calls WHERE batch_id = ?)', (bid,))
                for table in ('batch_queue', 'input_cleanup', 'upload_errors', 'active_uploads', 'batch_archives', 'calls'):
                    connection.execute(f'DELETE FROM {table} WHERE batch_id = ?', (bid,))
                connection.execute('DELETE FROM batches WHERE id = ?', (bid,))
            connection.execute('DELETE FROM streams WHERE id = ?', (stream_id,))
        self.cleanup_deleted_streams()

    def cleanup_deleted_streams(self):
        with self.database.connection() as connection:
            jobs = connection.execute("SELECT * FROM deleted_stream_cleanup WHERE status = 'pending'").fetchall()
        for job in jobs:
            error = None
            root = self.root if job['kind'] == 'inputs' else self.streams.root
            directory = root / job['target_id']
            try:
                with ExitStack() as locks:
                    if job['kind'] == 'inputs':
                        locks.enter_context(self.input_lock(job['target_id']))
                    if (directory.parent != root or directory.resolve() != directory or
                            directory.is_symlink() or directory.is_junction()):
                        raise ValueError('unsafe cleanup target')
                    try:
                        shutil.rmtree(directory)
                    except FileNotFoundError:
                        if directory.exists():
                            raise
            except PermissionError:
                error = 'stream_cleanup_permission_denied'
            except (OSError, Timeout):
                error = 'stream_cleanup_io_failed'
            except ValueError:
                error = 'stream_cleanup_unsafe_path'
            try:
                with self.database.connection() as connection:
                    connection.execute('UPDATE deleted_stream_cleanup SET status = ?, error = ? '
                                       "WHERE stream_id = ? AND kind = ? AND target_id = ? AND status = 'pending'",
                                       ('pending' if error else 'completed', error, job['stream_id'], job['kind'], job['target_id']))
            except sqlite3.Error:
                continue
