"""Aplicação Flask local; o site publicado continua usando Workers e D1."""

import os
import secrets
import sqlite3
from pathlib import Path

from flask import Flask, current_app, g, jsonify, redirect, render_template, send_from_directory
from jinja2 import ChoiceLoader, FileSystemLoader, PrefixLoader
from werkzeug.exceptions import HTTPException

ROOT = Path(__file__).resolve().parent.parent
PAGES = {"index", "auth", "dashboard", "dicas", "sobre", "artigos"}


def get_db():
    """Uma conexão por requisição; transações explícitas ficam nos handlers."""
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"], timeout=15)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def create_app(config=None):
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=None,
                instance_path=str((config or {}).get("INSTANCE_PATH", ROOT / "instance")))
    app.config.from_mapping(
        DATABASE=os.environ.get("AQUA_DATABASE", str(Path(app.instance_path) / "aqua-alert.sqlite3")),
        AUTH_SECRET=os.environ.get("AUTH_SECRET"),
        BREVO_API_KEY=os.environ.get("BREVO_API_KEY"),
        BREVO_SENDER_EMAIL=os.environ.get("BREVO_SENDER_EMAIL"),
        BREVO_SENDER_NAME=os.environ.get("BREVO_SENDER_NAME", "Aqua Alert"),
        MAX_CONTENT_LENGTH=150000,
    )
    if config:
        app.config.update(config)
    Path(app.instance_path).mkdir(mode=0o700, parents=True, exist_ok=True)
    if not app.config["AUTH_SECRET"]:
        # Persistir o segredo mantém sessões e chaves legíveis após reiniciar.
        secret_file = Path(app.instance_path) / "auth-secret"
        try:
            with secret_file.open("x", encoding="utf-8") as handle:
                os.chmod(secret_file, 0o600)
                handle.write(secrets.token_urlsafe(48))
        except FileExistsError:
            pass
        app.config["AUTH_SECRET"] = secret_file.read_text(encoding="utf-8").strip()
    if len(app.config["AUTH_SECRET"]) < 32:
        raise ValueError("AUTH_SECRET precisa ter pelo menos 32 caracteres.")
    database = Path(app.config["DATABASE"])
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as db:
        db.executescript((ROOT / "api/schema.sql").read_text(encoding="utf-8"))
    # Reutiliza os HTMLs atuais sem manter duas cópias da interface.
    app.jinja_loader = ChoiceLoader([app.jinja_loader, PrefixLoader({"pages": FileSystemLoader(ROOT / "docs")})])

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.after_request
    def private_responses(response):
        from flask import request
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return render_template("local/page.html", page="pages/index.html")

    @app.get("/<path:filename>")
    def site(filename):
        if filename in PAGES:
            return redirect(f"/{filename}.html")
        if filename in {"login", "register"}:
            return redirect("/auth.html")
        if filename.endswith(".html") and filename[:-5] in PAGES:
            return render_template("local/page.html", page=f"pages/{filename}")
        # send_from_directory impede traversal; apenas a pasta pública é servida.
        return send_from_directory(ROOT / "docs", filename)

    from .api import api
    app.register_blueprint(api)
    return app
