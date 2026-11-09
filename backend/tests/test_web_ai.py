"""Provider transport is mocked; these tests do not call a live Gemini model."""
import asyncio
import json
import threading
import time
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import web_accounts, web_ai
from app.config import settings
from app.web_store import initialize_web, web_db


CONTEXT = {"fingerprint": "a" * 64, "statement": "Calcula el resultado de sumar veinte y tres.",
           "fields": [{"key": "answer", "label": "Respuesta sin unidades"}],
           "diagram_required": False, "can_fill_integer": False}
PROPOSAL = {"status": "proposed", "answers": [{"field_key": "answer", "value": "23", "unit": ""}],
            "explanation": "Veinte más tres es veintitrés.", "missing_information": []}
VISUAL = {**PROPOSAL, "answers": [{"field_key": "answer", "value": "1496", "unit": "cm^3"}],
          "observations": ["Ancho total 13 cm", "Altura 15 cm", "Profundidad 8 cm", "Hueco de ancho 8 cm y alturas laterales de 7 cm"],
          "calculations": [{"field_key": "answer", "expression": "13*15*8-8*(15-7-7)*8", "decimal_places": None}]}
IMAGE = "data:image/jpeg;base64,/9j//9k="
ORIGIN = "http://127.0.0.1:8000"
PASSWORD = "a long test password"


@pytest.fixture
def web_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "web_database_url", "sqlite:///" + str(tmp_path / "web.sqlite3"))
    monkeypatch.setattr(settings, "web_public_mode", False)
    monkeypatch.setattr(settings, "web_public_url", ORIGIN)
    monkeypatch.setattr(settings, "web_account_daily_calls", 10)
    monkeypatch.setattr(settings, "web_global_daily_calls", 100)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-server-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-2.5-flash")

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
    with TestClient(app, base_url=ORIGIN) as client:
        yield client


@pytest.fixture
def gemini(monkeypatch):
    calls, outputs = [], []

    async def handler(request):
        calls.append(request)
        assert request.url.host == "generativelanguage.googleapis.com"
        assert request.headers["x-goog-api-key"] == "fake-server-key"
        assert "fake-server-key" not in str(request.url)
        if outputs:
            output = outputs.pop(0)
            if callable(output):
                return await output(request)
            if isinstance(output, httpx.Response):
                return output
        else:
            output = PROPOSAL
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(output)}]}}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return calls, outputs


def register(client, email="one@example.com"):
    csrf = client.get("/web-api/session").json()["csrf_token"]
    response = client.post("/web-api/register", json={"email": email, "password": PASSWORD},
                           headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})
    assert response.status_code == 201, response.text
    return response.json()


def headers(account):
    return {"Origin": ORIGIN, "X-CSRF-Token": account["csrf_token"]}


def create(client, account, **body):
    response = client.post("/web-api/jobs", json={"context": CONTEXT, **body}, headers=headers(account))
    assert response.status_code == 202, response.text
    return response.json()["id"]


def completed(client, key):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        response = client.get("/web-api/jobs/" + key)
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["status"] != "pending":
            return payload
        time.sleep(.01)
    pytest.fail("Job did not complete")


def usage():
    with web_db() as conn:
        return {row["owner"]: row["used"] for row in conn.execute("SELECT owner,used FROM web_quota").fetchall()}


def test_cloud_transport_has_no_local_model_no_key_in_public_result_and_one_call(web_client, gemini):
    calls, _ = gemini
    account = register(web_client)
    body = completed(web_client, create(web_client, account))
    assert body["status"] == "completed"
    result = body["result"]
    assert result["proposal"] == PROPOSAL
    assert result["provider"] == "gemini" and result["provider_calls"] == 1
    assert result["verified"] is False and result["verification"] == "none"
    assert "fake-server-key" not in json.dumps(body)
    assert usage() == {"global": 1, account["user"]["id"]: 1}
    payload = json.loads(calls[0].content)
    assert "can_fill_integer" not in payload["contents"][0]["parts"][0]["text"]
    assert payload["generationConfig"]["responseJsonSchema"]["additionalProperties"] is False
    assert len(calls) == 1


def test_recognized_math_and_missing_diagram_need_no_provider_or_quota(web_client, gemini):
    account = register(web_client)
    recognized = {**CONTEXT, "statement": "Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?"}
    body = completed(web_client, create(web_client, account, context=recognized))["result"]
    assert body["provider"] == "deterministic" and body["verified"] is True
    assert body["proposal"]["answers"][0]["value"] == "12"
    missing = completed(web_client, create(web_client, account, context={**CONTEXT, "diagram_required": True}))["result"]
    assert missing["proposal"]["status"] == "needs_context"
    assert missing["provider_calls"] == 0
    assert gemini[0] == [] and usage() == {}


def test_visual_requires_arithmetic_and_second_review_but_is_not_verified(web_client, gemini):
    calls, outputs = gemini
    outputs.extend([VISUAL, {"status": "consistent", "issues": [], "missing_information": []}])
    account = register(web_client)
    body = completed(web_client, create(web_client, account, image=IMAGE))["result"]
    assert body["proposal"]["answers"] == VISUAL["answers"]
    assert body["verified"] is False and body["provider_calls"] == 2
    assert "13*15*8-8*(15-7-7)*8 = 1496" in body["proposal"]["explanation"]
    assert "no verifica independientemente" in body["proposal"]["explanation"]
    assert usage()["global"] == 2 and len(calls) == 2
    assert all(json.loads(call.content)["contents"][0]["parts"][1]["inlineData"]["data"] == IMAGE.split(",")[1] for call in calls)


@pytest.mark.parametrize("change", ["wrong_answer", "missing_calculation", "wrong_field", "no_observations"])
def test_visual_invalid_arithmetic_or_incomplete_evidence_discards_without_review(web_client, gemini, change):
    calls, outputs = gemini
    draft = json.loads(json.dumps(VISUAL))
    if change == "wrong_answer":
        draft["answers"][0]["value"] = "180"
    elif change == "missing_calculation":
        draft["calculations"] = []
    elif change == "wrong_field":
        draft["calculations"][0]["field_key"] = "other"
    else:
        draft["observations"] = []
    outputs.append(draft)
    account = register(web_client)
    body = completed(web_client, create(web_client, account, image=IMAGE))["result"]
    assert body["proposal"]["status"] == "unable_to_solve" and body["proposal"]["answers"] == []
    assert body["provider_calls"] == 1 and len(calls) == 1


def test_visual_rejected_geometry_releases_no_candidate(web_client, gemini):
    calls, outputs = gemini
    outputs.extend([VISUAL, {"status": "inconsistent", "issues": ["Las medidas no corresponden al objeto completo."], "missing_information": []}])
    account = register(web_client)
    body = completed(web_client, create(web_client, account, image=IMAGE))["result"]
    assert body["proposal"]["status"] == "unable_to_solve" and body["proposal"]["answers"] == []
    assert len(calls) == 2


def test_quota_is_reserved_before_every_call_even_visual_review(web_client, gemini, monkeypatch):
    monkeypatch.setattr(settings, "web_account_daily_calls", 1)
    calls, outputs = gemini
    outputs.append(VISUAL)
    account = register(web_client)
    body = completed(web_client, create(web_client, account, image=IMAGE))
    assert body["status"] == "error" and body["error"]["code"] == "quota"
    assert "result" not in body and len(calls) == 1 and usage()["global"] == 1
    again = completed(web_client, create(web_client, account))
    assert again["error"]["code"] == "quota" and len(calls) == 1


@pytest.mark.parametrize("provider_response,code", [
    (httpx.Response(429, text="PRIVATE_API_ERROR"), "provider_quota"),
    (httpx.Response(403, text="PRIVATE_API_ERROR"), "provider_configuration"),
    (httpx.Response(500, text="PRIVATE_API_ERROR"), "provider_unavailable"),
    (httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS"}]}), "invalid_output"),
    (httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}), "invalid_output"),
    (httpx.Response(200, text="PRIVATE_NOT_JSON"), "invalid_output"),
])
def test_provider_failures_are_public_safe_charged_once_and_never_retried(web_client, gemini, provider_response, code):
    calls, outputs = gemini
    outputs.append(provider_response)
    account = register(web_client)
    body = completed(web_client, create(web_client, account))
    assert body["status"] == "error" and body["error"]["code"] == code
    assert "PRIVATE" not in json.dumps(body) and "fake-server-key" not in json.dumps(body)
    assert len(calls) == 1 and usage()["global"] == 1


def test_timeout_is_distinct_and_not_retried(web_client, gemini):
    calls, outputs = gemini
    async def timeout(request):
        raise httpx.ReadTimeout("PRIVATE_TIMEOUT")
    outputs.append(timeout)
    account = register(web_client)
    body = completed(web_client, create(web_client, account))
    assert body["error"]["code"] == "timeout" and len(calls) == 1
    assert "PRIVATE" not in json.dumps(body)


def test_jobs_isolated_csrf_cancelled_and_cleared_on_logout(web_client, gemini):
    calls, outputs = gemini
    async def slow(request):
        await asyncio.sleep(30)
        return httpx.Response(500)
    outputs.append(slow)
    account = register(web_client)
    cookies = dict(web_client.cookies)
    assert web_client.post("/web-api/jobs", json={"context": CONTEXT}).status_code == 403
    key = create(web_client, account)
    assert web_client.delete("/web-api/jobs/" + key).status_code == 403
    web_client.cookies.clear()
    other = register(web_client, "other@example.com")
    assert web_client.get("/web-api/jobs/" + key).status_code == 404
    assert web_client.delete("/web-api/jobs/" + key, headers=headers(other)).status_code == 204
    web_client.cookies.clear()
    web_client.cookies.update(cookies)
    assert web_client.get("/web-api/jobs/" + key).json()["status"] == "pending"
    assert web_client.post("/web-api/logout", headers=headers(account)).status_code == 204
    assert key not in web_ai.jobs
    assert web_client.get("/web-api/jobs/" + key).status_code == 401


def test_cancel_all_idempotent_and_no_late_result(web_client, gemini):
    calls, outputs = gemini
    async def slow(request):
        await asyncio.sleep(30)
        return httpx.Response(500)
    outputs.append(slow)
    account = register(web_client)
    key = create(web_client, account)
    assert web_client.delete("/web-api/jobs", headers=headers(account)).status_code == 204
    assert web_client.delete("/web-api/jobs/" + key, headers=headers(account)).status_code == 204
    assert web_client.get("/web-api/jobs/" + key).status_code == 404
    assert key not in web_ai.jobs


def test_restart_drops_job_without_repeating_provider_call(web_client, gemini):
    account = register(web_client)
    key = create(web_client, account)
    completed(web_client, key)
    before = len(gemini[0])
    web_ai.jobs.clear()
    response = web_client.get("/web-api/jobs/" + key)
    assert response.status_code == 404 and "reiniciar" in response.json()["detail"]
    assert len(gemini[0]) == before


def test_logout_during_visual_arithmetic_prevents_review_and_late_result(web_client, gemini, monkeypatch):
    started, release = threading.Event(), threading.Event()
    def checking(items):
        started.set()
        assert release.wait(timeout=5)
        return "consistent"
    monkeypatch.setattr(web_ai, "check_calculations", checking)
    gemini[1].append(VISUAL)
    account = register(web_client)
    key = create(web_client, account, image=IMAGE)
    try:
        assert started.wait(timeout=3)
        assert web_client.post("/web-api/logout", headers=headers(account)).status_code == 204
    finally:
        release.set()
    assert key not in web_ai.jobs
    assert web_client.get("/web-api/jobs/" + key).status_code == 401
    assert len(gemini[0]) == 1 and usage()["global"] == 1


@pytest.mark.parametrize("review", [
    {"status": "needs_context", "issues": [], "missing_information": ["Profundidad ilegible"]},
    {"status": "consistent", "issues": ["Contradicción"], "missing_information": []},
    httpx.Response(429, text="PRIVATE_ERROR"),
])
def test_incomplete_failed_or_contradictory_review_never_releases_candidate(web_client, gemini, review):
    gemini[1].extend([VISUAL, review])
    account = register(web_client)
    body = completed(web_client, create(web_client, account, image=IMAGE))
    if body["status"] == "completed":
        assert body["result"]["proposal"]["status"] == "needs_context"
        assert body["result"]["proposal"]["answers"] == []
    else:
        assert body["status"] == "error" and "result" not in body
    assert len(gemini[0]) == 2 and usage()["global"] == 2


def test_missing_server_key_fails_without_charging_or_calling_provider(web_client, gemini, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    account = register(web_client)
    body = completed(web_client, create(web_client, account))
    assert body["error"]["code"] == "not_configured" and gemini[0] == [] and usage() == {}


def test_malformed_image_rejected_before_job_creation(web_client, gemini):
    account = register(web_client)
    response = web_client.post("/web-api/jobs", json={"context": CONTEXT, "image": "data:image/jpeg;base64,wrong"}, headers=headers(account))
    assert response.status_code == 422 and not web_ai.jobs and gemini[0] == []


def test_finished_jobs_do_not_let_one_account_exhaust_shared_capacity(web_client, gemini):
    account = register(web_client)
    recognized = {**CONTEXT, "statement": "Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?"}
    keys = []
    for _ in range(15):
        key = create(web_client, account, context=recognized)
        assert completed(web_client, key)["status"] == "completed"
        keys.append(key)
    assert len(web_ai.jobs) == 10
    assert web_client.get("/web-api/jobs/" + keys[0]).status_code == 404
    assert web_client.get("/web-api/jobs/" + keys[-1]).status_code == 200
    assert gemini[0] == []


def test_pending_queries_per_account_are_bounded_before_more_provider_calls(web_client, gemini):
    async def slow(request):
        await asyncio.sleep(30)
        return httpx.Response(500)
    gemini[1].extend([slow, slow])
    account = register(web_client)
    create(web_client, account)
    create(web_client, account)
    response = web_client.post("/web-api/jobs", json={"context": CONTEXT}, headers=headers(account))
    assert response.status_code == 429 and len(gemini[0]) == 2


def test_global_pending_limit_bounds_resources_before_consuming_quota(web_client, gemini):
    async def slow(request):
        await asyncio.sleep(30)
        return httpx.Response(500)
    gemini[1].extend([slow] * 4)
    for index in range(4):
        account = register(web_client, f"pending{index}@example.com")
        create(web_client, account)
    account = register(web_client, "last@example.com")
    response = web_client.post("/web-api/jobs", json={"context": CONTEXT}, headers=headers(account))
    assert response.status_code == 429
    assert len(gemini[0]) == 4 and usage()["global"] == 4
