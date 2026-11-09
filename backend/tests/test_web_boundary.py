"""La exposición pública no puede abrir rutas locales ni filtrar entradas."""
import pytest

from app.config import settings


@pytest.mark.parametrize("path", ["/auth/demo", "/auth/google/start", "/assist", "/assist/jobs", "/solve", "/simulator/", "/grade", "/docs", "/openapi.json"])
@pytest.mark.parametrize("host", ["127.0.0.1:8000", "demo.onrender.com"])
def test_public_mode_blocks_legacy_independently_of_host(client, monkeypatch, path, host):
    monkeypatch.setattr(settings, "web_public_mode", True)
    assert client.post(path, headers={"Host": host}).status_code == 404
    assert client.get(path, headers={"Host": host}).status_code == 404


def test_web_validation_never_echoes_password_or_image(client):
    csrf = client.get("/web-api/session").json()["csrf_token"]
    headers = {"Origin": settings.web_origin, "X-CSRF-Token": csrf}
    secret = "private-value-never-return-this"
    response = client.post("/web-api/register", headers=headers, json={"email": "bad", "password": secret, "extra": secret})
    assert response.status_code == 422
    assert secret not in response.text
    assert "input" not in response.text


def test_web_body_limit_without_content_length(client):
    def chunks():
        for _ in range(5):
            yield b"x" * 4000
    response = client.post("/web-api/register", content=chunks())
    assert response.status_code == 413


def test_web_rejects_foreign_origin_even_on_get(client):
    assert client.get("/web-api/session", headers={"Origin": "https://evil.example"}).status_code == 403


def test_expired_cookie_is_a_session_error_not_a_csrf_error(client):
    csrf = client.get("/web-api/session").json()["csrf_token"]
    client.cookies.clear()
    headers = {"Origin": settings.web_origin, "X-CSRF-Token": csrf}
    for path, method in (("/web-api/jobs", "post"), ("/web-api/logout", "post"), ("/web-api/account", "delete")):
        response = client.request(method, path, headers=headers, json={})
        assert response.status_code == 401


def test_health_and_session_reachable_in_public_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "web_public_mode", True)
    assert client.get("/health", headers={"Host": "demo.onrender.com"}).status_code == 200
    assert client.get("/web-api/session", headers={"Host": "127.0.0.1:8000"}).status_code == 200


def test_public_redirect_is_relative_behind_https_proxy(client, monkeypatch):
    monkeypatch.setattr(settings, "web_public_mode", True)
    monkeypatch.setattr(settings, "web_public_url", "https://demo.onrender.com/")
    for path in ("/", "/app"):
        response = client.get(path, headers={"Host": "demo.onrender.com", "Origin": "https://demo.onrender.com"}, follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/app/"
