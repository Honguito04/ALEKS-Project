"""Integración PostgreSQL real, opt-in con WEB_TEST_POSTGRES_URL.

Cada prueba crea y elimina un esquema propio; nunca usa tablas existentes.
"""
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.web_accounts import reserve_call
from app.web_store import initialize_web, web_db


@pytest.fixture
def postgres_store(monkeypatch, tmp_path):
    url = os.environ.get("WEB_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("WEB_TEST_POSTGRES_URL no configurada; requiere PostgreSQL real")
    import psycopg
    from psycopg import sql

    schema = "test_web_" + secrets.token_hex(8)
    with psycopg.connect(url) as conn:
        conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query["options"] = "-csearch_path=" + schema
    scoped_url = urlunsplit(parts._replace(query=urlencode(query)))
    monkeypatch.setattr(settings, "web_database_url", scoped_url)
    monkeypatch.setattr(settings, "web_public_url", "http://127.0.0.1:8000")
    monkeypatch.setattr(settings, "web_public_mode", False)
    monkeypatch.setattr(settings, "web_account_daily_calls", 3)
    monkeypatch.setattr(settings, "web_global_daily_calls", 5)
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "legacy.sqlite3"))
    try:
        initialize_web()
        yield scoped_url
    finally:
        with psycopg.connect(url) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def register(client, email="postgres@example.test"):
    csrf = client.get("/web-api/session").json()["csrf_token"]
    response = client.post("/web-api/register", json={"email": email, "password": "integration-password-42"},
                           headers={"Origin": settings.web_origin, "X-CSRF-Token": csrf})
    assert response.status_code == 201
    data = response.json()
    return data["user"]["id"], {"Origin": settings.web_origin, "X-CSRF-Token": data["csrf_token"]}


def test_accounts_survive_application_restart_and_logout_revokes_sessions(postgres_store):
    with TestClient(app) as first:
        _, headers = register(first)
        saved_cookies = dict(first.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(saved_cookies)
        assert restarted.get("/web-api/session").json()["user"]["email"] == "postgres@example.test"
        assert restarted.post("/web-api/logout", headers=headers).status_code == 204
    with TestClient(app) as stale:
        stale.cookies.update(saved_cookies)
        assert stale.get("/web-api/session").json()["user"] is None


def test_parallel_reservations_respect_both_limits_and_persist(postgres_store):
    with TestClient(app) as client:
        a, _ = register(client, "first@example.test")
    with TestClient(app) as client:
        b, _ = register(client, "second@example.test")

    def reserve(owner):
        try:
            reserve_call(owner)
            return owner
        except HTTPException as error:
            assert error.status_code == 429
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve, [a, b] * 12))
    successful = [owner for owner in results if owner]
    assert len(successful) == 5
    assert successful.count(a) <= 3 and successful.count(b) <= 3
    initialize_web()
    with web_db() as conn:
        usage = {row["owner"]: row["used"] for row in conn.execute("SELECT owner,used FROM web_quota").fetchall()}
    assert usage["global"] == 5
    assert usage[a] + usage[b] == 5


def test_account_quota_rejection_rolls_back_global_counter(postgres_store):
    with TestClient(app) as client:
        owner, _ = register(client)
    for _ in range(3):
        reserve_call(owner)
    with pytest.raises(HTTPException) as error:
        reserve_call(owner)
    assert error.value.status_code == 429
    with web_db() as conn:
        assert conn.execute("SELECT used FROM web_quota WHERE owner='global'").fetchone()["used"] == 3


def test_delete_rejects_wrong_password_then_cascades_sessions_without_resetting_global_quota(postgres_store):
    with TestClient(app) as client:
        owner, headers = register(client)
        reserve_call(owner)
        response = client.request("DELETE", "/web-api/account", json={"password": "wrong-password"}, headers=headers)
        assert response.status_code == 400
        assert client.get("/web-api/session").json()["user"]["id"] == owner
        response = client.request("DELETE", "/web-api/account", json={"password": "integration-password-42"}, headers=headers)
        assert response.status_code == 204
    with web_db() as conn:
        assert conn.execute("SELECT id FROM web_users").fetchall() == []
        assert conn.execute("SELECT id FROM web_sessions WHERE user_id IS NOT NULL").fetchall() == []
        assert conn.execute("SELECT used FROM web_quota WHERE owner=?", (owner,)).fetchone() is None
        assert conn.execute("SELECT used FROM web_quota WHERE owner='global'").fetchone()["used"] == 1


def test_public_startup_with_verified_postgres_tls_and_secure_session(postgres_store, monkeypatch):
    if dict(parse_qsl(urlsplit(postgres_store).query)).get("sslmode") != "verify-full":
        pytest.skip("Esta prueba de despliegue exige una conexión PostgreSQL TLS verify-full")
    monkeypatch.setattr(settings, "web_public_mode", True)
    monkeypatch.setattr(settings, "web_public_url", "https://web.example.test/")
    with TestClient(app, base_url="https://web.example.test") as client:
        owner, _ = register(client)
        assert client.get("/web-api/session").json()["user"]["id"] == owner
        response = client.get("/web-api/session")
        assert response.headers["strict-transport-security"] == "max-age=31536000"
        assert next(cookie for cookie in client.cookies.jar if cookie.name == "assistant_web_session").secure
        for path in ("/auth/demo", "/solve", "/assist", "/simulator/", "/docs"):
            assert client.post(path, headers={"Host": "127.0.0.1:8000"}).status_code == 404


def test_bridge_rotation_scoped_revoke_restart_and_session_cascade(postgres_store):
    from app.web_accounts import digest
    from app.web_bridge import bridge_origin

    with TestClient(app) as client:
        _, headers = register(client)
        old = client.post("/web-api/bridge-token", headers=headers).json()
        new = client.post("/web-api/bridge-token", headers=headers).json()
        bearer = {"Origin": bridge_origin(), "Authorization": "Bearer " + new["token"]}
        old_bearer = {**bearer, "Authorization": "Bearer " + old["token"]}
        assert client.get("/web-api/bridge/session", headers=old_bearer).status_code == 401
        assert client.request("DELETE", "/web-api/bridge-token", headers=headers,
                              json={"capability_id": old["capability_id"]}).status_code == 204
        assert client.get("/web-api/bridge/session", headers=bearer).status_code == 200
        cookies = dict(client.cookies)
    initialize_web()
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        assert restarted.get("/web-api/bridge/session", headers=bearer).status_code == 200
        with web_db() as conn:
            tokens = conn.execute("SELECT token_hash FROM web_bridge_tokens").fetchall()
        assert [row["token_hash"] for row in tokens] == [digest(new["token"])]
        assert restarted.post("/web-api/logout", headers=headers).status_code == 204
        assert restarted.get("/web-api/bridge/session", headers=bearer).status_code == 401
    with web_db() as conn:
        assert conn.execute("SELECT token_hash FROM web_bridge_tokens").fetchall() == []
