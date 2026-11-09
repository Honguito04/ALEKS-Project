import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.config import normalize_web_origin, settings
from app.web_accounts import COOKIE, digest, initialize_web, reserve_call, router
from app.web_store import web_db

ORIGIN = "http://127.0.0.1:8000"
PASSWORD = "a safe password 492!"


@pytest.fixture
def web_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "web_database_url", "sqlite:///" + str(tmp_path / "accounts.sqlite3"))
    monkeypatch.setattr(settings, "web_public_url", ORIGIN)
    monkeypatch.setattr(settings, "web_public_mode", False)
    monkeypatch.setattr(settings, "web_account_daily_calls", 3)
    monkeypatch.setattr(settings, "web_global_daily_calls", 5)
    initialize_web()
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def headers(client):
    return {"Origin": ORIGIN, "X-CSRF-Token": client.get("/web-api/session").json()["csrf_token"]}


def register(client, email="user@example.org"):
    response = client.post("/web-api/register", json={"email": email, "password": PASSWORD}, headers=headers(client))
    assert response.status_code == 201, response.text
    return response.json()


def test_password_hashes_sessions_and_rotation(web_client):
    before = web_client.get("/web-api/session")
    anon_cookie = web_client.cookies.get(COOKIE)
    assert before.json()["user"] is None
    assert "httponly" in before.headers["set-cookie"].lower()
    assert "samesite=strict" in before.headers["set-cookie"].lower()
    result = register(web_client)
    cookie = web_client.cookies.get(COOKIE)
    assert cookie != anon_cookie
    assert set(result) == {"user", "csrf_token"}
    assert PASSWORD not in web_client.get("/web-api/session").text
    with web_db() as conn:
        user = conn.execute("SELECT password_hash FROM web_users").fetchone()
        session = conn.execute("SELECT id FROM web_sessions WHERE user_id IS NOT NULL").fetchone()
    assert user["password_hash"].startswith("scrypt$")
    assert PASSWORD not in user["password_hash"]
    assert session["id"] == digest(cookie)
    assert session["id"] != cookie


@pytest.mark.parametrize("route,method", [("/register", "post"), ("/login", "post"), ("/logout", "post"), ("/account", "delete")])
def test_csrf_is_required(web_client, route, method):
    register(web_client)
    body = {"password": PASSWORD} if route == "/account" else {"email": "x@example.org", "password": PASSWORD}
    response = web_client.request(method, "/web-api" + route, json=body, headers={"Origin": ORIGIN})
    assert response.status_code == 403


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://127.0.0.1:8000.evil.example"])
def test_csrf_origin_is_exact(web_client, origin):
    h = headers(web_client)
    h["Origin"] = origin
    assert web_client.post("/web-api/login", headers=h, json={"email": "u@example.org", "password": PASSWORD}).status_code == 403


def test_logout_revokes_every_session_and_account_survives(web_client):
    register(web_client)
    cookie = web_client.cookies.get(COOKIE)
    with TestClient(web_client.app) as other:
        assert other.post("/web-api/login", headers=headers(other), json={"email": "user@example.org", "password": PASSWORD}).status_code == 200
        assert web_client.post("/web-api/logout", headers=headers(web_client)).status_code == 204
        assert other.get("/web-api/session").json()["user"] is None
    web_client.cookies.clear()
    web_client.cookies.set(COOKIE, cookie, domain="testserver.local", path="/web-api")
    assert web_client.get("/web-api/session").json()["user"] is None
    assert web_client.post("/web-api/login", headers=headers(web_client), json={"email": "user@example.org", "password": PASSWORD}).status_code == 200


def test_deleted_account_bad_password_keeps_session(web_client):
    user = register(web_client)["user"]
    response = web_client.request("DELETE", "/web-api/account", json={"password": "wrong"}, headers=headers(web_client))
    assert response.status_code == 400
    assert web_client.get("/web-api/session").json()["user"] == user
    reserve_call(user["id"])
    assert web_client.request("DELETE", "/web-api/account", json={"password": PASSWORD}, headers=headers(web_client)).status_code == 204
    assert web_client.get("/web-api/session").json()["user"] is None
    with web_db() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM web_users").fetchone()["n"] == 0
        assert conn.execute("SELECT COUNT(*) AS n FROM web_sessions WHERE user_id IS NOT NULL").fetchone()["n"] == 0
        assert conn.execute("SELECT COUNT(*) AS n FROM web_quota WHERE owner=?", (user["id"],)).fetchone()["n"] == 0
        # Eliminar cuentas no devuelve cuota global.
        assert conn.execute("SELECT used FROM web_quota WHERE owner='global'").fetchone()["used"] == 1


def test_individual_salt_and_email_normalization(web_client):
    register(web_client, "User@Example.Org")
    assert web_client.get("/web-api/session").json()["user"]["email"] == "user@example.org"
    register(web_client, "second@example.org")
    with web_db() as conn:
        hashes = [row["password_hash"] for row in conn.execute("SELECT password_hash FROM web_users").fetchall()]
    assert hashes[0] != hashes[1]


def test_account_persistence_and_expired_session(web_client):
    user = register(web_client)["user"]
    initialize_web()
    assert web_client.get("/web-api/session").json()["user"] == user
    with web_db() as conn:
        conn.execute("UPDATE web_sessions SET expires=?", (time.time() - 1,))
    assert web_client.get("/web-api/session").json()["user"] is None
    assert web_client.post("/web-api/login", headers=headers(web_client), json={"email": "user@example.org", "password": PASSWORD}).status_code == 200


def test_login_rate_limit_persists(web_client):
    register(web_client)
    h = headers(web_client)
    for _ in range(10):
        response = web_client.post("/web-api/login", headers=h, json={"email": "user@example.org", "password": "incorrect password"})
        assert response.status_code == 401
    initialize_web()
    assert web_client.post("/web-api/login", headers=h, json={"email": "user@example.org", "password": PASSWORD}).status_code == 429


def test_registration_is_throttled(web_client):
    h = headers(web_client)
    for _ in range(3):
        assert web_client.post("/web-api/register", headers=h, json={"email": "user@example.org", "password": PASSWORD}).status_code in (201, 409)
        h = headers(web_client)
    # Contador por correo, incluso solicitudes repetidas rechazadas.
    response = web_client.post("/web-api/register", headers=h, json={"email": "user@example.org", "password": PASSWORD})
    assert response.status_code == 429


def test_anonymous_session_creation_is_throttled_but_refresh_is_not(web_client):
    for _ in range(60):
        web_client.cookies.clear()
        assert web_client.get("/web-api/session").status_code == 200
    for _ in range(5):
        assert web_client.get("/web-api/session").status_code == 200
    web_client.cookies.clear()
    initialize_web()
    assert web_client.get("/web-api/session").status_code == 429
    with web_db() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM web_sessions").fetchone()["n"] == 60


def test_persistent_daily_quotas_atomic(web_client):
    user = register(web_client)["user"]["id"]
    def reserve(_):
        try:
            reserve_call(user)
            return True
        except HTTPException as error:
            assert error.status_code == 429
            return False
    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(reserve, range(10))) == 3
    initialize_web()
    assert reserve(None) is False
    second = register(web_client, "other@example.org")["user"]["id"]
    reserve_call(second)
    reserve_call(second)
    with pytest.raises(HTTPException) as error:
        reserve_call(second)
    assert error.value.status_code == 429


def test_unknown_quota_account_rejected(web_client):
    with pytest.raises(HTTPException) as error:
        reserve_call("deleted")
    assert error.value.status_code == 401


@pytest.mark.parametrize("origin,expected", [("https://EXAMPLE.org:443/", "https://example.org"), ("http://EXAMPLE.org:80", "http://example.org"), ("https://example.org:8443/", "https://example.org:8443")])
def test_normalized_origins(origin, expected):
    assert normalize_web_origin(origin) == expected


@pytest.mark.parametrize("origin", ["https://example.org/app", "https://u:p@example.org", "https://example.org?key=x", "javascript:bad"])
def test_invalid_origins(origin):
    with pytest.raises(ValueError):
        normalize_web_origin(origin)


def test_https_cookie_secure(web_client, monkeypatch):
    monkeypatch.setattr(settings, "web_public_url", "https://EXAMPLE.org:443/")
    with TestClient(web_client.app, base_url="https://example.org") as client:
        response = client.get("/web-api/session")
        assert "secure" in response.headers["set-cookie"].lower()
        assert client.post("/web-api/register", json={"email": "user@example.org", "password": PASSWORD}, headers={"Origin": "https://example.org", "X-CSRF-Token": response.json()["csrf_token"]}).status_code == 201


def test_public_deployment_fails_closed(web_client, monkeypatch):
    monkeypatch.setattr(settings, "web_public_mode", True)
    with pytest.raises(ValueError):
        initialize_web()
    monkeypatch.setattr(settings, "web_public_url", "https://example.org")
    with pytest.raises(ValueError):
        initialize_web()
    monkeypatch.setattr(settings, "web_database_url", "postgresql://example/db?sslmode=require")
    with pytest.raises(ValueError, match="verify-full"):
        initialize_web()
