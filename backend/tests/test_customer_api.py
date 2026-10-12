import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import BackendSettings


class CustomerApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings = BackendSettings(
            database_path=Path(self.directory.name) / "api.sqlite3",
            admin_api_key="test-admin-key-not-for-production",
        )

    def test_created_customer_and_key_survive_application_restart(self):
        with TestClient(create_app(self.settings)) as client:
            response = client.post(
                "/v1/admin/customers", json={"name": "Заказчик А"},
                headers={"Authorization": "Bearer test-admin-key-not-for-production"},
            )
            self.assertEqual(response.status_code, 201, response.text)
            created = response.json()
            self.assertEqual(created["name"], "Заказчик А")
            self.assertTrue(created["api_key"])
            self.assertEqual(response.headers.get("cache-control"), "no-store")

        with TestClient(create_app(self.settings)) as client:
            response = client.get(
                f"/v1/customers/{created['customer_id']}",
                headers={"Authorization": f"Bearer {created['api_key']}"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {
                "customer_id": created["customer_id"],
                "name": "Заказчик А", "created_at": created["created_at"],
            })

    def test_access_context_identifies_empty_customer_and_admin_without_secrets(self):
        admin = {"Authorization": "Bearer test-admin-key-not-for-production"}
        with TestClient(create_app(self.settings)) as client:
            created = client.post('/v1/admin/customers', headers=admin,
                                  json={'name': 'Новая организация'}).json()
            headers = {'Authorization': f"Bearer {created['api_key']}"}
            response = client.get('/v1/access-context', headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), {'role': 'customer', 'customer': {
                'customer_id': created['customer_id'], 'name': 'Новая организация'}})
            self.assertEqual(response.headers.get('cache-control'), 'no-store')
            response = client.get('/v1/access-context', headers=admin)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'role': 'admin', 'customer': None})
            self.assertEqual(response.headers.get('cache-control'), 'no-store')
            response = client.get('/v1/access-context', headers={
                'Authorization': 'Bearer invalid-secret'})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn('invalid-secret', response.text)

    def test_two_customers_cannot_read_each_other_or_choose_another_owner(self):
        admin = {"Authorization": "Bearer test-admin-key-not-for-production"}
        with TestClient(create_app(self.settings)) as client:
            first = client.post("/v1/admin/customers", headers=admin, json={"name": "А"}).json()
            second = client.post("/v1/admin/customers", headers=admin, json={"name": "Б"}).json()
            self.assertNotEqual(first["api_key"], second["api_key"])
            for own, other in ((first, second), (second, first)):
                headers = {"Authorization": f"Bearer {own['api_key']}"}
                self.assertEqual(client.get(f"/v1/customers/{own['customer_id']}", headers=headers).status_code, 200)
                self.assertEqual(client.get(f"/v1/customers/{other['customer_id']}", headers=headers).status_code, 404)
                for endpoint in ("/v1/streams", "/v1/batches"):
                    self.assertEqual(client.get(endpoint, headers=headers).json(), {"items": []})
                    self.assertEqual(client.get(endpoint, headers=headers,
                                                params={"customer_id": own["customer_id"]}).status_code, 200)
                    self.assertEqual(client.get(endpoint, headers=headers,
                                                params={"customer_id": other["customer_id"]}).status_code, 404)
                    self.assertEqual(client.get(endpoint, headers=admin,
                                                params={"customer_id": other["customer_id"]}).json(), {"items": []})
                self.assertEqual(client.get("/v1/admin/customers", headers=headers).status_code, 403)
                self.assertEqual(client.post("/v1/admin/customers", headers=headers,
                                             json={"name": "Недопустимо"}).status_code, 403)
                self.assertEqual(client.get(f"/v1/customers/{other['customer_id']}", headers=admin).status_code, 200)
            listed = client.get("/v1/admin/customers", headers=admin)
            self.assertEqual(len(listed.json()["items"]), 2)
            for secret in (first["api_key"], second["api_key"], "api_key_hash"):
                self.assertNotIn(secret, listed.text)

    def test_missing_invalid_and_malformed_keys_are_rejected_without_echo(self):
        with TestClient(create_app(self.settings)) as client:
            for authorization in (None, "Bearer invalid-secret", "Basic invalid-secret", "Bearer"):
                headers = {} if authorization is None else {"Authorization": authorization}
                for endpoint in ("/v1/streams", "/v1/batches", "/v1/admin/customers"):
                    response = client.get(endpoint, headers=headers)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.json()["error"]["code"], "unauthorized")
                    self.assertNotIn("invalid-secret", response.text)

    def test_validation_errors_do_not_echo_secrets_or_create_customers(self):
        headers = {"Authorization": "Bearer test-admin-key-not-for-production"}
        with TestClient(create_app(self.settings)) as client:
            for body in ({"name": " "}, {"name": "A", "api_key": "body-secret"},
                         {"name": {"secret": "body-secret"}}):
                response = client.post("/v1/admin/customers", headers=headers, json=body)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("body-secret", response.text)
            self.assertEqual(client.get("/v1/admin/customers", headers=headers).json(), {"items": []})


if __name__ == "__main__":
    unittest.main()
