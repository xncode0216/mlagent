from pathlib import Path

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
    assert content_response.json()["size"] == len("age,churn\n42,1\n")
    assert content_response.json()["mime_type"] == "text/csv"


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


def test_create_project_file_and_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    folder_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notebooks/experiments", "type": "directory"},
    )
    file_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notebooks/experiments/eda.py", "type": "file", "content": "# EDA\n"},
    )

    assert folder_response.status_code == 200
    assert folder_response.json()["type"] == "directory"
    assert file_response.status_code == 200
    assert file_response.json()["path"] == "notebooks/experiments/eda.py"
    content_response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "notebooks/experiments/eda.py"},
    )
    assert content_response.json()["content"] == "# EDA\n"


def test_create_project_file_rejects_escape_and_existing_target(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    escape_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "../escape.txt", "type": "file"},
    )
    first_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notes.md", "type": "file"},
    )
    duplicate_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notes.md", "type": "file"},
    )

    assert escape_response.status_code == 400
    assert first_response.status_code == 200
    assert duplicate_response.status_code == 409


def test_read_project_file_rejects_binary_preview(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app, raise_server_exceptions=False)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    binary_path = Path(project["workspace_path"]) / "models" / "model.pkl"
    binary_path.write_bytes(b"\x80\x04\x95\x00\x00\x00")

    response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "models/model.pkl"},
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Binary file preview is not supported"
