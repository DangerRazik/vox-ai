import hashlib
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def key_hash(key: str) -> str:
    # Keys have 256 bits of random entropy, not human-chosen password entropy.
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class Database:
    def __init__(self, path: Path):
        self.path = path.resolve()

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 5000")
            connection.execute("PRAGMA journal_mode = WAL")
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        version = sqlite3.sqlite_version_info
        if not (version >= (3, 51, 3) or (3, 50, 7) <= version < (3, 51, 0)):
            raise RuntimeError("SQLite WAL requires 3.51.3+ or patched 3.50.7+ branch")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    api_key_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS streams (
                    id TEXT PRIMARY KEY,
                    customer_id TEXT NOT NULL REFERENCES customers(id),
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    snapshot TEXT NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS streams_customer ON streams(customer_id)")
            connection.execute("""
                CREATE TRIGGER IF NOT EXISTS streams_immutable
                BEFORE UPDATE ON streams BEGIN
                    SELECT RAISE(ABORT, 'Streams are immutable');
                END
            """)
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS batches (
                    id TEXT PRIMARY KEY,
                    stream_id TEXT NOT NULL REFERENCES streams(id),
                    customer_id TEXT NOT NULL REFERENCES customers(id),
                    upload_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    processing_started_at TEXT,
                    processing_finished_at TEXT,
                    summary TEXT,
                    error TEXT,
                    UNIQUE(customer_id, upload_id)
                );
                CREATE TABLE IF NOT EXISTS calls (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL REFERENCES batches(id),
                    original_name TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    external_employee_id TEXT,
                    called_at TEXT,
                    duration_seconds REAL NOT NULL,
                    UNIQUE(batch_id, content_hash)
                );
                CREATE TABLE IF NOT EXISTS call_results (
                    call_id TEXT PRIMARY KEY REFERENCES calls(id),
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS upload_errors (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL REFERENCES batches(id),
                    content_hash TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    code TEXT NOT NULL,
                    UNIQUE(batch_id, content_hash)
                );
                CREATE TABLE IF NOT EXISTS file_duplicates (
                    id TEXT PRIMARY KEY,
                    call_id TEXT NOT NULL REFERENCES calls(id),
                    original_name TEXT NOT NULL,
                    UNIQUE(call_id, original_name)
                );
                CREATE TABLE IF NOT EXISTS active_uploads (
                    id TEXT PRIMARY KEY,
                    batch_id TEXT NOT NULL REFERENCES batches(id)
                );
                CREATE TABLE IF NOT EXISTS batch_archives (
                    batch_id TEXT PRIMARY KEY REFERENCES batches(id),
                    signature TEXT NOT NULL,
                    original_name TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS batch_queue (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL UNIQUE REFERENCES batches(id),
                    accepted_at TEXT NOT NULL,
                    claimed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS restoration_receipts (
                    call_id TEXT PRIMARY KEY REFERENCES calls(id),
                    received_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS input_cleanup (
                    batch_id TEXT PRIMARY KEY REFERENCES batches(id),
                    status TEXT NOT NULL,
                    error TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS deleted_stream_cleanup (
                    stream_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT,
                    PRIMARY KEY (stream_id, kind, target_id)
                );
            """)
            # Upgrade already published batches without touching their analytics.
            connection.execute("INSERT OR IGNORE INTO input_cleanup (batch_id, status, updated_at) "
                               "SELECT id, 'pending', ? FROM batches WHERE status = 'completed'",
                               (datetime.now(timezone.utc).isoformat(),))

    def create_customer(self, name: str):
        key = secrets.token_urlsafe(32)
        customer = {
            "customer_id": str(uuid4()), "name": name,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO customers (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)",
                (customer["customer_id"], name, key_hash(key), customer["created_at"]),
            )
        return {**customer, "api_key": key}

    def customer_for_key(self, key: str):
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id FROM customers WHERE api_key_hash = ?", (key_hash(key),)
            ).fetchone()
        return row["id"] if row else None

    def customers(self, customer_id=None):
        query = "SELECT id AS customer_id, name, created_at FROM customers"
        parameters = ()
        if customer_id is not None:
            query += " WHERE id = ?"
            parameters = (customer_id,)
        query += " ORDER BY created_at, id"
        with self.connection() as connection:
            return [dict(row) for row in connection.execute(query, parameters)]
