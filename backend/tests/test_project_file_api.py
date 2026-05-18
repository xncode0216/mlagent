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


def test_rename_project_file_preserves_content(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    create_response = client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notebooks/draft.py", "type": "file", "content": "print('ok')\n"},
    )
    rename_response = client.patch(
        f"/api/projects/{project['id']}/files/rename",
        json={"path": "notebooks/draft.py", "new_path": "notebooks/final.py"},
    )
    old_response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "notebooks/draft.py"},
    )
    new_response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "notebooks/final.py"},
    )

    assert create_response.status_code == 200
    assert rename_response.status_code == 200
    assert rename_response.json()["path"] == "notebooks/final.py"
    assert old_response.status_code == 404
    assert new_response.json()["content"] == "print('ok')\n"


def test_rename_project_file_rejects_escape_and_existing_target(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "notes.md", "type": "file"},
    )
    client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "existing.md", "type": "file"},
    )
    escape_response = client.patch(
        f"/api/projects/{project['id']}/files/rename",
        json={"path": "notes.md", "new_path": "../escape.md"},
    )
    duplicate_response = client.patch(
        f"/api/projects/{project['id']}/files/rename",
        json={"path": "notes.md", "new_path": "existing.md"},
    )

    assert escape_response.status_code == 400
    assert duplicate_response.status_code == 409


def test_delete_project_file_and_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "results/temp/notes.md", "type": "file", "content": "remove me"},
    )
    delete_response = client.delete(
        f"/api/projects/{project['id']}/files",
        params={"path": "results/temp"},
    )
    list_response = client.get(
        f"/api/projects/{project['id']}/files",
        params={"path": "results"},
    )

    assert delete_response.status_code == 200
    assert delete_response.json() == {"path": "results/temp", "deleted": True}
    assert "temp" not in {item["name"] for item in list_response.json()["items"]}


def test_delete_project_file_rejects_root_and_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    root_response = client.delete(
        f"/api/projects/{project['id']}/files",
        params={"path": ""},
    )
    escape_response = client.delete(
        f"/api/projects/{project['id']}/files",
        params={"path": "../escape"},
    )

    assert root_response.status_code == 400
    assert escape_response.status_code == 400


def test_update_project_file_content_preserves_exact_text(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    client.post(
        f"/api/projects/{project['id']}/files/create",
        json={"path": "agent_schema/data_agent.yaml", "type": "file", "content": "name: old\n"},
    )
    update_response = client.put(
        f"/api/projects/{project['id']}/files/content",
        json={"path": "agent_schema/data_agent.yaml", "content": "name: new\nskills:\n  - profile_dataset\n"},
    )
    read_response = client.get(
        f"/api/projects/{project['id']}/files/content",
        params={"path": "agent_schema/data_agent.yaml"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["path"] == "agent_schema/data_agent.yaml"
    assert update_response.json()["size"] == len("name: new\nskills:\n  - profile_dataset\n")
    assert read_response.json()["content"] == "name: new\nskills:\n  - profile_dataset\n"


def test_update_project_file_content_rejects_directory_and_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    directory_response = client.put(
        f"/api/projects/{project['id']}/files/content",
        json={"path": "data", "content": "bad"},
    )
    escape_response = client.put(
        f"/api/projects/{project['id']}/files/content",
        json={"path": "../escape.txt", "content": "bad"},
    )

    assert directory_response.status_code == 400
    assert escape_response.status_code == 400
