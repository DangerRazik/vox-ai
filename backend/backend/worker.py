"""Sequential durable FIFO worker; recovery requires exclusive OS ownership."""
import time

from filelock import FileLock, Timeout

from backend.batches import BatchStore
from backend.config import BackendSettings
from backend.database import Database
from backend.streams import StreamStore


def main():
    settings = BackendSettings()
    settings.worker_lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        with FileLock(str(settings.worker_lock.resolve()), timeout=0):
            database = Database(settings.database_path)
            database.initialize()
            streams = StreamStore(database, settings.materials_root)
            batches = BatchStore(database, streams, settings.inputs_root, settings.ffprobe_path)
            with batches.processing_lock:
                batches.recover_interrupted()
                next_cleanup = 0
                while True:
                    if time.monotonic() >= next_cleanup:
                        batches.cleanup_pending()
                        batches.cleanup_deleted_streams()
                        next_cleanup = time.monotonic() + 5
                    batch_id = batches.claim_next()
                    if batch_id:
                        batches._process_claimed(batch_id)
                    else:
                        time.sleep(0.5)
    except Timeout:
        raise SystemExit("Another worker holds the lock")


if __name__ == "__main__":
    main()