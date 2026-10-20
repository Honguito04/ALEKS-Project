import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from app.config import settings
from app.main import app
from app.models import Exercise


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "test.sqlite3"))
    with TestClient(app) as client:
        yield client


@pytest.fixture
def make_exercise():
    def make(math=None, **kwargs):
        return Exercise.model_validate({
            "source": "simulator", "activity_id": "original-tests", "fingerprint": "a" * 64,
            "statement": "Ejercicio original de prueba", "math": math or {"family": "arithmetic", "expression": "1+1"},
            "fields": [{"id": "answer", "kind": "text"}], "evidence": ["test"], **kwargs
        })
    return make


@pytest.fixture
def demo_headers(client):
    return {"Authorization": "Bearer " + client.post("/auth/demo").json()["token"]}
