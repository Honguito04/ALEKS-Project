import time
import pytest
from app.config import settings
from app.database import db, digest, new_session
from app.auth import challenge


def test_demo_is_explicit_and_cannot_enable_aleks(client, demo_headers, make_exercise):
    assert client.get("/auth/session", headers=demo_headers).json() == {"mode": "demo"}
    exercise = make_exercise().model_dump()
    assert client.post("/solve", json={"exercise": exercise}, headers=demo_headers).json()["answer"] == "2"
    exercise["source"] = "aleks"
    assert client.post("/solve", json={"exercise": exercise}, headers=demo_headers).status_code == 409
    google = {"Authorization": "Bearer " + new_session("google:test", "google")["token"]}
    assert client.post("/solve", json={"exercise": exercise}, headers=google).status_code == 409


def test_auth_and_input_validation(client, make_exercise):
    assert client.post("/solve", json={"exercise": make_exercise().model_dump()}).status_code == 401
    assert client.post("/auth/google/start", json={"extension_id":"a"*32,"handoff_challenge":"a"*43,"client_state":"b"*43}).status_code == 503
    assert client.get("/health", headers={"Origin":"https://evil.example"}).status_code == 403
    assert client.get("/health", headers={"Host":"evil.example"}).status_code == 403


def test_history_deletion_and_logout(client, demo_headers, make_exercise):
    client.post("/solve", json={"exercise":make_exercise().model_dump()}, headers=demo_headers)
    rows = client.get("/history", headers=demo_headers).json()
    assert len(rows) == 1 and "statement" not in rows[0]
    assert client.delete("/history", headers=demo_headers).status_code == 200
    assert client.get("/history", headers=demo_headers).json() == []
    assert client.post("/auth/logout", headers=demo_headers).status_code == 200
    assert client.get("/auth/session", headers=demo_headers).status_code == 401


def test_grade_idempotency(client):
    body = {"problem_id":"fracciones", "answer":"17/12", "operation_id":"run:1"}
    assert client.post("/api/simulator/grade", json=body).json() == {"accepted":True,"replayed":False}
    assert client.post("/api/simulator/grade", json=body).json() == {"accepted":True,"replayed":True}
    body["answer"] = "1"
    assert client.post("/api/simulator/grade", json=body).status_code == 409


def test_handoff_pkce_expiry_replay_and_unlink(client):
    verifier = "v"*43
    with db() as conn:
        conn.execute("INSERT INTO handoffs VALUES(?,?,?,?,?)", (digest("c"*43), "a"*32, challenge(verifier), "google:test", time.time()+30))
    body={"code":"c"*43,"extension_id":"a"*32,"verifier":"z"*43}
    assert client.post("/auth/google/complete",json=body).status_code == 401
    body["verifier"]=verifier
    response=client.post("/auth/google/complete",json=body)
    assert response.status_code == 200 and response.json()["mode"] == "google"
    assert client.post("/auth/google/complete",json=body).status_code == 401
    headers={"Authorization":"Bearer "+response.json()["token"]}
    assert client.delete("/auth/link",headers=headers).status_code == 200
    assert client.get("/auth/session",headers=headers).status_code == 401
    with db() as conn:
        conn.execute("INSERT INTO handoffs VALUES(?,?,?,?,?)", (digest("e"*43), "a"*32, challenge(verifier), "google:test", time.time()-1))
    body["code"]="e"*43
    assert client.post("/auth/google/complete",json=body).status_code == 401


def test_oauth_state_bound_to_extension(client, monkeypatch):
    monkeypatch.setattr(settings,"chrome_extension_ids","a"*32)
    monkeypatch.setattr(settings,"google_client_id","client-id")
    monkeypatch.setattr(settings,"google_client_secret","test-secret")
    body={"extension_id":"b"*32,"handoff_challenge":"c"*43,"client_state":"d"*43}
    assert client.post("/auth/google/start",json=body).status_code == 403
    body["extension_id"]="a"*32
    result=client.post("/auth/google/start",json=body)
    from urllib.parse import urlsplit,parse_qs
    parsed=urlsplit(result.json()["authorization_url"]); params=parse_qs(parsed.query)
    assert parsed.hostname=="accounts.google.com" and params["scope"]==["openid"]
    assert params["code_challenge_method"]==["S256"]
    assert client.get("/auth/google/callback?state=wrong&code=fake").status_code == 400
    state=params["state"][0]
    assert client.get("/auth/google/callback",params={"state":state,"error":"access_denied"}).status_code == 400
    assert client.get("/auth/google/callback",params={"state":state,"code":"fake"}).status_code == 400


def test_ai_proposal_never_promoted_to_automatic(client, monkeypatch, demo_headers, make_exercise):
    from app.models import AIProposal
    import app.main as main
    class Fake:
        async def interpret(self, exercise):
            return AIProposal(math={"family":"arithmetic","expression":"1+1"}, proposed_answer="2", explanation="Propuesta")
    monkeypatch.setattr(settings,"ai_provider","openai")
    monkeypatch.setattr(settings,"ai_model","configured-test-model")
    monkeypatch.setattr(settings,"openai_api_key","test-not-a-real-key")
    monkeypatch.setattr(main,"interpreter",lambda:Fake())
    body=make_exercise().model_dump();body["math"]=None
    result=client.post("/solve",json={"exercise":body,"allow_ai":True},headers=demo_headers)
    assert result.status_code==200
    assert result.json()["status"]=="unverifiable" and result.json()["proposed_by_ai"]
