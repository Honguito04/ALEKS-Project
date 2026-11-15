"""A ZIP upgrade must not change the database that owns the account."""
import importlib.util
from pathlib import Path
import sqlite3
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

spec = importlib.util.spec_from_file_location("local_web_profile", Path(__file__).parents[2] / "scripts/local-web-profile.py")
profile_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile_module)


@pytest.fixture
def local_profile(tmp_path, monkeypatch):
    for name in ("DATABASE_PATH", "WEB_DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "web_database_url", "")
    monkeypatch.setattr(settings, "web_public_mode", False)
    monkeypatch.setattr(settings, "web_public_url", "http://127.0.0.1:8000")
    old = tmp_path / "old-zip"
    new = tmp_path / "new-zip"
    persistent = tmp_path / "AppData" / "ALEKS-Project"
    for folder in (old, new):
        folder.mkdir()
        (folder / ".env.example").write_text("DATABASE_PATH=.runtime/assistant.sqlite3\n")
    (old / ".env").write_text("DATABASE_PATH=.runtime/assistant.sqlite3\nGEMINI_API_KEY=synthetic-kept-key\n")
    return old, new, persistent


def headers(client):
    return {"origin": settings.web_origin, "x-csrf-token": client.get("/web-api/session").json()["csrf_token"]}


def test_real_account_survives_migration_restart_and_new_zip(local_profile, monkeypatch):
    old, new, persistent = local_profile
    credentials = {"email": "zip-upgrade@example.test", "password": "a persistent test password"}
    monkeypatch.setattr(settings, "database_path", str(old / ".runtime/assistant.sqlite3"))
    with TestClient(app) as client:
        registration = client.post("/web-api/register", json=credentials, headers=headers(client))
        assert registration.status_code == 201
        account_id = registration.json()["user"]["id"]
    profile_module.prepare_profile(old, persistent)
    monkeypatch.setattr(settings, "database_path", str(persistent / ".runtime/assistant.sqlite3"))
    with TestClient(app) as client:
        login = client.post("/web-api/login", json=credentials, headers=headers(client))
        assert login.status_code == 200
        assert login.json()["user"]["id"] == account_id
    # Later ZIP contains a blank example and has no .runtime or .env.
    profile_module.prepare_profile(new, persistent)
    assert "synthetic-kept-key" in (persistent / ".env").read_text()
    with TestClient(app) as client:
        login = client.post("/web-api/login", json=credentials, headers=headers(client))
        assert login.status_code == 200
        assert login.json()["user"]["id"] == account_id
        wrong = client.post("/web-api/login", json={**credentials, "password": "a different test password"}, headers=headers(client))
        assert wrong.status_code == 401


def database(path, email):
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE web_users (email TEXT)")
    if email:
        connection.execute("INSERT INTO web_users VALUES (?)", (email,))
    connection.commit()
    return connection


def test_migration_includes_committed_wal_pages(local_profile):
    old, _, persistent = local_profile
    source = old / ".runtime/assistant.sqlite3.web.sqlite3"
    connection = database(source, "committed-in-wal@example.test")
    try:
        assert Path(str(source) + "-wal").exists()
        profile_module.prepare_profile(old, persistent)
        assert profile_module.account_count(persistent / ".runtime/assistant.sqlite3.web.sqlite3") == 1
        assert connection.execute("SELECT email FROM web_users").fetchone()[0] == "committed-in-wal@example.test"
    finally:
        connection.close()


def test_explicit_recovery_refuses_to_replace_populated_profile(local_profile):
    old, new, persistent = local_profile
    database(old / ".runtime/assistant.sqlite3.web.sqlite3", "old@example.test").close()
    database(persistent / ".runtime/assistant.sqlite3.web.sqlite3", "new@example.test").close()
    with pytest.raises(RuntimeError, match="ya contiene cuentas"):
        profile_module.prepare_profile(new, persistent, import_from=old)
    with sqlite3.connect(persistent / ".runtime/assistant.sqlite3.web.sqlite3") as connection:
        assert connection.execute("SELECT email FROM web_users").fetchone()[0] == "new@example.test"


@pytest.mark.parametrize("table", ["sessions", "history", "users"])
def test_recovery_keeps_panel_google_data_even_when_web_has_no_accounts(local_profile, table):
    old, new, persistent = local_profile
    database(old / ".runtime/assistant.sqlite3.web.sqlite3", "old@example.test").close()
    panel = persistent / ".runtime/assistant.sqlite3"
    panel.parent.mkdir(parents=True)
    with sqlite3.connect(panel) as connection:
        connection.execute(f"CREATE TABLE {table} (subject TEXT)")
        connection.execute(f"INSERT INTO {table} VALUES (?)", ("google:user-to-keep",))
    with pytest.raises(RuntimeError, match="datos del panel"):
        profile_module.prepare_profile(new, persistent, import_from=old)
    with sqlite3.connect(panel) as connection:
        assert connection.execute(f"SELECT subject FROM {table}").fetchone()[0] == "google:user-to-keep"
    assert not (persistent / ".runtime/assistant.sqlite3.web.sqlite3").exists()


def test_explicit_recovery_into_empty_profile_keeps_configuration_and_backup(local_profile):
    old, new, persistent = local_profile
    database(old / ".runtime/assistant.sqlite3.web.sqlite3", "old@example.test").close()
    profile_module.prepare_profile(new, persistent)
    database(persistent / ".runtime/assistant.sqlite3.web.sqlite3", None).close()
    (persistent / ".env").write_text("GEMINI_API_KEY=already-configured\n")
    profile_module.prepare_profile(new, persistent, import_from=old)
    assert profile_module.account_count(persistent / ".runtime/assistant.sqlite3.web.sqlite3") == 1
    assert profile_module.account_count(persistent / ".runtime/assistant.sqlite3.web.sqlite3.before-import") == 0
    assert (persistent / ".env").read_text() == "GEMINI_API_KEY=already-configured\n"


def test_explicit_recovery_restores_configuration_over_unchanged_example(local_profile):
    old, new, persistent = local_profile
    database(old / ".runtime/assistant.sqlite3.web.sqlite3", "old@example.test").close()
    profile_module.prepare_profile(new, persistent)
    profile_module.prepare_profile(new, persistent, import_from=old)
    assert (persistent / ".env").read_bytes() == (old / ".env").read_bytes()


def test_settings_read_the_selected_profile_even_from_another_zip(local_profile):
    old, new, persistent = local_profile
    profile_module.prepare_profile(old, persistent)
    result = subprocess.run([sys.executable, "-c", "from app.config import settings; assert settings.gemini_api_key == 'synthetic-kept-key'"],
                            cwd=new, env={**os.environ, "ALEKS_ENV_FILE": str(persistent / ".env"),
                                          "PYTHONPATH": str(Path(__file__).parents[1])}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("setting", ["WEB_DATABASE_URL=postgresql://example.test/db", "WEB_DATABASE_URL=sqlite:///custom.sqlite3", "DATABASE_PATH=/custom.sqlite3"])
def test_custom_database_is_not_silently_replaced(local_profile, setting):
    old, _, persistent = local_profile
    (old / ".env").write_text(setting)
    with pytest.raises(RuntimeError, match="personalizada"):
        profile_module.prepare_profile(old, persistent)
    assert not persistent.exists()
