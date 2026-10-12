"""Opt-in HTTP acceptance check against a real Uvicorn process and temporary DB."""
import os
import secrets
from contextlib import closing
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


def main():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "acceptance.sqlite3"
        admin_key = secrets.token_urlsafe(32)
        env = {**os.environ, "VOX_ADMIN_API_KEY": admin_key, "VOX_DATABASE_PATH": str(path)}
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        admin = {"Authorization": f"Bearer {admin_key}"}
        customers = []
        for attempt in range(2):
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "backend.api:create_app", "--factory",
                 "--host", "127.0.0.1", "--port", str(port), "--no-access-log"],
                cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=5) as client:
                    deadline = time.monotonic() + 15
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError("API process exited before readiness")
                        try:
                            response = client.get("/v1/admin/customers", headers=admin)
                            response.raise_for_status()
                            break
                        except httpx.ConnectError:
                            if time.monotonic() >= deadline:
                                raise RuntimeError("API readiness timed out")
                            time.sleep(0.1)
                    if attempt == 0:
                        for name in ("Organization A", "Organization B"):
                            response = client.post("/v1/admin/customers", headers=admin, json={"name": name})
                            assert response.status_code == 201
                            customers.append(response.json())
                    assert len(client.get("/v1/admin/customers", headers=admin).json()["items"]) == 2
                    for own, other in (customers, customers[::-1]):
                        headers = {"Authorization": f"Bearer {own['api_key']}"}
                        assert client.get(f"/v1/customers/{own['customer_id']}", headers=headers).status_code == 200
                        assert client.get(f"/v1/customers/{other['customer_id']}", headers=headers).status_code == 404
                        assert client.get("/v1/admin/customers", headers=headers).status_code == 403
                        assert client.get("/v1/streams", headers=headers).json() == {"items": []}
                        assert client.get("/v1/batches", headers=headers,
                                          params={"customer_id": other["customer_id"]}).status_code == 404
                    assert client.get("/v1/streams").status_code == 401
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        with closing(sqlite3.connect(path)) as connection:
            assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            rows = connection.execute("SELECT api_key_hash FROM customers").fetchall()
            assert len(rows) == 2
            assert all(row[0] not in [c["api_key"] for c in customers] for row in rows)
        print("HTTP acceptance passed: two organizations, access controls, process restart, WAL, hashed keys")


if __name__ == "__main__":
    main()