"""Regressões da execução Flask; não usa serviços externos nem banco de produção."""

import base64
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from local_app import ROOT, create_app


class FlaskLocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {"TESTING": True, "INSTANCE_PATH": self.temp.name,
                       "DATABASE": str(Path(self.temp.name) / "test.sqlite3")}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.password = "local-password-123"

    def register(self, email="local@example.test"):
        response = self.client.post("/api/auth/register", json={"name": "<Local>", "email": email,
                                                              "password": self.password})
        self.assertEqual(response.status_code, 201)
        return response.json

    def auth(self, account):
        return {"Authorization": "Bearer " + account["token"]}

    def test_pages_share_current_interface_but_only_flask_selects_local_api(self):
        for page in ("index", "auth", "dashboard", "dicas", "sobre", "artigos"):
            response = self.client.get(f"/{page}.html")
            self.assertEqual(response.status_code, 200, page)
            self.assertIn(b'<meta name="aqua-api-base" content="">', response.data)
            self.assertNotIn('name="aqua-api-base"', (ROOT / "docs" / f"{page}.html").read_text())
        with self.client.get("/account.js") as response:
            script = response.text
        self.assertIn("?? 'https://aqua-alert-api.davipizabel.workers.dev'", script)
        self.assertIn(b"Seu consumo", self.client.get("/dashboard.html").data)
        for path in ("/site.css", "/dashboard.js"):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
        for path in ("/../instance/auth-secret", "/instance/auth-secret", "/app.py", "/api/nao-existe"):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_restart_preserves_database_sessions_and_encrypted_device_keys(self):
        account = self.register()
        restarted = create_app(self.config).test_client()
        self.assertEqual(restarted.get("/api/me", headers=self.auth(account)).status_code, 200)
        opened = restarted.post("/api/dispositivos/acesso", headers=self.auth(account),
                                json={"password": self.password})
        self.assertEqual(opened.json["device"]["api_key"], account["device"]["api_key"])
        with sqlite3.connect(self.config["DATABASE"]) as db:
            stored = db.execute("SELECT encrypted_key FROM device_secrets").fetchone()[0]
            self.assertNotEqual(stored, account["device"]["api_key"])

    def test_password_recovery_revokes_sessions_and_consumes_code_once(self):
        account = self.register()
        with patch("local_app.api.send_reset_email", return_value=True) as send:
            response = self.client.post("/api/auth/forgot-password", json={"email": account["user"]["email"]})
            self.assertEqual(response.status_code, 200)
            code = send.call_args.args[1]
        payload = {"email": account["user"]["email"], "code": code, "password": "changed-password-456"}
        self.assertEqual(self.client.post("/api/auth/reset-password", json=payload).status_code, 200)
        self.assertEqual(self.client.get("/api/me", headers=self.auth(account)).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/reset-password", json=payload).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": payload["email"],
                                                                 "password": payload["password"]}).status_code, 200)

    def test_email_failure_does_not_leave_a_usable_reset_code(self):
        self.register()
        with patch("local_app.api.send_reset_email", return_value=False):
            response = self.client.post("/api/auth/forgot-password", json={"email": "local@example.test"})
        self.assertEqual(response.status_code, 503)
        with sqlite3.connect(self.config["DATABASE"]) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM password_reset_codes").fetchone()[0], 0)

    def test_reset_expiry_and_send_limit(self):
        self.register()
        with patch("local_app.api.send_reset_email", return_value=True) as send:
            for _ in range(4):
                self.client.post("/api/auth/forgot-password", json={"email": "local@example.test"})
            self.assertEqual(send.call_count, 3)
            code = send.call_args.args[1]
        with sqlite3.connect(self.config["DATABASE"]) as db:
            db.execute("UPDATE password_reset_codes SET expires_at = '2000-01-01T00:00:00+00:00'")
        self.assertEqual(self.client.post("/api/auth/reset-password", json={"email": "local@example.test",
                                                                          "code": code,
                                                                          "password": "changed-password-456"}).status_code, 400)

    def test_reading_validation_conversion_and_zero_prefix(self):
        with patch("local_app.api.new_code", return_value="01234"):
            account = self.register()
        self.assertEqual(account["device"]["api_key"], "01234")
        headers = {"X-Device-Key": "01234", "X-Device-Id": account["device"]["id"]}
        for payload in ({"litros": -1}, {"litros": "nan"}, {"litros": True}, {"litros": None},
                        {"litros": 10001}, {}, {"litros": 1, "medido_em": "invalid"}):
            self.assertEqual(self.client.post("/api/leituras", headers=headers, json=payload).status_code, 400)
        response = self.client.post("/api/leituras", headers=headers,
                                    json={"fluxo": 2.4, "intervalo_segundos": 5, "medido_em": "2026-01-15T03:00:00Z"})
        self.assertEqual(response.status_code, 201)
        self.assertAlmostEqual(response.json["liters"], 0.2)
        self.assertEqual(response.json["measured_at"], "2026-01-15 00:00:00")
        response = self.client.get("/api/historico", headers=self.auth(account))
        self.assertEqual(response.json[0]["total_litros"], 0.2)
        for endpoint in ("hoje", "diario", "semanal"):
            self.assertEqual(self.client.get("/api/consumo/" + endpoint, headers=self.auth(account)).status_code, 200)

    def test_invalid_json_and_tampered_session_do_not_cause_server_errors(self):
        account = self.register()
        for payload in ([], None, {"email": []}, {"name": 1, "email": {}, "password": True}):
            self.assertEqual(self.client.post("/api/auth/register", json=payload).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", data="{", content_type="application/json").status_code, 400)
        tampered = {"Authorization": "Bearer " + account["token"] + "x"}
        self.assertEqual(self.client.get("/api/me", headers=tampered).status_code, 401)
        # Um payload arbitrário sem assinatura válida nunca autentica.
        payload = base64.urlsafe_b64encode(json.dumps({"sub": 1, "exp": 9999999999}).encode()).decode()
        self.assertEqual(self.client.get("/api/me", headers={"Authorization": f"Bearer {payload}.invalid"}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
