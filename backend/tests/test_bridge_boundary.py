from app.config import settings
from app.web_bridge import bridge_origin


def test_extension_origin_only_allowed_on_scoped_routes(client):
    origin = bridge_origin()
    for path in ("/web-api/session", "/web-api/bridge-token", "/web-api/login", "/web-api/jobs"):
        assert client.get(path, headers={"Origin": origin}).status_code == 403
    response = client.get("/web-api/bridge/session", headers={"Origin": origin})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == origin


def test_bridge_preflight_accepts_only_extension_origin_and_fixed_methods(client):
    headers = {"Origin": bridge_origin(), "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "authorization,content-type"}
    response = client.options("/web-api/bridge/jobs", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == bridge_origin()
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "access-control-allow-credentials" not in response.headers
    for origin in (settings.web_origin, "https://evil.example", "chrome-extension://other"):
        assert client.options("/web-api/bridge/jobs", headers={**headers, "Origin": origin}).status_code == 403
    assert client.options("/web-api/bridge/jobs", headers={**headers, "Access-Control-Request-Method": "PUT"}).status_code == 403


def test_public_mode_bridge_does_not_open_legacy_routes(client, monkeypatch):
    monkeypatch.setattr(settings, "web_public_mode", True)
    for path in ("/assist", "/solve", "/auth/demo"):
        assert client.post(path, headers={"Origin": bridge_origin(), "Host": "127.0.0.1:8000"}).status_code == 404
