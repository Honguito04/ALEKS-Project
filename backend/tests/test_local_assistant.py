import json
import asyncio
import httpx
import pytest
from app.config import settings
from app.local_assistant import AssistProposal
from app.local_assistant import AssistResult, VisualDraft, LocalOutputError, decode_local_output


CONTEXT = {"fingerprint": "a" * 64, "statement": "Hay 4 nadadores y premios para primer y segundo lugar. ¿Cuántas maneras hay?",
           "fields": [{"key": "answer", "label": "Respuesta"}], "diagram_required": False, "can_fill_integer": True}
PROPOSAL = {"status": "proposed", "answers": [{"field_key": "answer", "value": "12", "unit": ""}],
            "explanation": "4 posibilidades para primero y 3 para segundo: 4 × 3 = 12.", "missing_information": []}
SWIMMERS = "Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?"
BOXES = ("En una caja hay 1 lápiz y 4 bolígrafos. En una segunda caja hay 9 marcadores y 3 crayones. "
         "Se elige al azar un artículo de cada una de las cajas. ¿Cuál es la probabilidad de que de la primera caja "
         "se elija un bolígrafo y que de la segunda caja se seleccione un crayón? "
         "Escribir la respuesta como una fracción en forma reducida.")
SOLID = {"status": "proposed", "answers": [{"field_key": "answer", "value": "1496", "unit": "cm^3"}],
         "explanation": "Prisma rectangular completo menos un hueco rectangular que atraviesa la profundidad.",
         "missing_information": [], "observations": ["Ancho total: 13 cm", "Altura total: 15 cm", "Profundidad: 8 cm",
             "Dos alturas parciales de 7 cm", "Ancho del hueco: 8 cm"],
         "calculations": [{"field_key": "answer", "expression": "13*15*8 - 8*(15-7-7)*8", "decimal_places": None}]}
VISUAL_CONTEXT = {**CONTEXT, "statement": "Halle el volumen del sólido de abajo.", "diagram_required": True, "can_fill_integer": False}
IMAGE = "data:image/jpeg;base64,/9j//9k="  # Solo prueba de transporte; no una imagen interpretable.


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
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": response_body.get("models", [{"name": settings.ai_model}])})
        properties = json.loads(request.content)["format"]["properties"]
        if "observations" in properties:
            if "visual_payload" in response_body:
                return httpx.Response(200, json=response_body["visual_payload"])
            return httpx.Response(200, json={"message": {"content": json.dumps(response_body.get("visual_draft", SOLID))}})
        if "issues" in properties:
            return httpx.Response(200, json={"message": {"content": json.dumps(response_body.get("visual_review", {"status": "consistent", "issues": [], "missing_information": []}))}})
        return httpx.Response(200, json=response_body)
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
    assert sent["think"] is False and sent["options"]["num_ctx"] == settings.ai_context_tokens
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
    image = IMAGE
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": image}, headers=demo_headers)
    assert result.status_code == 200
    sent = json.loads(calls[-1].content)
    assert sent["messages"][1]["images"] == [image.split(",")[1]]
    assert "data:image" not in sent["messages"][1]["content"]
    assert result.json()["verified"] is False and result.json()["provider_calls"] == 2
    chats = [json.loads(call.content) for call in calls if call.url.path == "/api/chat"]
    assert len(chats) == 2 and all(chat["messages"][1]["images"] == [image.split(",")[1]] for chat in chats)
    assert result.json()["proposal"]["answers"] == SOLID["answers"]
    assert "13*15*8 - 8*(15-7-7)*8 = 1496" in result.json()["proposal"]["explanation"]
    assert "no verifica independientemente" in result.json()["proposal"]["explanation"]
    assert all(chat["think"] is False and chat["options"]["num_ctx"] == settings.ai_context_tokens for chat in chats)
    assert 'Plantilla de salida' in chats[0]["messages"][0]["content"]


def test_visual_json_fence_numeric_value_and_missing_unused_prose_are_accepted_without_changing_the_math(client, demo_headers, ollama):
    _, response = ollama
    draft = json.loads(json.dumps(SOLID))
    del draft["explanation"]
    draft["answers"][0]["value"] = 1496
    response["visual_payload"] = {"done": True, "done_reason": "stop", "message": {"content": "```json\n" + json.dumps(draft) + "\n```"}}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    assert result["proposal"]["answers"] == SOLID["answers"] and result["verified"] is False
    assert result["provider_calls"] == 2


@pytest.mark.parametrize("payload,reason", [
    ({"message": {"content": "", "thinking": "PRIVATE_REASONING"}}, "razonamiento sin una respuesta final"),
    ({"message": {"content": " "}}, "respuesta final vacía"),
    ({"message": {"content": "PRIVATE_INVALID_JSON"}}, "JSON inválido o incompleto"),
    ({"message": {"content": "{"}, "done_reason": "length"}, "agotó el límite de salida"),
    ({"message": {"content": json.dumps(SOLID)}, "done": False}, "todavía estaba incompleta"),
    ({"message": {"content": "x" * 20001}}, "supera el tamaño"),
    ({"message": []}, "estructura de respuesta inesperada"),
    ({"message": {"content": json.dumps({**SOLID, "observations": [{"value": "PRIVATE_INPUT"}]})}}, "observations"),
    ({"message": {"content": json.dumps({**SOLID, "answers": [{"field_key": "answer", "unit": "cm^3"}]})}}, "Faltan campos obligatorios: value"),
    ({"message": {"content": json.dumps({**SOLID, "PRIVATE_PROPERTY_NAME": "PRIVATE_INPUT"})}}, "propiedades no admitidas"),
])
def test_visual_format_diagnostics_identify_the_cause_without_leaking_model_content(client, demo_headers, ollama, payload, reason):
    calls, response = ollama
    response["visual_payload"] = payload
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers)
    assert result.status_code == 200
    assert result.json()["proposal"]["status"] == "unable_to_solve" and result.json()["proposal"]["answers"] == []
    assert reason in result.json()["proposal"]["explanation"] and "PRIVATE_" not in result.text
    assert sum(call.url.path == "/api/chat" for call in calls) == 1


@pytest.mark.parametrize("raw,expected", [
    ('1496', '1496'),
    ('0.12345678901234567890123456789', '0.12345678901234567890123456789'),
    ('-1.50', '-1.50'),
    ('1e3', '1000'),
])
def test_json_number_conversion_preserves_exact_value_and_decimal_digits(raw, expected):
    content = json.dumps(SOLID).replace('"1496"', raw)
    draft = decode_local_output({"message": {"content": content}}, VisualDraft)
    assert draft.answers[0].value == expected


@pytest.mark.parametrize("raw", ['true', '1e10000', 'NaN', 'Infinity'])
def test_number_conversion_does_not_accept_booleans_or_unbounded_or_nonstandard_numbers(raw):
    content = json.dumps(SOLID).replace('"1496"', raw)
    with pytest.raises(LocalOutputError): decode_local_output({"message": {"content": content}}, VisualDraft)


@pytest.mark.parametrize("content", [
    'Texto no estructurado\n```json\n' + json.dumps(SOLID) + '\n```',
    '```json\n' + json.dumps(SOLID) + '\n```\nPRIVATE_SUFFIX',
    json.dumps(SOLID) + json.dumps(SOLID),
])
def test_fence_normalization_never_extracts_a_candidate_from_arbitrary_prose_or_multiple_objects(content):
    with pytest.raises(LocalOutputError): decode_local_output({"message": {"content": content}}, VisualDraft)


def test_custom_context_budget_is_sent_to_ollama(client, demo_headers, ollama, monkeypatch):
    calls, _ = ollama
    monkeypatch.setattr(settings, "ai_context_tokens", 4096)
    assert client.post("/assist", json={"context": CONTEXT}, headers=demo_headers).status_code == 200
    assert json.loads(calls[-1].content)["options"]["num_ctx"] == 4096


def test_reported_180_answer_with_728_calculation_is_discarded_before_visual_review(client, demo_headers, ollama):
    calls, response = ollama
    response["visual_draft"] = {**SOLID, "answers": [{"field_key": "answer", "value": "180", "unit": "cm^3"}],
        "explanation": "El volumen del sólido de abajo es 728 cm³.",
        "calculations": [{"field_key": "answer", "expression": "8*7*13", "decimal_places": None}]}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    assert result["proposal"]["status"] == "unable_to_solve" and result["proposal"]["answers"] == []
    assert "no coincide" in result["proposal"]["explanation"]
    assert "180" not in str(result) and "728" not in str(result)
    assert result["provider_calls"] == 1 and sum(call.url.path == "/api/chat" for call in calls) == 1


def test_consistent_arithmetic_is_not_enough_when_visual_review_rejects_the_geometry(client, demo_headers, ollama):
    _, response = ollama
    response["visual_draft"] = {**SOLID, "answers": [{"field_key": "answer", "value": "728", "unit": "cm^3"}],
        "calculations": [{"field_key": "answer", "expression": "8*7*13", "decimal_places": None}]}
    response["visual_review"] = {"status": "inconsistent", "issues": ["Se consideró solo una parte; falta descontar el hueco del prisma completo."], "missing_information": []}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    assert result["provider_calls"] == 2 and result["verified"] is False
    assert result["proposal"]["status"] == "unable_to_solve" and result["proposal"]["answers"] == []
    assert "falta descontar" in result["proposal"]["explanation"]


@pytest.mark.parametrize("change", ["old-format", "missing-measures", "missing-formula", "extra-formula", "code", "false-verification"])
def test_visual_proposals_need_measures_and_one_safe_formula_per_field(client, demo_headers, ollama, change):
    calls, response = ollama
    draft = json.loads(json.dumps(SOLID))
    if change == "old-format": draft = dict(PROPOSAL)
    if change == "missing-measures": draft["observations"] = []
    if change == "missing-formula": draft["calculations"] = []
    if change == "extra-formula": draft["calculations"] *= 2
    if change == "code": draft["calculations"][0]["expression"] = "__import__('os').system('PRIVATE_UNTRUSTED_OUTPUT')"
    if change == "false-verification": draft["verified"] = True
    response["visual_draft"] = draft
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers)
    assert result.status_code == 200 and result.json()["proposal"]["answers"] == []
    assert result.json()["proposal"]["status"] == "unable_to_solve"
    assert "PRIVATE_UNTRUSTED_OUTPUT" not in result.text
    assert sum(call.url.path == "/api/chat" for call in calls) == 1


@pytest.mark.parametrize("review", [
    {"status": "consistent", "issues": ["No coincide la medida"], "missing_information": []},
    {"status": "inconsistent", "issues": [], "missing_information": []},
    {"status": "needs_context", "issues": [], "missing_information": []},
    {"status": "consistent", "issues": [], "missing_information": [], "code": "PRIVATE_UNTRUSTED_OUTPUT"},
])
def test_invalid_second_review_does_not_release_a_numerical_answer(client, demo_headers, ollama, review):
    _, response = ollama
    response["visual_review"] = review
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers)
    assert result.status_code == 200 and result.json()["proposal"]["status"] == "unable_to_solve"
    assert result.json()["proposal"]["answers"] == [] and result.json()["provider_calls"] == 2
    assert "PRIVATE_UNTRUSTED_OUTPUT" not in result.text


def test_unreadable_dimension_in_review_requests_specific_information_without_answer(client, demo_headers, ollama):
    _, response = ollama
    response["visual_review"] = {"status": "needs_context", "issues": [], "missing_information": ["Profundidad legible del sólido"]}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    assert result["proposal"]["status"] == "needs_context" and result["proposal"]["answers"] == []
    assert result["proposal"]["missing_information"] == ["Profundidad legible del sólido"]


def test_unchecked_free_text_is_replaced_by_the_checked_formula_explanation(client, demo_headers, ollama):
    _, response = ollama
    response["visual_draft"] = {**SOLID, "explanation": "Conclusión libre inconsistente de 180 cm³."}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    # La revisión está simulada como favorable. Aun así la prosa libre nunca se publica.
    assert "180" not in result["proposal"]["explanation"]
    assert result["proposal"]["answers"][0]["value"] == "1496"
    assert "= 1496" in result["proposal"]["explanation"]


def test_no_visual_answer_when_draft_identifies_a_missing_measure(client, demo_headers, ollama):
    calls, response = ollama
    response["visual_draft"] = {"status": "needs_context", "answers": [], "calculations": [], "observations": [],
        "explanation": "No se lee la profundidad.", "missing_information": ["Profundidad del prisma"]}
    result = client.post("/assist", json={"context": VISUAL_CONTEXT, "image": IMAGE}, headers=demo_headers).json()
    assert result["proposal"]["status"] == "needs_context" and result["proposal"]["answers"] == []
    assert sum(call.url.path == "/api/chat" for call in calls) == 1


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


@pytest.mark.parametrize("route", ["/assist", "/assist/jobs"])
def test_box_regression_returns_fraction_without_asking_the_model(client, demo_headers, ollama, route):
    calls, response = ollama
    response["message"]["content"] = json.dumps({"status": "unable_to_solve", "answers": [],
        "explanation": "No hay una respuesta estructurada.", "missing_information": []})
    # La incapacidad de escribir enteros no significa falta de datos matemáticos.
    context = {**CONTEXT, "statement": BOXES, "can_fill_integer": False}
    result = client.post(route, json={"context": context}, headers=demo_headers)
    if route.endswith("jobs"):
        path = route + "/" + result.json()["id"]
        for _ in range(20):
            result = client.get(path, headers=demo_headers)
            if result.json()["status"] != "pending": break
        body = result.json()["result"]
    else:
        assert result.status_code == 200
        body = result.json()
    assert body["provider"] == "deterministic" and body["provider_calls"] == 0
    assert body["verified"] is True and body["verification"] == "independent_boxes"
    assert body["proposal"]["answers"] == [{"field_key": "answer", "value": "1/5", "unit": ""}]
    assert "(4/5) × (3/12) = 1/5" in body["proposal"]["explanation"]
    assert calls == []


def test_box_checker_does_not_override_a_required_diagram(client, demo_headers, ollama):
    calls, response = ollama
    response["visual_draft"] = {"status": "needs_context", "answers": [], "explanation": "Diagrama sin datos suficientes.",
        "missing_information": ["Contenido del dibujo"], "observations": [], "calculations": []}
    context = {**CONTEXT, "statement": BOXES, "diagram_required": True}
    without = client.post("/assist", json={"context": context}, headers=demo_headers).json()
    assert without["verified"] is False and without["proposal"]["status"] == "needs_context"
    assert not calls
    with_image = client.post("/assist", json={"context": context, "image": IMAGE}, headers=demo_headers).json()
    assert with_image["verified"] is False and with_image["verification"] == "none"
    assert with_image["proposal"]["status"] == "needs_context" and with_image["provider_calls"] == 1


def test_boxes_with_extra_conditions_fall_back_to_the_model_as_unverified(client, demo_headers, ollama):
    calls, response = ollama
    proposed = {**PROPOSAL, "answers": [{"field_key": "answer", "value": "2/7", "unit": ""}]}
    response["message"]["content"] = json.dumps(proposed)
    result = client.post("/assist", json={"context": {**CONTEXT, "statement": BOXES + " Se cambia el contenido de las cajas."}}, headers=demo_headers).json()
    assert result["verified"] is False and result["provider_calls"] == 1
    assert result["proposal"]["answers"] == proposed["answers"]
    instructions = json.loads(calls[-1].content)["messages"][0]["content"]
    assert "cadena a/b" in instructions and "estado del editor no es un dato matemático faltante" in instructions


def test_model_cannot_claim_independent_box_verification():
    with pytest.raises(ValueError):
        AssistResult(fingerprint="a" * 64, proposal=AssistProposal.model_validate(PROPOSAL), model="test", provider_calls=1,
                     verified=True, verification="independent_boxes")
