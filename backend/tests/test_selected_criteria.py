"""Selected criteria through stream snapshots, pipeline, publication and REST reports."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.api import create_app
from backend.config import BackendSettings
from backend.database import Database
from backend.streams import StreamStore
from backend.batches import BatchStore
from tests.test_stream_api import ADMIN, stream_config


class SelectedCriteriaTests(unittest.TestCase):
    def test_publication_comparison_and_restart_keep_selected_maximum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = BackendSettings(database_path=root / 'db.sqlite3', materials_root=root / 'materials',
                inputs_root=root / 'inputs', worker_lock=root / 'worker.lock',
                admin_api_key='test-admin-key-not-for-production')
            with TestClient(create_app(settings)) as client:
                owner = client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'A'}).json()
                stream = client.post(f"/v1/admin/customers/{owner['customer_id']}/streams", headers=ADMIN,
                    data={'config': json.dumps(stream_config(enabled_criteria=['1.1', '1.2'],
                        text_correction_enabled=False, unwanted_expressions_enabled=False))},
                    files={'knowledge_base': ('kb.txt', b'Rules')}).json()
                database = Database(settings.database_path)
                streams = StreamStore(database, settings.materials_root)
                store = BatchStore(database, streams, settings.inputs_root, 'ffprobe')
                bids = []
                for _ in range(2):
                    batch, _ = store.create(owner['customer_id'], stream['stream_id'], str(uuid4()))
                    bid, cid = batch['batch_id'], str(uuid4())
                    path = store.path(bid, cid)
                    path.parent.mkdir(parents=True)
                    path.write_bytes(b'audio boundary replaced below')
                    with database.connection() as connection:
                        connection.execute('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, ?)',
                            (cid, bid, 'call.mp3', 'hash', None, None, 1))
                    store.complete(bid, owner['customer_id'])
                    store.start(bid)
                    segments = [{'role': 'OPERATOR', 'start': 0, 'end': 2, 'text': 'Добрый день'}]
                    raw = {'scores': {'1.1': {'score': 1, 'reason': 'Приветствие'},
                        '1.2': {'score': 0.5, 'reason': 'Неполное прощание'},
                        '5.2': {'score': 0, 'reason': 'Игнорировать отключённый пункт'}}, 'critical_violation': True}
                    with patch('pipeline.transcribe', return_value=segments), \
                         patch('pipeline.assign_roles', return_value=segments), \
                         patch('analyzer._call_llm', return_value=json.dumps(raw)):
                        self.assertTrue(store.process(bid))
                    call = client.get(f'/v1/calls/{cid}/report', headers=ADMIN).json()['result']
                    self.assertEqual(call['total'], 1.5)
                    self.assertEqual(call['max_total'], 2)
                    self.assertEqual(set(call['scores']), {'1.1', '1.2'})
                    bids.append(bid)
                sid = stream['stream_id']
            with TestClient(create_app(settings)) as client:
                response = client.post(f'/v1/streams/{sid}/comparisons', headers=ADMIN, json={'batch_ids': bids})
                self.assertEqual(response.status_code, 200, response.text)
                for bid in bids:
                    report = client.get(f'/v1/batches/{bid}/report', headers=ADMIN).json()
                    self.assertEqual(report['max_total'], 2)
                    self.assertEqual(report['average_total'], 1.5)
                    self.assertEqual(report['critical_violation_count'], 0)
                    self.assertEqual(report['criterion_averages'], {'1.1': 1, '1.2': 0.5})
