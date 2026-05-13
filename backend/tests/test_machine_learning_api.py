from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_train_baseline_api_writes_metrics_and_model(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    dataset_path = project_root / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.8,45,yes\n0.9,50,yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-baseline",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "test-session",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"]["accuracy"] == 1.0
    assert [run["model_name"] for run in payload["runs"]] == [
        "majority_class",
        "numeric_threshold:score",
        "numeric_threshold:age",
    ]
    assert payload["model_artifact"]["path"] == "models/baseline_churn_model.json"
    assert payload["metrics_artifact"]["path"].startswith("results/test-session/")
    assert (project_root / "models" / "baseline_churn_model.json").exists()


def test_train_baseline_api_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-baseline",
        json={"dataset_path": "../escape.csv", "target_column": "churn"},
    )

    assert response.status_code == 400
