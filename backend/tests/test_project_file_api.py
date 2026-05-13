from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_create_project_and_list_files(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post("/api/projects", json={"name": "sales_churn_analysis"})
    assert response.status_code == 200
    project = response.json()
    assert project["name"] == "sales_churn_analysis"

    files_response = client.get(f"/api/projects/{project['id']}/files")
    assert files_response.status_code == 200
    names = {item["name"] for item in files_response.json()["items"]}
    assert {"data", "notebooks", "results", "models", "agent_schema", "evolution", "logs"} <= names
