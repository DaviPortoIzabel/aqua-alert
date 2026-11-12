"""API Python com o mesmo contrato usado pelo painel e pelos sensores."""

import base64
import binascii
import hmac
import html
import json
import math
import re
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from flask import Blueprint, abort, current_app, jsonify, request
from werkzeug.security import generate_password_hash

from . import get_db
from .security import (code_hash, decrypt_key, digest, encrypt_key, password_matches,
                       require_device, require_user, reserve_attempt, session_token, sign, verify)

api = Blueprint("api", __name__)
SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, "Envie os dados em JSON.")
    return data


def text(value):
    return value.strip() if isinstance(value, str) else ""


def valid_email(value):
    return len(value) <= 254 and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value)


def valid_password(value):
    return isinstance(value, str) and 8 <= len(value) <= 128


def now_local():
    return datetime.now(SAO_PAULO)


def user_by_email(email):
    return get_db().execute(
        "SELECT u.*, COALESCE(s.auth_version, 0) AS auth_version FROM users u "
        "LEFT JOIN user_settings s ON s.user_id = u.id WHERE email = ?", (email,)
    ).fetchone()


def new_code():
    return f"{secrets.randbelow(100000):05d}"


@api.get("/health")
def health():
    return jsonify(ok=True)


@api.post("/api/auth/register")
def register():
    data = body()
    name, email, password = text(data.get("name")), text(data.get("email")).lower(), data.get("password")
    if not name or len(name) > 80 or not valid_email(email) or not valid_password(password):
        abort(400, "Preencha nome, e-mail válido e uma senha entre 8 e 128 caracteres.")
    db = get_db()
    device_id, key = "ESP-" + secrets.token_hex(6).upper(), new_code()
    try:
        with db:
            inserted = db.execute("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                                  (name, email, generate_password_hash(password)))
            user_id = inserted.lastrowid
            db.execute("INSERT INTO user_settings (user_id) VALUES (?)", (user_id,))
            db.execute("INSERT INTO devices (id, name, owner_id, device_key_hash) VALUES (?, ?, ?, ?)",
                       (device_id, "Meu ESP", user_id, code_hash(key, device_id)))
            db.execute("INSERT INTO device_secrets (device_id, encrypted_key) VALUES (?, ?)",
                       (device_id, encrypt_key(key, user_id, device_id)))
    except sqlite3.IntegrityError:
        abort(409, "Já existe uma conta com este e-mail.")
    user = user_by_email(email)
    return jsonify(token=session_token(user), user={"name": name, "email": email},
                   device={"id": device_id, "name": "Meu ESP", "api_key": key}), 201


@api.post("/api/auth/login")
def login():
    data = body()
    email, password = text(data.get("email")).lower(), data.get("password")
    if not valid_email(email) or not isinstance(password, str):
        abort(400, "E-mail ou senha inválidos.")
    user = user_by_email(email)
    if not user or not password_matches(password, user["password_hash"]):
        abort(401, "E-mail ou senha incorretos.")
    return jsonify(token=session_token(user), user={"name": user["name"], "email": email})


@api.get("/api/me")
def me():
    user, device = require_device()
    settings = get_db().execute("SELECT avatar, theme FROM user_settings WHERE user_id = ?",
                                (user["id"],)).fetchone()
    return jsonify(user={"id": user["id"], "name": user["name"], "email": user["email"],
                         "avatar": settings["avatar"] if settings else None,
                         "theme": settings["theme"] if settings else "system"}, device=device)


def valid_avatar(value):
    if value is None:
        return True
    if not isinstance(value, str) or len(value) > 140000 or not value.startswith("data:image/jpeg;base64,"):
        return False
    try:
        raw = base64.b64decode(value.split(",", 1)[1], validate=True)
        return 4 <= len(raw) <= 100000 and raw.startswith(b"\xff\xd8") and raw.endswith(b"\xff\xd9")
    except (ValueError, binascii.Error):
        return False


@api.post("/api/account")
def update_account():
    user = require_user()
    data = body()
    if (not {"avatar", "theme"}.intersection(data)
            or ("avatar" in data and not valid_avatar(data["avatar"]))
            or ("theme" in data and data["theme"] not in ("system", "light", "dark"))):
        abort(400, "Envie uma foto JPEG válida ou um tema disponível.")
    db = get_db()
    # Atualizar colunas separadas preserva foto e tema em requisições concorrentes.
    with db:
        db.execute("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)", (user["id"],))
        if "avatar" in data:
            db.execute("UPDATE user_settings SET avatar = ? WHERE user_id = ?", (data["avatar"], user["id"]))
        if "theme" in data:
            db.execute("UPDATE user_settings SET theme = ? WHERE user_id = ?", (data["theme"], user["id"]))
    return jsonify(ok=True)


@api.post("/api/account/password")
def change_password():
    user = require_user()
    data = body()
    previous, password = data.get("current_password"), data.get("new_password")
    if not isinstance(previous, str) or not valid_password(password):
        abort(400, "Informe a senha atual e uma nova senha entre 8 e 128 caracteres.")
    if not password_matches(previous, user["password_hash"]):
        abort(403, "A senha atual não está correta.")
    if password == previous:
        abort(400, "Escolha uma senha diferente da atual.")
    db = get_db()
    with db:
        changed = db.execute("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?",
                             (generate_password_hash(password), user["id"], user["password_hash"]))
        if not changed.rowcount:
            abort(409, "A senha foi alterada em outra sessão. Entre novamente.")
        db.execute("UPDATE user_settings SET auth_version = auth_version + 1 WHERE user_id = ?", (user["id"],))
        db.execute("UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ?", (user["id"],))
    return jsonify(ok=True, token=session_token(user_by_email(user["email"])),
                   message="Senha alterada. As outras sessões foram encerradas.")


def send_reset_email(user, code):
    config = current_app.config
    if not config.get("BREVO_API_KEY") or not config.get("BREVO_SENDER_EMAIL"):
        return False
    payload = {"sender": {"name": config["BREVO_SENDER_NAME"], "email": config["BREVO_SENDER_EMAIL"]},
               "to": [{"email": user["email"], "name": user["name"]}],
               "subject": "Código para redefinir sua senha — Aqua Alert",
               "htmlContent": f"<p>Olá, {html.escape(user['name'])}.</p><p>Seu código: <b>{code}</b></p>"
                              "<p>Ele expira em 15 minutos. Se não solicitou, ignore este e-mail.</p>"}
    req = Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(payload).encode(),
                  headers={"Content-Type": "application/json", "api-key": config["BREVO_API_KEY"]}, method="POST")
    try:
        with urlopen(req, timeout=15) as response:
            return 200 <= response.status < 300
    except (URLError, TimeoutError, OSError):
        return False


@api.post("/api/auth/forgot-password")
def forgot_password():
    data = body()
    neutral = {"ok": True, "message": "Se houver uma conta com este e-mail, enviaremos um código de verificação."}
    user = user_by_email(text(data.get("email")).lower())
    if not user:
        return jsonify(neutral)
    db = get_db()
    # Reserva do envio na mesma transação evita exceder o limite em paralelo.
    with db:
        db.execute("BEGIN IMMEDIATE")
        attempts = db.execute("SELECT COUNT(*) FROM password_reset_codes WHERE user_id = ? "
                              "AND created_at > datetime('now', '-1 hour')", (user["id"],)).fetchone()[0]
        if attempts >= 3:
            return jsonify(neutral)
        code = f"{secrets.randbelow(1000000):06d}"
        expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        inserted = db.execute("INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)",
                              (user["id"], digest(f"reset:{user['id']}:{code}"), expires))
        reset_id = inserted.lastrowid
    if not send_reset_email(user, code):
        with db:
            db.execute("DELETE FROM password_reset_codes WHERE id = ?", (reset_id,))
        abort(503, "Configure o envio de e-mail (Brevo) para recuperar a senha e tente novamente.")
    return jsonify(neutral)


@api.post("/api/auth/reset-password")
def reset_password():
    data = body()
    code, password = text(data.get("code")), data.get("password")
    if not re.fullmatch(r"[0-9]{6}", code) or not valid_password(password):
        abort(400, "Informe código de 6 dígitos e uma senha entre 8 e 128 caracteres.")
    user = user_by_email(text(data.get("email")).lower())
    if not user:
        abort(400, "Código inválido ou expirado.")
    db = get_db()
    # Um código só pode ser consumido uma vez, mesmo com duas solicitações juntas.
    hashed = generate_password_hash(password)
    with db:
        db.execute("BEGIN IMMEDIATE")
        reset = db.execute("SELECT id FROM password_reset_codes WHERE user_id = ? AND code_hash = ? "
                           "AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1",
                           (user["id"], digest(f"reset:{user['id']}:{code}"), datetime.now(timezone.utc).isoformat())).fetchone()
        if not reset:
            abort(400, "Código inválido ou expirado.")
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user["id"]))
        db.execute("UPDATE password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE user_id = ?", (user["id"],))
        db.execute("UPDATE user_settings SET auth_version = auth_version + 1 WHERE user_id = ?", (user["id"],))
    return jsonify(ok=True, message="Senha atualizada. Agora entre com a nova senha.")


@api.post("/api/dispositivos/acesso")
def unlock_device():
    user, device = require_device()
    password = body().get("password")
    if not isinstance(password, str) or not password or len(password) > 128:
        abort(400, "Informe sua senha para acessar o dispositivo.")
    reserve_attempt("device_unlock_attempts", "user_id", user["id"])
    if not password_matches(password, user["password_hash"]):
        abort(403, "Senha incorreta. Confira a senha da sua conta.")
    db = get_db()
    with db:
        db.execute("DELETE FROM device_unlock_attempts WHERE user_id = ?", (user["id"],))
    stored = db.execute("SELECT encrypted_key FROM device_secrets WHERE device_id = ?", (device["id"],)).fetchone()
    device["api_key"] = decrypt_key(stored["encrypted_key"], user["id"], device["id"]) if stored else None
    expires = int(time.time()) + 180
    proof = sign({"scope": "device-access", "sub": user["id"], "device": device["id"],
                  "ver": user["auth_version"], "exp": expires})
    return jsonify(device=device, access_token=proof, expires_at=expires)


@api.post("/api/dispositivos/chave")
def rotate_key():
    user, device = require_device()
    proof = verify(request.headers.get("X-Device-Access", ""))
    if (not proof or proof.get("scope") != "device-access" or proof.get("sub") != user["id"]
            or proof.get("device") != device["id"] or proof.get("ver") != user["auth_version"]):
        abort(403, "Confirme sua senha novamente para acessar o ESP.")
    db = get_db()
    stored = db.execute("SELECT encrypted_key FROM device_secrets WHERE device_id = ?", (device["id"],)).fetchone()
    old_key = decrypt_key(stored["encrypted_key"], user["id"], device["id"]) if stored else None
    key = new_code()
    while key == old_key:
        key = new_code()
    with db:
        db.execute("UPDATE devices SET device_key_hash = ? WHERE id = ? AND owner_id = ?",
                   (code_hash(key, device["id"]), device["id"], user["id"]))
        db.execute("INSERT INTO device_secrets (device_id, encrypted_key) VALUES (?, ?) "
                   "ON CONFLICT(device_id) DO UPDATE SET encrypted_key = excluded.encrypted_key",
                   (device["id"], encrypt_key(key, user["id"], device["id"])))
        db.execute("DELETE FROM device_code_attempts WHERE device_id = ?", (device["id"],))
    return jsonify(device={**device, "api_key": key})


def number(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Número inválido")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Número inválido")
    return result


@api.post("/api/leituras")
def post_reading():
    data = body()
    key = request.headers.get("X-Device-Key", "")
    device_id = request.headers.get("X-Device-Id") or data.get("device_id")
    if not key:
        abort(401, "Informe a chave do dispositivo.")
    if not isinstance(device_id, str) or not re.fullmatch(r"[A-Z0-9-]{6,64}", device_id):
        abort(400, "Envie o identificador do ESP junto da chave de 5 números.")
    db = get_db()
    device = db.execute("SELECT id, device_key_hash FROM devices WHERE id = ?", (device_id,)).fetchone()
    if not device:
        abort(401, "Dispositivo ou chave inválidos.")
    reserve_attempt("device_code_attempts", "device_id", device_id)
    if not hmac.compare_digest(device["device_key_hash"], code_hash(key, device_id)):
        abort(401, "Dispositivo ou chave inválidos.")
    with db:
        db.execute("DELETE FROM device_code_attempts WHERE device_id = ?", (device_id,))
    try:
        flow = number(data.get("fluxo", data.get("flow_lpm"))) if "fluxo" in data or "flow_lpm" in data else None
        liters = number(data["litros"]) if "litros" in data else flow * number(data.get("intervalo_segundos", 5)) / 60
        if not 0 <= liters <= 10000:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        abort(400, "litros inválido.")
    try:
        measured = datetime.fromisoformat(data["medido_em"].replace("Z", "+00:00")) if data.get("medido_em") else now_local()
        if measured.tzinfo is None:
            measured = measured.replace(tzinfo=timezone.utc)
        measured_at = measured.astimezone(SAO_PAULO).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError, AttributeError, OverflowError):
        abort(400, "medido_em inválido.")
    with db:
        db.execute("INSERT INTO readings (device_id, measured_at, liters, flow_lpm) VALUES (?, ?, ?, ?)",
                   (device_id, measured_at, liters, flow))
    return jsonify(ok=True, liters=liters, measured_at=measured_at), 201


def parse_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        abort(400, "Informe datas válidas no formato AAAA-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        abort(400, "Informe datas válidas no formato AAAA-MM-DD.")


@api.get("/api/consumo/periodo")
def consumption_range():
    _, device = require_device()
    start, end = parse_date(request.args.get("start")), parse_date(request.args.get("end"))
    days_count = (end - start).days + 1
    if days_count < 1 or days_count > 3660 or end > now_local().date():
        abort(400, "Escolha um período válido de até 3.660 dias, sem datas futuras.")
    granularity = request.args.get("granularity", "auto")
    if granularity not in ("auto", "hour", "day", "month"):
        abort(400, "Escolha um agrupamento disponível.")
    if granularity == "auto":
        granularity = "hour" if days_count < 3 else "month" if days_count > 92 else "day"
    if granularity == "hour" and days_count > 31:
        abort(400, "A visualização por hora aceita períodos de até 31 dias.")
    limits = (device["id"], f"{start} 00:00:00", f"{end + timedelta(days=1)} 00:00:00")
    # Limite exclusivo no dia seguinte inclui o dia final inteiro em São Paulo.
    daily = get_db().execute(
        "SELECT substr(measured_at, 1, 10) AS date, SUM(liters) AS liters, COUNT(*) AS readings, "
        "MAX(measured_at) AS last_reading FROM readings WHERE device_id = ? "
        "AND measured_at >= ? AND measured_at < ? GROUP BY date ORDER BY date", limits).fetchall()
    days = [dict(row) for row in daily]
    if granularity == "hour":
        points = [dict(row) for row in get_db().execute(
            "SELECT substr(measured_at, 1, 13) || ':00' AS period, SUM(liters) AS liters, COUNT(*) AS readings "
            "FROM readings WHERE device_id = ? AND measured_at >= ? AND measured_at < ? "
            "GROUP BY period ORDER BY period", limits)]
    else:
        groups = {}
        for day in days:
            period = day["date"][:7] if granularity == "month" else day["date"]
            entry = groups.setdefault(period, {"period": period, "liters": 0, "readings": 0})
            entry["liters"] += day["liters"]
            entry["readings"] += day["readings"]
        points = list(groups.values())
    total = sum(day["liters"] for day in days)
    peak = max(days, key=lambda day: day["liters"]) if days else None
    # Dias sem medições ficam ausentes; não entram na média como consumo zero.
    return jsonify(start=str(start), end=str(end), calendar_days=days_count, days=days,
                   series={"granularity": granularity, "points": points},
                   summary={"total_liters": round(total, 3), "recorded_days": len(days),
                            "readings": sum(day["readings"] for day in days),
                            "average_liters": round(total / len(days), 3) if days else None,
                            "peak": {"date": peak["date"], "liters": peak["liters"]} if peak else None})


@api.get("/api/consumo/hoje")
def today():
    _, device = require_device()
    day = str(now_local().date())
    total = get_db().execute("SELECT COALESCE(SUM(liters), 0) FROM readings WHERE device_id = ? "
                             "AND substr(measured_at, 1, 10) = ?", (device["id"], day)).fetchone()[0]
    return jsonify(date=day, total_litros=total)


@api.get("/api/consumo/diario")
def daily():
    _, device = require_device()
    rows = get_db().execute("SELECT substr(measured_at, 12, 2) || ':00' AS hora, ROUND(SUM(liters), 3) AS total "
                            "FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) = ? "
                            "GROUP BY hora ORDER BY hora", (device["id"], str(now_local().date()))).fetchall()
    return jsonify(labels=[row["hora"] for row in rows], valores=[row["total"] for row in rows])


@api.get("/api/consumo/semanal")
def weekly():
    _, device = require_device()
    start = str(now_local().date() - timedelta(days=6))
    rows = get_db().execute("SELECT substr(measured_at, 1, 10) AS dia, ROUND(SUM(liters), 3) AS total "
                            "FROM readings WHERE device_id = ? AND substr(measured_at, 1, 10) >= ? "
                            "GROUP BY dia ORDER BY dia", (device["id"], start)).fetchall()
    return jsonify(labels=[f"{row['dia'][8:10]}/{row['dia'][5:7]}" for row in rows],
                   valores=[row["total"] for row in rows])


@api.get("/api/historico")
def history():
    _, device = require_device()
    rows = get_db().execute("SELECT substr(measured_at, 1, 10) AS dia, ROUND(SUM(liters), 3) AS total_litros, "
                            "MAX(measured_at) AS ultima_atualizacao FROM readings WHERE device_id = ? "
                            "GROUP BY dia ORDER BY dia DESC LIMIT 90", (device["id"],)).fetchall()
    return jsonify([dict(row) for row in rows])


@api.get("/api/alertas/vazamento")
def leak_alert():
    _, device = require_device()
    today = now_local().date()
    totals = get_db().execute(
        "SELECT COALESCE(SUM(CASE WHEN substr(measured_at, 1, 10) BETWEEN ? AND ? THEN liters ELSE 0 END), 0) AS current_total, "
        "COALESCE(SUM(CASE WHEN substr(measured_at, 1, 10) BETWEEN ? AND ? THEN liters ELSE 0 END), 0) AS previous_total "
        "FROM readings WHERE device_id = ?",
        (str(today - timedelta(days=6)), str(today), str(today - timedelta(days=13)),
         str(today - timedelta(days=7)), device["id"])).fetchone()
    current, previous = totals["current_total"], totals["previous_total"]
    increase = (current - previous) / previous * 100 if previous > 0 else 0
    level = "alta" if increase > 80 else "media" if increase >= 40 else "normal"
    return jsonify(level=level, increase_percent=max(0, round(increase, 1)),
                   current_total=round(current, 2), previous_total=round(previous, 2))
