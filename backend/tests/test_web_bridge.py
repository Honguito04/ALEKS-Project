"""Bridge endpoints use mock Gemini transport; no external API calls."""
import asyncio
import json
import time
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import web_accounts, web_ai, web_bridge
from app.config import settings
from app.web_accounts import digest
from app.web_store import initialize_web, web_db

ORIGIN = "http://127.0.0.1:8000"
PASSWORD = "safe bridge password 2026"
CONTEXT = {"fingerprint": "a" * 64, "statement": "Calcula veinte más tres.",
           "fields": [{"key": "answer", "label": "Respuesta sin unidades"}],
           "diagram_required": False, "can_fill_integer": False}
PROPOSAL = {"status": "proposed", "answers": [{"field_key": "answer", "value": "23", "unit": ""}],
            "explanation": "Veinte más tres es veintitrés.", "missing_information": []}


@pytest.fixture
def bridge_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "web_database_url", "sqlite:///" + str(tmp_path / "bridge.sqlite3"))
    monkeypatch.setattr(settings, "web_public_mode", False)
    monkeypatch.setattr(settings, "web_public_url", ORIGIN)
    monkeypatch.setattr(settings, "web_account_daily_calls", 10)
    monkeypatch.setattr(settings, "web_global_daily_calls", 100)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-test-key")
    monkeypatch.setattr(settings, "gemini_model", "fake-test-model")

    @asynccontextmanager
    async def lifespan(app):
        initialize_web()
        try:
            yield
        finally:
            await web_ai.close_jobs()

    app = FastAPI(lifespan=lifespan)
    app.include_router(web_accounts.router)
    app.include_router(web_ai.router)
    app.include_router(web_bridge.router)
    with TestClient(app, base_url=ORIGIN) as client:
        yield client


@pytest.fixture
def gemini_calls(monkeypatch):
    calls = []
    async def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(PROPOSAL)}]}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return calls


def web_headers(client):
    return {"Origin": ORIGIN, "X-CSRF-Token": client.get("/web-api/session").json()["csrf_token"]}


def register(client, email="one@example.org"):
    response = client.post("/web-api/register", json={"email": email, "password": PASSWORD}, headers=web_headers(client))
    assert response.status_code == 201
    return response.json()["user"]


def issue(client):
    response = client.post("/web-api/bridge-token", headers=web_headers(client))
    assert response.status_code == 201, response.text
    return response.json()


def extension_headers(token):
    return {"Origin": web_bridge.bridge_origin(), "Authorization": "Bearer " + token}


def create(client, token):
    response = client.post("/web-api/bridge/jobs", json={"context": CONTEXT}, headers=extension_headers(token))
    assert response.status_code == 202, response.text
    return response.json()["id"]


def outcome(client, token, key):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(token))
        assert response.status_code == 200, response.text
        if response.json()["status"] != "pending":
            return response.json()
        time.sleep(.01)
    pytest.fail("Bridge job did not finish")


def test_issue_requires_cookie_auth_and_csrf(bridge_client):
    assert bridge_client.post("/web-api/bridge-token", headers={"Origin": ORIGIN}).status_code == 401
    register(bridge_client)
    assert bridge_client.post("/web-api/bridge-token", headers={"Origin": ORIGIN}).status_code == 403
    value = issue(bridge_client)
    assert set(value) == {"token", "capability_id", "expires_in", "expires_at", "user"}
    assert 3598 <= value["expires_in"] <= 3600
    assert len(value["token"]) == 43
    with web_db() as conn:
        stored = conn.execute("SELECT token_hash,session_id,expires FROM web_bridge_tokens").fetchall()
    assert len(stored) == 1
    assert stored[0]["token_hash"] == digest(value["token"])
    assert value["capability_id"] == digest(value["token"])
    assert value["token"] != stored[0]["token_hash"]
    response = bridge_client.get("/web-api/bridge/session", headers=extension_headers(value["token"]))
    assert response.status_code == 200
    assert response.json() == {"user": value["user"], "expires_at": value["expires_at"]}
    assert stored[0]["session_id"] not in response.text
    assert stored[0]["token_hash"] not in response.text


@pytest.mark.parametrize("origin", ["https://evil.example", ORIGIN, "null", "chrome-extension://" + "a" * 32, "chrome-extension://fjjgjakbpjhhegekcjogilmfheaicjge.evil.example", ""])
def test_bridge_checks_actual_exact_extension_origin(bridge_client, origin):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    headers = extension_headers(token)
    headers["Origin"] = origin
    assert bridge_client.get("/web-api/bridge/session", headers=headers).status_code == 403


def test_cookie_cannot_replace_explicit_bridge_bearer(bridge_client):
    register(bridge_client)
    issue(bridge_client)
    assert bridge_client.get("/web-api/bridge/session", headers={"Origin": web_bridge.bridge_origin()}).status_code == 401
    assert bridge_client.get("/web-api/bridge/session").status_code == 401
    assert bridge_client.post("/web-api/bridge/jobs", headers={"Origin": web_bridge.bridge_origin()}, json={"context": CONTEXT}).status_code == 401


def test_privileged_request_without_origin_still_requires_scoped_bearer(bridge_client):
    user = register(bridge_client)
    token = issue(bridge_client)["token"]
    response = bridge_client.get("/web-api/bridge/session", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 200
    assert response.json()["user"] == user
    assert bridge_client.get("/web-api/bridge/session", headers={"Authorization": "Bearer " + "x" * 43}).status_code == 401


def test_bridge_token_does_not_authenticate_web_account_or_jobs(bridge_client):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    with TestClient(bridge_client.app, base_url=ORIGIN) as extension:
        headers = extension_headers(token)
        assert extension.get("/web-api/session", headers=headers).json()["user"] is None
        assert extension.post("/web-api/jobs", headers=headers, json={"context": CONTEXT}).status_code == 403
        assert extension.request("DELETE", "/web-api/account", headers=headers, json={"password": PASSWORD}).status_code in (401, 403)
        assert extension.post("/web-api/bridge-token", headers=headers).status_code in (401, 403)


def test_rotation_replaces_previous_capability_and_cleans_jobs(bridge_client, gemini_calls):
    register(bridge_client)
    old = issue(bridge_client)["token"]
    key = create(bridge_client, old)
    outcome(bridge_client, old, key)
    new = issue(bridge_client)["token"]
    assert new != old
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(old)).status_code == 401
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(new)).status_code == 200
    assert bridge_client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(new)).status_code == 404
    with web_db() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM web_bridge_tokens").fetchone()["n"] == 1


def test_revoke_requires_csrf_and_cleans_jobs(bridge_client, gemini_calls):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    key = create(bridge_client, token)
    outcome(bridge_client, token, key)
    assert bridge_client.delete("/web-api/bridge-token", headers={"Origin": ORIGIN}).status_code == 403
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(token)).status_code == 200
    assert bridge_client.request("DELETE", "/web-api/bridge-token", headers=web_headers(bridge_client),
                                 json={"capability_id": digest(token)}).status_code == 204
    assert key not in web_ai.jobs
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(token)).status_code == 401


def test_delayed_revoke_preserves_new_capability_and_its_job(bridge_client, gemini_calls):
    register(bridge_client)
    old = issue(bridge_client)
    new = issue(bridge_client)
    key = create(bridge_client, new["token"])
    result = outcome(bridge_client, new["token"], key)
    for _ in range(2):
        response = bridge_client.request("DELETE", "/web-api/bridge-token", headers=web_headers(bridge_client),
                                         json={"capability_id": old["capability_id"]})
        assert response.status_code == 204
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(new["token"])).status_code == 200
    assert outcome(bridge_client, new["token"], key) == result


@pytest.mark.parametrize("body", [{}, {"capability_id": "bad"}, {"capability_id": "a" * 64, "all": True}])
def test_revoke_requires_exact_capability_shape(bridge_client, body):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    response = bridge_client.request("DELETE", "/web-api/bridge-token", headers=web_headers(bridge_client), json=body)
    assert response.status_code == 422
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(token)).status_code == 200


def test_cannot_revoke_another_sessions_capability(bridge_client, gemini_calls):
    register(bridge_client)
    own = issue(bridge_client)
    key = create(bridge_client, own["token"])
    outcome(bridge_client, own["token"], key)
    with TestClient(bridge_client.app, base_url=ORIGIN) as other:
        register(other, "other@example.org")
        response = other.request("DELETE", "/web-api/bridge-token", headers=web_headers(other),
                                 json={"capability_id": own["capability_id"]})
        assert response.status_code == 204
        assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(own["token"])).status_code == 200
        assert bridge_client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(own["token"])).status_code == 200


@pytest.mark.parametrize("action", ["logout", "delete"])
def test_logout_or_delete_revokes_original_session_capability(bridge_client, action):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    if action == "logout":
        response = bridge_client.post("/web-api/logout", headers=web_headers(bridge_client))
    else:
        response = bridge_client.request("DELETE", "/web-api/account", json={"password": PASSWORD}, headers=web_headers(bridge_client))
    assert response.status_code == 204
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(token)).status_code == 401
    with web_db() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM web_bridge_tokens").fetchone()["n"] == 0


@pytest.mark.parametrize("table", ["web_bridge_tokens", "web_sessions"])
def test_bridge_and_original_session_expiry_both_enforced(bridge_client, table):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    with web_db() as conn:
        conn.execute(f"UPDATE {table} SET expires=?", (time.time() - 1,))
    assert bridge_client.get("/web-api/bridge/session", headers=extension_headers(token)).status_code == 401
    assert not web_bridge.bridge_active(digest(token))


def test_capability_cannot_outlive_original_session(bridge_client):
    register(bridge_client)
    limit = time.time() + 120
    with web_db() as conn:
        conn.execute("UPDATE web_sessions SET expires=?", (limit,))
    value = issue(bridge_client)
    assert value["expires_at"] == limit
    assert 118 <= value["expires_in"] <= 120


def test_bridge_jobs_are_isolated_between_accounts(bridge_client, gemini_calls):
    user_one = register(bridge_client)
    token_one = issue(bridge_client)["token"]
    key = create(bridge_client, token_one)
    outcome(bridge_client, token_one, key)
    with TestClient(bridge_client.app, base_url=ORIGIN) as other:
        register(other, "two@example.org")
        token_two = issue(other)["token"]
        assert other.get("/web-api/bridge/jobs/" + key, headers=extension_headers(token_two)).status_code == 404
        assert other.delete("/web-api/bridge/jobs/" + key, headers=extension_headers(token_two)).status_code == 204
        assert bridge_client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(token_one)).status_code == 200
        assert web_ai.jobs[key].user_id == user_one["id"]


def test_bridge_calls_share_persistent_account_and_global_quotas(bridge_client, gemini_calls, monkeypatch):
    monkeypatch.setattr(settings, "web_account_daily_calls", 1)
    user = register(bridge_client)
    token = issue(bridge_client)["token"]
    first = outcome(bridge_client, token, create(bridge_client, token))
    assert first["status"] == "completed" and first["result"]["provider_calls"] == 1
    second = outcome(bridge_client, token, create(bridge_client, token))
    assert second["status"] == "error" and second["error"]["code"] == "quota"
    assert len(gemini_calls) == 1
    with web_db() as conn:
        used = {row["owner"]: row["used"] for row in conn.execute("SELECT owner,used FROM web_quota").fetchall()}
    assert used == {"global": 1, user["id"]: 1}


def test_bridge_can_delete_own_pending_job(bridge_client, monkeypatch):
    async def pending(*args):
        await asyncio.Event().wait()
    monkeypatch.setattr(web_ai, "consult_cloud", pending)
    register(bridge_client)
    token = issue(bridge_client)["token"]
    key = create(bridge_client, token)
    assert bridge_client.delete("/web-api/bridge/jobs/" + key, headers=extension_headers(token)).status_code == 204
    assert bridge_client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(token)).status_code == 404


def test_bridge_bulk_cancel_is_scoped_to_capability_jobs(bridge_client, gemini_calls):
    register(bridge_client)
    token = issue(bridge_client)["token"]
    bridge_key = create(bridge_client, token)
    outcome(bridge_client, token, bridge_key)
    web = bridge_client.post("/web-api/jobs", headers=web_headers(bridge_client), json={"context": CONTEXT})
    assert web.status_code == 202
    web_key = web.json()["id"]
    assert bridge_client.get("/web-api/bridge/jobs/" + web_key, headers=extension_headers(token)).status_code == 404
    assert bridge_client.delete("/web-api/bridge/jobs", headers=extension_headers(token)).status_code == 204
    assert bridge_client.get("/web-api/bridge/jobs/" + bridge_key, headers=extension_headers(token)).status_code == 404
    assert bridge_client.get("/web-api/jobs/" + web_key).status_code == 200


def test_expired_capability_prevents_visual_review_call(bridge_client, monkeypatch):
    calls = []
    async def handler(request):
        calls.append(request)
        visual = {**PROPOSAL, "observations": ["Dos cantidades: veinte y tres"],
                  "calculations": [{"field_key": "answer", "expression": "20+3", "decimal_places": None}]}
        with web_db() as conn:
            conn.execute("UPDATE web_bridge_tokens SET expires=?", (time.time() - 1,))
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(visual)}]}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    register(bridge_client)
    token = issue(bridge_client)["token"]
    response = bridge_client.post("/web-api/bridge/jobs", json={"context": {**CONTEXT, "diagram_required": True}, "image": "data:image/jpeg;base64,/9j//9k="}, headers=extension_headers(token))
    assert response.status_code == 202
    key = response.json()["id"]
    job = web_ai.jobs[key]
    deadline = time.monotonic() + 8
    while not job.task.done() and time.monotonic() < deadline:
        time.sleep(.01)
    assert job.task.done()
    assert len(calls) == 1
    assert job.result is None
    assert job.error["code"] == "session_expired"
    assert job.provider_calls == 1
    assert bridge_client.get("/web-api/bridge/jobs/" + key, headers=extension_headers(token)).status_code == 401
