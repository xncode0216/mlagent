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


def test_upload_and_read_project_file(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    upload_response = client.post(
        f"/api/projects/{project['id']}/files/upload",
        data={"path": "data/customer_churn.csv"},
        files={"file": ("customer_churn.csv", b"age,churn\n42,1\n", "text/csv")},
    )

    assert upload_response.status_code == 200
    assert upload_response.json()["path"] == "data/customer_churn.csv"

    content_response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "data/customer_churn.csv"},
    )

    assert content_response.status_code == 200
    assert content_response.json()["content"] == "age,churn\n42,1\n"


def test_upload_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    upload_response = client.post(
        f"/api/projects/{project['id']}/files/upload",
        data={"path": "../escape.csv"},
        files={"file": ("escape.csv", b"x\n1\n", "text/csv")},
    )

    assert upload_response.status_code == 400
