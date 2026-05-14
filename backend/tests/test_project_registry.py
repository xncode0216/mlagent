import json

from fastapi.testclient import TestClient

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app


def test_project_registry_persists_created_projects(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)

    project = client.post("/api/projects", json={"name": "titanic_validation"}).json()

    registry_path = tmp_path / "dev-user" / "projects.json"
    assert registry_path.exists()
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    assert registry["projects"][0]["id"] == project["id"]
    assert registry["projects"][0]["name"] == "titanic_validation"


def test_project_registry_recovers_after_memory_clear(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "restart_safe"}).json()

    PROJECTS.clear()

    list_response = client.get("/api/projects")
    detail_response = client.get(f"/api/projects/{project['id']}")

    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [project["id"]]
    assert detail_response.status_code == 200
    assert detail_response.json()["workspace_path"] == project["workspace_path"]


def test_project_registry_allows_file_api_after_memory_clear(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    PROJECTS.clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "files_after_restart"}).json()

    PROJECTS.clear()

    files_response = client.get(f"/api/projects/{project['id']}/files")

    assert files_response.status_code == 200
    names = {item["name"] for item in files_response.json()["items"]}
    assert "data" in names
