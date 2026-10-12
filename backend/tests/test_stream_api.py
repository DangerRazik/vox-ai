import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings


ADMIN = {"Authorization": "Bearer test-admin-key-not-for-production"}


def stream_config(**changes):
    return {
        "name": "Поддержка", "whisper_model": "whisper-test",
        "llm_model": "llm-test", "speech_lang": "ru",
        "whisper_prompt": "Название компании", "role_prompt": "Роли: {fragments}",
        "analysis_system_prompt": "Оценка качества",
        "analysis_user_prompt": "{checklist}\n{kb}\n{metrics}\n{dialog}",
        "long_pause_sec": 3.0, "interruption_gap_sec": 0.2,
        "text_correction_enabled": True, "unwanted_expressions_enabled": True,
        "speech_rate_enabled": False, "zero_total_on_critical": False,
        **changes,
    }


class StreamApiTests(unittest.TestCase):
    def test_selection_validates_persists_and_is_public(self):
        from backend.database import Database
        from backend.streams import StreamStore
        with TestClient(create_app(self.settings)) as client:
            owner = client.post('/v1/admin/customers', headers=ADMIN, json={'name': 'Selection'}).json()
            for selected in ([], ['unknown'], ['1.1', '1.1']):
                response = self.create_stream(client, owner['customer_id'], stream_config(enabled_criteria=selected))
                self.assertEqual(response.status_code, 422, response.text)
            response = self.create_stream(client, owner['customer_id'], stream_config(enabled_criteria=['4.1', '1.1']))
            self.assertEqual(response.status_code, 201, response.text)
            stream = response.json()
            self.assertEqual([c['id'] for c in stream['criteria']], ['1.1', '4.1'])
        with TestClient(create_app(self.settings)) as client:
            persisted = client.get('/v1/streams/' + stream['stream_id'], headers=ADMIN).json()
            self.assertEqual(persisted['criteria'], stream['criteria'])
        store = StreamStore(Database(self.settings.database_path), self.settings.materials_root)
        self.assertEqual(store.load_context(stream['stream_id'], owner['customer_id']).enabled_criteria, ('1.1', '4.1'))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.settings = BackendSettings(
            database_path=self.root / "api.sqlite3", materials_root=self.root / "materials",
            admin_api_key="test-admin-key-not-for-production",
        )

    def create_stream(self, client, customer_id, config=None, kb=b"Answers for A"):
        return client.post(
            f"/v1/admin/customers/{customer_id}/streams", headers=ADMIN,
            data={"config": json.dumps(config or stream_config())},
            files={
                "knowledge_base": ("../../source.doc", kb),
                "text_corrections": ("fixes.json", json.dumps({"Интеки": "Интикетс"}).encode()),
                "unwanted_expressions": ("words.json", '["грубость"]'.encode()),
            },
        )

    def test_browser_creation_uses_source_defaults_and_keeps_whisper_editable(self):
        from config import settings as processing_settings
        from transcriber import _ROLE_PROMPT
        from analyzer import SYSTEM, USER_TMPL
        expected = {
            "whisper_model": processing_settings.WHISPER_MODEL,
            "llm_model": processing_settings.GPL_MODEL,
            "speech_lang": processing_settings.SPEECH_LANG,
            "role_prompt": _ROLE_PROMPT,
            "analysis_system_prompt": SYSTEM,
            "analysis_user_prompt": USER_TMPL,
        }
        with TestClient(create_app(self.settings)) as client:
            customer = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "Defaults"}).json()
            endpoint = "/v1/admin/stream-defaults"
            response = client.get(endpoint, headers=ADMIN)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {"whisper_prompt": processing_settings.WHISPER_PROMPT})
            self.assertEqual(client.get(endpoint).status_code, 401)
            self.assertEqual(client.get(endpoint, headers={"Authorization": f"Bearer {customer['api_key']}"}).status_code, 403)
            config = stream_config()
            fixed = ("whisper_model", "llm_model", "speech_lang", "role_prompt",
                     "analysis_system_prompt", "analysis_user_prompt")
            for field in fixed:
                del config[field]
            del config["whisper_prompt"]
            first = self.create_stream(client, customer["customer_id"], config)
            self.assertEqual(first.status_code, 201, first.text)
            for field in fixed:
                self.assertEqual(first.json()["config"][field], expected[field].strip())
            self.assertEqual(first.json()["config"]["whisper_prompt"], processing_settings.WHISPER_PROMPT)
            config["whisper_prompt"] = "Custom terminology"
            second = self.create_stream(client, customer["customer_id"], config)
            self.assertEqual(second.status_code, 201, second.text)
            self.assertNotEqual(first.json()["stream_id"], second.json()["stream_id"])
            self.assertEqual(second.json()["config"]["whisper_prompt"], "Custom terminology")
        with TestClient(create_app(self.settings)) as client:
            persisted = client.get(f"/v1/admin/streams/{first.json()['stream_id']}", headers=ADMIN)
            self.assertEqual(persisted.json()["config"], first.json()["config"])

    def test_created_stream_and_context_survive_restart(self):
        with TestClient(create_app(self.settings)) as client:
            customer = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "А"}).json()
            response = self.create_stream(client, customer["customer_id"])
            self.assertEqual(response.status_code, 201, response.text)
            stream = response.json()
            self.assertEqual(stream["customer_id"], customer["customer_id"])

        from backend.database import Database
        from backend.streams import StreamStore

        with TestClient(create_app(self.settings)) as client:
            headers = {"Authorization": f"Bearer {customer['api_key']}"}
            public = client.get(f"/v1/streams/{stream['stream_id']}", headers=headers)
            self.assertEqual(public.status_code, 200, public.text)
            self.assertEqual(len(public.json()["criteria"]), 11)
            self.assertFalse(public.json()["options"]["speech_rate_enabled"])
            self.assertEqual(client.get("/v1/streams", headers=headers).json()["items"], [public.json()])
            for private in ("Answers for A", "Оценка качества", "Интеки", "materials", "kb_path"):
                self.assertNotIn(private, public.text)
            context = StreamStore(Database(self.settings.database_path), self.settings.materials_root).load_context(
                stream["stream_id"], customer["customer_id"],
            )
            self.assertEqual(context.whisper_model, "whisper-test")
            self.assertEqual(context.whisper_fixes["Интеки"], "Интикетс")
            self.assertEqual(Path(context.kb_path).read_bytes(), b"Answers for A")
            self.assertFalse(context.speech_rate_enabled)
            self.assertFalse(context.zero_total_on_critical)
            self.assertEqual(context.unwanted_expressions, ("грубость",))

    def test_new_stream_preserves_original_materials_and_isolates_owners(self):
        from backend.database import Database
        from backend.streams import StreamStore

        with TestClient(create_app(self.settings)) as client:
            first = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "А"}).json()
            second = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "Б"}).json()
            a = self.create_stream(client, first["customer_id"]).json()
            b = self.create_stream(client, second["customer_id"], stream_config(name="Б"), b"Answers for B").json()
            new = self.create_stream(client, first["customer_id"], stream_config(name="Новая версия"), b"New answers").json()
            self.assertEqual(len({a["stream_id"], b["stream_id"], new["stream_id"]}), 3)
            store = StreamStore(Database(self.settings.database_path), self.settings.materials_root)
            self.assertEqual(Path(store.load_context(a["stream_id"], first["customer_id"]).kb_path).read_bytes(), b"Answers for A")
            with self.assertRaises(LookupError):
                store.load_context(a["stream_id"], second["customer_id"])
            for own, foreign in ((first, b), (second, a)):
                headers = {"Authorization": f"Bearer {own['api_key']}"}
                listed = client.get("/v1/streams", headers=headers).json()["items"]
                self.assertTrue(all(s["customer_id"] == own["customer_id"] for s in listed))
                self.assertEqual(client.get(f"/v1/streams/{foreign['stream_id']}", headers=headers).status_code, 404)
                self.assertEqual(client.get(f"/v1/admin/streams/{a['stream_id']}", headers=headers).status_code, 403)
                response = self.create_stream(client, own["customer_id"])
                self.assertEqual(response.status_code, 201)
                denied = client.post(f"/v1/admin/customers/{own['customer_id']}/streams", headers=headers,
                                     data={"config": json.dumps(stream_config())},
                                     files={"knowledge_base": ("kb", b"Answers")})
                self.assertEqual(denied.status_code, 403)
            for method in (client.put, client.patch):
                self.assertEqual(method(f"/v1/admin/streams/{a['stream_id']}", headers=ADMIN,
                                        json={"name": "Changed"}).status_code, 405)
            admin = client.get(f"/v1/admin/streams/{a['stream_id']}", headers=ADMIN).json()
            self.assertEqual(admin["config"]["name"], "Поддержка")
            self.assertIn("sha256", admin["materials"]["knowledge_base"])
            self.assertFalse((self.root / "source.doc").exists())

    def test_invalid_materials_and_templates_never_publish_a_stream(self):
        with TestClient(create_app(self.settings)) as client:
            customer = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "А"}).json()
            endpoint = f"/v1/admin/customers/{customer['customer_id']}/streams"
            cases = [
                (stream_config(), {"knowledge_base": ("kb", b"Answers")}),
                (stream_config(text_correction_enabled=False), {"knowledge_base": ("kb", b"Answers")}),
                (stream_config(text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b"\x00binary")}),
                (stream_config(text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b" ")}),
                (stream_config(role_prompt="invalid-secret", text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b"Answers")}),
                (stream_config(text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b"Answers"), "text_corrections": ("fixes", b'{"x": 1}')}),
                (stream_config(text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b"Answers"), "unwanted_expressions": ("words", b'[]')}),
                (stream_config(analysis_user_prompt="{dialog.secret}", text_correction_enabled=False, unwanted_expressions_enabled=False),
                 {"knowledge_base": ("kb", b"Answers")}),
            ]
            for config, files in cases:
                with self.subTest(config=config, files=files):
                    response = client.post(endpoint, headers=ADMIN, data={"config": json.dumps(config)}, files=files)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertNotIn("invalid-secret", response.text)
                    self.assertEqual(client.get("/v1/streams", headers=ADMIN).json(), {"items": []})
                    self.assertEqual(list(self.settings.materials_root.glob("*")), [])

    def test_tampered_materials_are_rejected_when_loading_context(self):
        from backend.database import Database
        from backend.streams import StreamStore

        with TestClient(create_app(self.settings)) as client:
            customer = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "А"}).json()
            stream = self.create_stream(client, customer["customer_id"]).json()
        (self.settings.materials_root / stream["stream_id"] / "knowledge_base").write_bytes(b"Tampered")
        store = StreamStore(Database(self.settings.database_path), self.settings.materials_root)
        with self.assertRaises(ValueError):
            store.load_context(stream["stream_id"], customer["customer_id"])

    def test_duplicate_correction_keys_are_rejected_instead_of_silently_overwritten(self):
        with TestClient(create_app(self.settings)) as client:
            customer = client.post("/v1/admin/customers", headers=ADMIN, json={"name": "А"}).json()
            response = client.post(
                f"/v1/admin/customers/{customer['customer_id']}/streams", headers=ADMIN,
                data={"config": json.dumps(stream_config(unwanted_expressions_enabled=False))},
                files={"knowledge_base": ("kb", b"Answers"),
                       "text_corrections": ("fixes", b'{"word":"one","word":"two"}')},
            )
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(client.get("/v1/streams", headers=ADMIN).json(), {"items": []})


if __name__ == "__main__":
    unittest.main()
