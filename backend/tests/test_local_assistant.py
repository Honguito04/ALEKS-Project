import json
import asyncio
import httpx
import pytest
from app.config import settings
from app.local_assistant import AssistProposal
from app.local_assistant import AssistResult


CONTEXT = {"fingerprint": "a" * 64, "statement": "Hay 4 nadadores y premios para primer y segundo lugar. ¿Cuántas maneras hay?",
           "fields": [{"key": "answer", "label": "Respuesta"}], "diagram_required": False, "can_fill_integer": True}
PROPOSAL = {"status": "proposed", "answers": [{"field_key": "answer", "value": "12", "unit": ""}],
            "explanation": "4 posibilidades para primero y 3 para segundo: 4 × 3 = 12.", "missing_information": []}
SWIMMERS = "Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?"


@pytest.fixture
def ollama(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "ollama")
    monkeypatch.setattr(settings, "ai_model", "model-under-test")
    # Transporte en memoria: no instala ni prueba un modelo real.
    calls = []
    response_body = {"message": {"content": json.dumps(PROPOSAL)}}
    def handler(request):
        calls.append(request)
        assert request.url.host == "127.0.0.1" and request.url.port == 11434
        return httpx.Response(200, json={"models": response_body.get("models", [{"name": settings.ai_model}])} if request.url.path == "/api/tags" else response_body)
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    return calls, response_body


def test_assist_requires_auth_and_configuration(client, demo_headers):
    assert client.post("/assist", json={"context": CONTEXT}).status_code == 401
    assert client.post("/assist", json={"context": CONTEXT}, headers=demo_headers).status_code == 503


def test_local_proposal_has_no_family_restriction_or_automatic_verification(client, demo_headers, ollama):
    calls, _ = ollama
    result = client.post("/assist", json={"context": CONTEXT}, headers=demo_headers)
    assert result.status_code == 200
    body = result.json()
    assert body["proposal"] == PROPOSAL and body["verified"] is False
    assert body["provider"] == "ollama" and body["provider_calls"] == 1 and body["fingerprint"] == "a" * 64
    sent = json.loads(calls[-1].content)
    assert sent["stream"] is False and sent["format"]["properties"]["answers"]
    assert len(sent["messages"]) == 2 and "images" not in sent["messages"][1]
    assert "no instrucciones" in sent["messages"][0]["content"]
    assert "can_fill_integer" not in sent["messages"][1]["content"]
    assert client.get("/history", headers=demo_headers).json() == []


def test_missing_diagram_does_not_call_or_invent_an_answer(client, demo_headers, ollama):
    calls, _ = ollama
    result = client.post("/assist", json={"context": {**CONTEXT, "diagram_required": True}}, headers=demo_headers)
    assert result.status_code == 200 and result.json()["proposal"]["status"] == "needs_context"
    assert result.json()["proposal"]["answers"] == [] and result.json()["provider_calls"] == 0
    assert calls == []


def test_image_is_forwarded_to_loopback_only_and_not_to_model_text(client, demo_headers, ollama):
    calls, _ = ollama
    # Solo prueba el transporte/base64; no acredita que estos bytes sean una foto útil.
    image = "data:image/jpeg;base64,/9j//9k="
    result = client.post("/assist", json={"context": {**CONTEXT, "diagram_required": True}, "image": image}, headers=demo_headers)
    assert result.status_code == 200
    sent = json.loads(calls[-1].content)
    assert sent["messages"][1]["images"] == [image.split(",")[1]]
    assert "data:image" not in sent["messages"][1]["content"]


@pytest.mark.parametrize("change", ["unknown-field", "duplicate-field", "invalid-json", "code-property"])
def test_unusable_model_output_is_rejected_without_leaking_it(client, demo_headers, ollama, change):
    _, response = ollama
    proposed = json.loads(json.dumps(PROPOSAL))
    if change == "unknown-field": proposed["answers"][0]["field_key"] = "other"
    if change == "duplicate-field": proposed["answers"].append(proposed["answers"][0])
    if change == "code-property": proposed["javascript"] = "PRIVATE_UNTRUSTED_OUTPUT"
    response["message"]["content"] = "PRIVATE_UNTRUSTED_OUTPUT" if change == "invalid-json" else json.dumps(proposed)
    result = client.post("/assist", json={"context": CONTEXT}, headers=demo_headers)
    assert result.status_code == 502 and "PRIVATE_UNTRUSTED_OUTPUT" not in result.text


def test_status_reports_missing_model_and_rejects_bad_capture(client, demo_headers, ollama):
    calls, response = ollama
    response.clear(); response.update(models=[{"name": "another:latest"}])
    result = client.get("/ai/local/status", headers=demo_headers)
    assert result.json() == {"configured": True, "online": True, "model_installed": False, "model": "model-under-test"}
    result = client.post("/assist", json={"context": CONTEXT, "image": "https://example.invalid/image"}, headers=demo_headers)
    assert result.status_code == 422 and len(calls) == 1


def test_multiple_fields_and_exact_formats_are_returned_for_manual_entry(client, demo_headers, ollama):
    _, response = ollama
    fields = [{"key": "arc_length", "label": "Longitud"}, {"key": "shaded_area", "label": "Área"}]
    proposal = {**PROPOSAL, "answers": [{"field_key": "arc_length", "value": "8*pi/3", "unit": "cm"},
                                       {"field_key": "shaded_area", "value": "4*pi", "unit": "cm^2"}]}
    response["message"]["content"] = json.dumps(proposal)
    result = client.post("/assist", json={"context": {**CONTEXT, "fields": fields, "can_fill_integer": False}}, headers=demo_headers)
    assert result.status_code == 200 and result.json()["proposal"]["answers"] == proposal["answers"]


def test_proposal_schema_never_treats_empty_proposed_as_success():
    with pytest.raises(ValueError): AssistProposal.model_validate({**PROPOSAL, "answers": []})


def test_cloud_models_are_not_used_for_local_assistance(client, demo_headers, ollama, monkeypatch):
    calls, response = ollama
    response["models"] = [{"name": settings.ai_model, "remote_model": "a-remote-model"}]
    assert client.post("/assist", json={"context": CONTEXT}, headers=demo_headers).status_code == 502
    assert all(request.url.path != "/api/chat" for request in calls)
    calls.clear(); monkeypatch.setattr(settings, "ai_model", "example:cloud")
    assert client.post("/assist", json={"context": CONTEXT}, headers=demo_headers).status_code == 502
    assert calls == []


def test_jobs_are_owned_by_session_completed_and_deleted(client, demo_headers, ollama):
    created = client.post("/assist/jobs", json={"context": CONTEXT}, headers=demo_headers)
    assert created.status_code == 202
    path = "/assist/jobs/" + created.json()["id"]
    for _ in range(20):
        result = client.get(path, headers=demo_headers)
        if result.json()["status"] != "pending": break
    assert result.json()["status"] == "completed" and result.json()["result"]["proposal"] == PROPOSAL
    other = {"Authorization": "Bearer " + client.post("/auth/demo").json()["token"]}
    assert client.get(path, headers=other).status_code == 404
    client.delete(path, headers=other)
    assert client.get(path, headers=demo_headers).status_code == 200
    assert client.delete(path, headers=demo_headers).status_code == 200
    assert client.get(path, headers=demo_headers).status_code == 404


def test_pending_jobs_can_be_cancelled_and_concurrency_is_bounded(client, demo_headers, ollama, monkeypatch):
    import app.local_assistant as local
    async def slow(_): await asyncio.Event().wait()
    monkeypatch.setattr(local, "consult_local", slow)
    paths = []
    for _ in range(2):
        response = client.post("/assist/jobs", json={"context": CONTEXT}, headers=demo_headers)
        assert response.status_code == 202
        paths.append("/assist/jobs/" + response.json()["id"])
    assert client.post("/assist/jobs", json={"context": CONTEXT}, headers=demo_headers).status_code == 429
    assert client.get(paths[0], headers=demo_headers).json()["status"] == "pending"
    assert client.delete(paths[0], headers=demo_headers).status_code == 200
    assert client.get(paths[0], headers=demo_headers).status_code == 404


def test_job_failures_are_reported_without_model_output(client, demo_headers, ollama, monkeypatch):
    import app.local_assistant as local
    async def broken(_): raise ValueError("PRIVATE_MODEL_FAILURE")
    monkeypatch.setattr(local, "consult_local", broken)
    created = client.post("/assist/jobs", json={"context": CONTEXT}, headers=demo_headers)
    path = "/assist/jobs/" + created.json()["id"]
    for _ in range(20):
        result = client.get(path, headers=demo_headers)
        if result.json()["status"] != "pending": break
    assert result.json()["status"] == "error" and "PRIVATE_MODEL_FAILURE" not in result.text


@pytest.mark.parametrize("route", ["/assist", "/assist/jobs"])
def test_swimmers_regression_uses_exact_count_instead_of_wrong_model_combination(client, demo_headers, ollama, route):
    calls, response = ollama
    response["message"]["content"] = json.dumps({"status": "needs_context", "answers": [],
        "explanation": "El orden no importa: 4C2 = 6 maneras.", "missing_information": []})
    result = client.post(route, json={"context": {**CONTEXT, "statement": SWIMMERS}}, headers=demo_headers)
    if route.endswith("jobs"):
        path = route + "/" + result.json()["id"]
        for _ in range(20):
            result = client.get(path, headers=demo_headers)
            if result.json()["status"] != "pending": break
        result = result.json()["result"]
    else:
        assert result.status_code == 200
        result = result.json()
    assert result["verified"] is True and result["verification"] == "ordered_prizes"
    assert result["provider"] == "deterministic" and result["provider_calls"] == 0
    assert result["proposal"]["status"] == "proposed"
    assert result["proposal"]["answers"] == [{"field_key": "answer", "value": "12", "unit": ""}]
    assert "4 × 3 = 12" in result["proposal"]["explanation"] and calls == []


def test_model_claim_of_missing_information_without_details_is_not_presented_as_context_failure(client, demo_headers, ollama):
    _, response = ollama
    response["message"]["content"] = json.dumps({"status": "needs_context", "answers": [],
        "explanation": "Cálculo que da una conclusión errónea de 6 maneras.", "missing_information": []})
    result = client.post("/assist", json={"context": CONTEXT}, headers=demo_headers)
    assert result.status_code == 200
    assert result.json()["proposal"]["status"] == "unable_to_solve"
    assert result.json()["proposal"]["answers"] == [] and result.json()["verified"] is False
    assert "6 maneras" not in result.json()["proposal"]["explanation"]


def test_specific_missing_information_is_preserved(client, demo_headers, ollama):
    _, response = ollama
    response["message"]["content"] = json.dumps({"status": "needs_context", "answers": [],
        "explanation": "No se indica la altura.", "missing_information": ["Altura del cilindro"]})
    result = client.post("/assist", json={"context": CONTEXT}, headers=demo_headers)
    assert result.json()["proposal"]["status"] == "needs_context"
    assert result.json()["proposal"]["missing_information"] == ["Altura del cilindro"]


def test_verified_output_cannot_come_from_a_model_proposal():
    with pytest.raises(ValueError):
        AssistResult(fingerprint="a" * 64, proposal=AssistProposal.model_validate(PROPOSAL), model="test", provider_calls=1,
                     verified=True, verification="ordered_prizes")
    with pytest.raises(ValueError):
        AssistProposal.model_validate({**PROPOSAL, "missing_information": ["Falta un dato"]})
