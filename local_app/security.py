"""Sessões assinadas e segredos de dispositivos; dados locais independentes."""

import base64
import hmac
import json
import secrets
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from flask import abort, current_app, request
from werkzeug.security import check_password_hash

from . import get_db


def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def digest(value):
    return encode(hmac.digest(current_app.config["AUTH_SECRET"].encode(), value.encode(), "sha256"))


def sign(payload):
    value = encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{value}.{digest(value)}"


def verify(token):
    try:
        value, signature = token.split(".")
        if not hmac.compare_digest(signature, digest(value)):
            return None
        payload = json.loads(decode(value))
        if not isinstance(payload, dict) or not isinstance(payload.get("exp"), (int, float)):
            return None
        return payload if payload["exp"] > time.time() else None
    except (ValueError, TypeError, UnicodeError):
        return None


def session_token(user):
    return sign({"sub": user["id"], "ver": user["auth_version"], "exp": int(time.time()) + 604800})


def require_user():
    header = request.headers.get("Authorization", "").split()
    payload = verify(header[1]) if len(header) == 2 and header[0].lower() == "bearer" else None
    if not payload or payload.get("scope") or type(payload.get("sub")) is not int:
        abort(401, "Faça login para continuar.")
    user = get_db().execute(
        "SELECT u.*, COALESCE(s.auth_version, 0) AS auth_version FROM users u "
        "LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?", (payload["sub"],)
    ).fetchone()
    if not user or payload.get("ver") != user["auth_version"]:
        abort(401, "Faça login para continuar.")
    return user


def require_device():
    user = require_user()
    device_id = request.args.get("device_id")
    query = "SELECT id, name FROM devices WHERE owner_id = ?"
    args = [user["id"]]
    if device_id:
        query += " AND id = ?"
        args.append(device_id)
    device = get_db().execute(query + " ORDER BY created_at, id LIMIT 1", args).fetchone()
    if not device:
        abort(404, "Nenhum ESP cadastrado nesta conta.")
    return user, dict(device)


def password_matches(password, stored):
    return isinstance(password, str) and check_password_hash(stored, password)


def code_hash(code, device_id):
    return digest(f"device-code:v1:{device_id}:{code}")


def cipher():
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"aqua-alert-device-storage-v1",
               info=b"encrypted-device-key").derive(current_app.config["AUTH_SECRET"].encode())
    return AESGCM(key)


def encrypt_key(value, user_id, device_id):
    iv = secrets.token_bytes(12)
    encrypted = cipher().encrypt(iv, value.encode(), f"{user_id}:{device_id}".encode())
    return f"{encode(iv)}.{encode(encrypted)}"


def decrypt_key(value, user_id, device_id):
    iv, data = value.split(".")
    return cipher().decrypt(decode(iv), decode(data), f"{user_id}:{device_id}".encode()).decode()


def reserve_attempt(table, column, identifier):
    """O UPSERT reserva a tentativa atomicamente, inclusive em requisições paralelas."""
    allowed = {("device_code_attempts", "device_id"), ("device_unlock_attempts", "user_id")}
    assert (table, column) in allowed
    now = int(time.time())
    db = get_db()
    with db:
        row = db.execute(
            f"INSERT INTO {table} ({column}, attempts, window_start) VALUES (?, 1, ?) "
            f"ON CONFLICT({column}) DO UPDATE SET "
            "attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END, "
            "window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END "
            "RETURNING attempts", (identifier, now, now - 600, now - 600)
        ).fetchone()
    if row["attempts"] > 5:
        abort(429, "Muitas tentativas. Aguarde 10 minutos ou renove a chave pela conta.")
