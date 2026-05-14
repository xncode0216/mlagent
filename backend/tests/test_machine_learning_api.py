from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.services.kernel_service import KernelExecutionResult


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

    runs_response = client.get(f"/api/projects/{project['id']}/ml/runs")
    assert runs_response.status_code == 200
    runs = runs_response.json()["items"]
    assert len(runs) == 1
    assert runs[0]["experiment_id"] == payload["experiment_id"]
    assert runs[0]["engine"] == "baseline"
    assert runs[0]["metrics"]["accuracy"] == 1.0


def test_train_baseline_api_accepts_numeric_target_values(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "numeric_churn"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    dataset_path = project_root / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-baseline",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "numeric-session",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["model"]["prediction"] == 0
    assert payload["metrics"]["accuracy"] == 0.6667


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


def test_train_sklearn_api_writes_metrics_and_model_reference(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    class FakeKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            return KernelExecutionResult(
                status="ok",
                stdout=(
                    '__MLAGENT_SKLEARN_RESULT__{"engine":"sklearn","task_type":"classification",'
                    '"target_column":"churn","feature_columns":["score","age"],'
                    '"model":{"algorithm":"logistic_regression"},'
                    '"metrics":{"accuracy":0.875,"f1_weighted":0.87,"row_count":8,"class_count":2},'
                    '"runs":[{"model_name":"logistic_regression","model":{"algorithm":"logistic_regression"},'
                    '"metrics":{"accuracy":0.875}}],'
                    '"model_path":"models/sklearn_churn_model.pkl"}\n'
                ),
                stderr="",
            )

    def fake_create_kernel_service(**kwargs):
        assert kwargs["backend"] == "jupyter"
        assert kwargs["workspace_root"] == tmp_path / "dev-user" / project["id"]
        assert kwargs["use_gpu"] is False
        return FakeKernelService()

    monkeypatch.setattr("app.api.machine_learning.create_kernel_service", fake_create_kernel_service)
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    dataset_path = project_root / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.3,31,no\n0.4,35,no\n"
        "0.7,44,yes\n0.8,45,yes\n0.9,50,yes\n1.0,55,yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "sklearn-session",
            "use_gpu": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "sklearn"
    assert payload["metrics"]["accuracy"] == 0.875
    assert payload["model_artifact"]["path"] == "models/sklearn_churn_model.pkl"
    assert payload["metrics_artifact"]["path"].startswith("results/sklearn-session/")

    runs_response = client.get(f"/api/projects/{project['id']}/ml/runs")
    assert runs_response.status_code == 200
    runs = runs_response.json()["items"]
    assert runs[0]["experiment_id"] == payload["experiment_id"]
    assert runs[0]["engine"] == "sklearn"
    assert runs[0]["use_gpu"] is False

    detail_response = client.get(f"/api/projects/{project['id']}/ml/runs/{payload['experiment_id']}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["model"]["algorithm"] == "logistic_regression"
    assert detail["candidate_runs"][0]["model_name"] == "logistic_regression"

    missing_response = client.get(f"/api/projects/{project['id']}/ml/runs/missing")
    assert missing_response.status_code == 404
