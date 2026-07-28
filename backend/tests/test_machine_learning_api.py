import json
import zipfile

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.services.experiment_service import ExperimentService
from app.services.gpu_scheduler_service import GPUAcquireCancelled, GPUAcquireTimeout
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
    assert payload["evaluation_report_artifact"]["path"] == "results/test-session/model_evaluation_report.md"
    assert payload["prediction_samples_artifact"]["path"] == "results/test-session/prediction_samples.json"
    assert (project_root / "models" / "baseline_churn_model.json").exists()
    report_content = (project_root / payload["evaluation_report_artifact"]["path"]).read_text(encoding="utf-8")
    assert "# Model Evaluation Report" in report_content
    assert "majority_class" in report_content
    assert "Confusion Matrix" in report_content
    assert "Prediction samples" in report_content
    samples_payload = (project_root / payload["prediction_samples_artifact"]["path"]).read_text(encoding="utf-8")
    assert '"samples"' in samples_payload
    assert '"predicted": "no"' in samples_payload

    runs_response = client.get(f"/api/projects/{project['id']}/ml/runs")
    assert runs_response.status_code == 200
    runs = runs_response.json()["items"]
    assert len(runs) == 1
    assert runs[0]["experiment_id"] == payload["experiment_id"]
    assert runs[0]["engine"] == "baseline"
    assert runs[0]["metrics"]["accuracy"] == 1.0
    assert runs[0]["evaluation_report_artifact"]["path"] == payload["evaluation_report_artifact"]["path"]
    assert runs[0]["prediction_samples_artifact"]["path"] == payload["prediction_samples_artifact"]["path"]


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
                    '"model":{"algorithm":"logistic_regression",'
                    '"linear_coefficients":[{"feature":"score","coefficient":1.21,"abs_coefficient":1.21}],'
                    '"permutation_importance":[{"feature":"score","mean_importance":0.15,"std_importance":0.04}]},'
                    '"metrics":{"accuracy":0.875,"f1_weighted":0.87,"row_count":8,'
                    '"train_row_count":5,"eval_row_count":3,"class_count":2,'
                    '"holdout_strategy":"stratified_holdout",'
                    '"class_distribution":{"no":4,"yes":4},'
                    '"eval_class_distribution":{"no":1,"yes":2},'
                    '"per_class":{"no":{"precision":1.0,"recall":1.0,"f1":1.0,"support":1},'
                    '"yes":{"precision":0.8,"recall":1.0,"f1":0.8889,"support":2}}},'
                    '"prediction_samples":[{"row_index":6,"actual":"yes","predicted":"no",'
                    '"is_error":true,"features":{"score":0.9,"age":50}}],'
                    '"runs":[{"model_name":"logistic_regression","model":{"algorithm":"logistic_regression"},'
                    '"metrics":{"accuracy":0.875,"f1_weighted":0.87,"eval_row_count":3,'
                    '"holdout_strategy":"stratified_holdout"}}],'
                    '"model_path":"models/sklearn_churn_model.pkl"}\n'
                ),
                stderr="",
            )

    def fake_create_kernel_service(**kwargs):
        assert kwargs["backend"] == "jupyter"
        assert kwargs["workspace_root"] == tmp_path / "dev-user" / project["id"]
        assert kwargs["use_gpu"] is False
        return FakeKernelService()

    monkeypatch.setattr("app.api.machine_learning.training.create_kernel_service", fake_create_kernel_service)
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
    assert payload["metrics"]["holdout_strategy"] == "stratified_holdout"
    assert payload["metrics"]["per_class"]["yes"]["f1"] == 0.8889
    assert payload["model_artifact"]["path"] == "models/sklearn_churn_model.pkl"
    assert payload["metrics_artifact"]["path"].startswith("results/sklearn-session/")
    assert payload["evaluation_report_artifact"]["path"] == "results/sklearn-session/model_evaluation_report.md"
    assert payload["prediction_samples_artifact"]["path"] == "results/sklearn-session/prediction_samples.json"
    report_content = (project_root / payload["evaluation_report_artifact"]["path"]).read_text(encoding="utf-8")
    assert "# Model Evaluation Report" in report_content
    assert "Per-Class Quality" in report_content
    assert "Permutation Importance" in report_content
    assert "Linear Coefficients" in report_content
    assert "logistic_regression" in report_content
    assert "Prediction samples" in report_content
    samples_payload = (project_root / payload["prediction_samples_artifact"]["path"]).read_text(encoding="utf-8")
    assert '"row_index": 6' in samples_payload
    assert '"is_error": true' in samples_payload

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
    assert detail["model"]["permutation_importance"][0]["mean_importance"] == 0.15
    assert detail["model"]["linear_coefficients"][0]["feature"] == "score"
    assert detail["candidate_runs"][0]["model_name"] == "logistic_regression"
    assert detail["candidate_runs"][0]["metrics"]["holdout_strategy"] == "stratified_holdout"
    assert detail["metrics"]["eval_class_distribution"] == {"no": 1, "yes": 2}
    assert detail["evaluation_report_artifact"]["path"] == payload["evaluation_report_artifact"]["path"]
    assert detail["prediction_samples_artifact"]["path"] == payload["prediction_samples_artifact"]["path"]

    missing_response = client.get(f"/api/projects/{project['id']}/ml/runs/missing")
    assert missing_response.status_code == 404


def test_train_sklearn_api_records_preprocessing_plan_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    captured_code = ""

    class FakeKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            nonlocal captured_code
            captured_code = code
            return KernelExecutionResult(
                status="ok",
                stdout=(
                    '__MLAGENT_SKLEARN_RESULT__{"engine":"sklearn","task_type":"classification",'
                    '"target_column":"churn","feature_columns":["score","age","contract"],'
                    '"preprocessing_plan_path":"results/plan/preprocessing_plan.json",'
                    '"preprocessing_plan":{"drop_columns":["customer_id"],'
                '"numeric_features":["score","age"],"categorical_features":["contract"]},'
                '"model":{"algorithm":"logistic_regression"},'
                '"metrics":{"accuracy":0.9,"f1_weighted":0.89,"row_count":10},'
                '"prediction_samples":[{"row_index":1,"actual":"no","predicted":"no",'
                '"is_error":false,"features":{"score":0.2,"age":30,"contract":"month"}}],'
                '"runs":[{"model_name":"logistic_regression","metrics":{"accuracy":0.9,"f1_weighted":0.89}}],'
                    '"model_path":"models/sklearn_churn_model.pkl"}\n'
                ),
                stderr="",
            )

    monkeypatch.setattr("app.api.machine_learning.training.create_kernel_service", lambda **kwargs: FakeKernelService())
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "planned_training"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "customer_id,score,age,contract,churn\n"
        "c-1,0.1,25,month,no\n"
        "c-2,0.2,30,month,no\n"
        "c-3,0.8,45,year,yes\n"
        "c-4,0.9,50,year,yes\n",
        encoding="utf-8",
    )
    plan_path = project_root / "results" / "plan" / "preprocessing_plan.json"
    plan_path.parent.mkdir(parents=True)
    plan_path.write_text(
        '{"target_column":"churn","drop_columns":["customer_id"],'
        '"numeric_features":["score","age"],"categorical_features":["contract"]}',
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "planned-session",
            "use_gpu": False,
            "preprocessing_plan_path": "results/plan/preprocessing_plan.json",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["preprocessing_plan_artifact"]["path"] == "results/plan/preprocessing_plan.json"
    assert "results/plan/preprocessing_plan.json" in captured_code
    metrics_payload = (project_root / payload["metrics_artifact"]["path"]).read_text(encoding="utf-8")
    assert "preprocessing_plan_path" in metrics_payload
    report_content = (project_root / payload["evaluation_report_artifact"]["path"]).read_text(encoding="utf-8")
    assert "Preprocessing plan" in report_content
    assert "results/plan/preprocessing_plan.json" in report_content

    detail_response = client.get(f"/api/projects/{project['id']}/ml/runs/{payload['experiment_id']}")
    detail = detail_response.json()
    assert detail["preprocessing_plan_artifact"]["path"] == "results/plan/preprocessing_plan.json"
    assert detail["preprocessing_plan"]["drop_columns"] == ["customer_id"]


def test_kernel_failure_is_recorded_as_a_session_event(tmp_path, monkeypatch):
    """Kernel 报错必须留下 kernel_output 事件。

    该事件类型的消费方一直都在——日志面板按 stderr 分级渲染，经验抽取器据它
    沉淀依赖缺失类经验——但全后端没有任何生产方，于是两者都是死代码：
    kernel 报错既不出现在日志里，也永远无法沉淀成经验。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    class FailingKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            return KernelExecutionResult(
                status="error",
                stdout="",
                stderr="ModuleNotFoundError: No module named 'lightgbm'",
            )

    monkeypatch.setattr(
        "app.api.machine_learning.training.create_kernel_service", lambda **kwargs: FailingKernelService()
    )
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "kernel_error_project"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.2,no\n0.8,yes\n0.9,yes\n",
        encoding="utf-8",
    )
    session = client.post(
        f"/api/projects/{project['id']}/sessions",
        json={"mode": "machine-learning", "title": "训练"},
    ).json()

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": session["id"],
            "use_gpu": False,
        },
    )

    assert response.status_code == 500
    events = client.get(f"/api/sessions/{session['id']}/events").json()["items"]
    kernel_events = [event for event in events if event["type"] == "kernel_output"]
    assert len(kernel_events) == 1
    assert kernel_events[0]["stream"] == "stderr"
    assert "lightgbm" in kernel_events[0]["text"]

    # 事件落地后，依赖缺失这类经验才真正可沉淀
    lessons = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract-from-session",
        json={"session_id": session["id"]},
    ).json()["items"]
    assert [lesson["domain"] for lesson in lessons] == [["runtime", "kernel-error"]]
    assert "lightgbm" in lessons[0]["recommendation"]


def test_a_kernel_error_becomes_a_lesson_that_reaches_the_next_run(tmp_path, monkeypatch):
    """自进化闭环在错误这条线上的完整往返：报错 → 沉淀 → 采纳 → 下次运行被注入。

    三处缺口曾各自切断这条链路：kernel 报错没有生产方（无从沉淀）、规则打分把
    未知维度当成不符（沉淀了也匹配不到）、情境标签只反映模式（错误经验永远对不上）。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    class FailingKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            return KernelExecutionResult(
                status="error",
                stdout="",
                stderr="ModuleNotFoundError: No module named 'lightgbm'",
            )

    monkeypatch.setattr(
        "app.api.machine_learning.training.create_kernel_service", lambda **kwargs: FailingKernelService()
    )
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "kernel_loop_project"}).json()
    root = tmp_path / "dev-user" / project["id"]
    (root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.2,no\n0.8,yes\n0.9,yes\n",
        encoding="utf-8",
    )
    session = client.post(
        f"/api/projects/{project['id']}/sessions",
        json={"mode": "machine-learning", "title": "训练"},
    ).json()

    # 1. 训练撞上依赖缺失
    client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": session["id"],
            "use_gpu": False,
        },
    )

    # 2. 从这次失败沉淀经验并采纳
    lessons = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract-from-session",
        json={"session_id": session["id"]},
    ).json()["items"]
    assert len(lessons) == 1
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lessons[0]['id']}/adopt")

    # 3. 失败仍未解决，因此下一次运行应当带上错误情境并命中该经验
    matched = client.post(
        f"/api/projects/{project['id']}/evolution/rules/match",
        json={
            "session_id": session["id"],
            "context": {"mode": "machine-learning", "tags": ["runtime", "kernel-error"]},
        },
    ).json()["matched_rules"]

    assert [item["lesson_id"] for item in matched] == [lessons[0]["id"]]


def test_train_sklearn_persists_and_resumes_failed_training_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    attempts = 0

    class FakeKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return KernelExecutionResult(status="error", stdout="", stderr="Target column was not found")
            return KernelExecutionResult(
                status="ok",
                stdout=(
                    '__MLAGENT_SKLEARN_RESULT__{"engine":"sklearn","task_type":"classification",'
                    '"target_column":"churn","feature_columns":["score"],'
                    '"model":{"algorithm":"logistic_regression"},'
                    '"metrics":{"accuracy":0.75,"f1_weighted":0.74,"row_count":4},'
                    '"prediction_samples":[{"row_index":1,"actual":"no","predicted":"no",'
                    '"is_error":false,"features":{"score":0.2}}],'
                    '"runs":[{"model_name":"logistic_regression","metrics":{"accuracy":0.75,"f1_weighted":0.74}}],'
                    '"model_path":"models/sklearn_churn_model.pkl"}\n'
                ),
                stderr="",
            )

    monkeypatch.setattr("app.api.machine_learning.training.create_kernel_service", lambda **kwargs: FakeKernelService())
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "retry_training"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.2,no\n0.8,yes\n0.9,yes\n",
        encoding="utf-8",
    )

    failed_response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "manual-training",
            "use_gpu": False,
        },
    )

    assert failed_response.status_code == 500
    assert failed_response.json()["detail"] == "Target column was not found"
    state_path = project_root / "sessions" / "manual-training" / "task_state" / "train.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["status"] == "failed"
    assert state["dataset_path"] == "data/customer_churn.csv"
    assert state["target_column"] == "churn"
    assert state["last_error"] == "Target column was not found"
    assert state["repair_hint"].startswith("Check that the dataset")
    assert state["recovery_policy"]["resume_action"] == "Retry the saved sklearn training request from durable task state."
    assert state["stale_artifact_paths"] == ["data/customer_churn.csv"]

    resumed_response = client.post(
        f"/api/projects/{project['id']}/ml/resume-sklearn",
        json={"session_id": "manual-training"},
    )

    assert resumed_response.status_code == 200
    payload = resumed_response.json()
    assert payload["engine"] == "sklearn"
    assert payload["metrics"]["accuracy"] == 0.75
    assert not state_path.exists()


def test_train_sklearn_persists_execution_os_errors_as_retry_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_KERNEL_BACKEND", "jupyter")
    get_settings.cache_clear()

    class FakeKernelService:
        def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
            raise PermissionError("Kernel process launch denied")

    monkeypatch.setattr("app.api.machine_learning.training.create_kernel_service", lambda **kwargs: FakeKernelService())
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "retry_training_os_error"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.2,no\n0.8,yes\n0.9,yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "manual-training",
            "use_gpu": False,
        },
    )

    assert response.status_code == 500
    assert "Kernel process launch denied" in response.json()["detail"]
    state_path = project_root / "sessions" / "manual-training" / "task_state" / "train.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["status"] == "failed"
    assert state["last_error"] == "Kernel process launch denied"
    assert state["regenerate_action"].startswith("Regenerate the preprocessing plan")


def test_evaluation_report_persists_and_resumes_failed_report_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "retry_evaluation_report"}).json()
    project_root = tmp_path / "dev-user" / project["id"]

    metrics_path = project_root / "results" / "eval-session" / "sklearn_training_metrics.json"
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.write_text('{"accuracy": 0.82}', encoding="utf-8")

    ExperimentService(project_root).record_run(
        project_id=project["id"],
        experiment_id="exp-eval-retry",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.82, "f1_weighted": 0.8, "row_count": 4},
        model={"algorithm": "logistic_regression"},
        candidate_runs=[
            {
                "model_name": "logistic_regression",
                "metrics": {"accuracy": 0.82, "f1_weighted": 0.8, "row_count": 4},
            }
        ],
        model_artifact={"type": "model", "name": "model.pkl", "path": "models/model.pkl"},
        metrics_artifact={
            "id": "metrics-1",
            "type": "training",
            "name": "sklearn_training_metrics.json",
            "path": "results/eval-session/missing_metrics.json",
            "created_at": "2026-06-01T00:00:00+00:00",
        },
        prediction_samples_artifact={
            "id": "samples-1",
            "type": "dataframe",
            "name": "prediction_samples.json",
            "path": "results/eval-session/prediction_samples.json",
            "created_at": "2026-06-01T00:00:00+00:00",
        },
    )

    failed_response = client.post(
        f"/api/projects/{project['id']}/ml/runs/exp-eval-retry/evaluation-report",
        json={"session_id": "eval-session"},
    )

    assert failed_response.status_code == 500
    assert "Metrics artifact not found" in failed_response.json()["detail"]
    state_path = project_root / "sessions" / "eval-session" / "task_state" / "evaluate.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["experiment_id"] == "exp-eval-retry"
    assert state["stage"] == "evaluate"
    assert state["last_error"] == "Metrics artifact not found"
    assert state["recovery_policy"]["stale_check"].startswith("Confirm the metrics")
    assert state["stale_artifact_paths"] == ["results/eval-session/missing_metrics.json", "models/model.pkl"]

    run_path = project_root / "experiments" / "runs" / "exp-eval-retry.json"
    run_text = run_path.read_text(encoding="utf-8")
    run_text = run_text.replace("results/eval-session/missing_metrics.json", "results/eval-session/sklearn_training_metrics.json")
    run_path.write_text(run_text, encoding="utf-8")

    resumed_response = client.post(
        f"/api/projects/{project['id']}/ml/resume-evaluation",
        json={"session_id": "eval-session"},
    )

    assert resumed_response.status_code == 200
    payload = resumed_response.json()
    assert payload["experiment_id"] == "exp-eval-retry"
    assert payload["evaluation_report_artifact"]["path"] == "results/eval-session/model_evaluation_report.md"
    assert (project_root / payload["evaluation_report_artifact"]["path"]).exists()
    assert not state_path.exists()
    detail = client.get(f"/api/projects/{project['id']}/ml/runs/exp-eval-retry").json()
    assert detail["evaluation_report_artifact"]["path"] == "results/eval-session/model_evaluation_report.md"


def test_export_bundle_persists_and_resumes_failed_export_state(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "retry_export_bundle"}).json()
    project_root = tmp_path / "dev-user" / project["id"]

    model_path = project_root / "models" / "model.pkl"
    metrics_path = project_root / "results" / "export-session" / "sklearn_training_metrics.json"
    report_path = project_root / "results" / "export-session" / "model_evaluation_report.md"
    model_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_bytes(b"model")
    metrics_path.write_text('{"accuracy": 0.82}', encoding="utf-8")
    report_path.write_text("# Model Evaluation Report", encoding="utf-8")

    ExperimentService(project_root).record_run(
        project_id=project["id"],
        experiment_id="exp-export-retry",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.82, "f1_weighted": 0.8, "row_count": 4},
        model={"algorithm": "logistic_regression"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "model.pkl", "path": "models/model.pkl"},
        metrics_artifact={
            "id": "metrics-1",
            "type": "training",
            "name": "sklearn_training_metrics.json",
            "path": "results/export-session/sklearn_training_metrics.json",
            "created_at": "2026-06-01T00:00:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-1",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/export-session/missing_report.md",
            "created_at": "2026-06-01T00:00:00+00:00",
        },
    )

    failed_response = client.post(
        f"/api/projects/{project['id']}/ml/runs/exp-export-retry/export-bundle",
        json={"session_id": "export-session"},
    )

    assert failed_response.status_code == 500
    assert "Evaluation Report Artifact not found" in failed_response.json()["detail"]
    state_path = project_root / "sessions" / "export-session" / "task_state" / "export.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["experiment_id"] == "exp-export-retry"
    assert state["report_path"] == "results/export-session/missing_report.md"
    assert state["repair_hint"].startswith("Restore model")
    assert state["stale_artifact_paths"] == [
        "results/export-session/sklearn_training_metrics.json",
        "models/model.pkl",
        "results/export-session/missing_report.md",
    ]

    run_path = project_root / "experiments" / "runs" / "exp-export-retry.json"
    run_path.write_text(
        run_path.read_text(encoding="utf-8").replace(
            "results/export-session/missing_report.md",
            "results/export-session/model_evaluation_report.md",
        ),
        encoding="utf-8",
    )

    resumed_response = client.post(
        f"/api/projects/{project['id']}/ml/resume-export",
        json={"session_id": "export-session"},
    )

    assert resumed_response.status_code == 200
    payload = resumed_response.json()
    bundle_path = project_root / payload["export_bundle_artifact"]["path"]
    assert payload["export_bundle_artifact"]["type"] == "archive"
    assert bundle_path.exists()
    assert not state_path.exists()
    with zipfile.ZipFile(bundle_path) as archive:
        assert "manifest.json" in archive.namelist()
        assert "artifacts/model/model.pkl" in archive.namelist()
        assert "artifacts/evaluation_report/model_evaluation_report.md" in archive.namelist()


def test_train_sklearn_gpu_timeout_returns_503(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "gpu_timeout"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.9,yes\n",
        encoding="utf-8",
    )

    async def fake_acquire_gpu(
        task_id: str,
        project_id: str,
        timeout_seconds: float | None = None,
    ):
        raise GPUAcquireTimeout("Timed out waiting for GPU")

    monkeypatch.setattr("app.api.machine_learning.gpu_scheduler.acquire_gpu", fake_acquire_gpu)

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "gpu-timeout",
            "use_gpu": True,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Timed out waiting for GPU"


def test_train_sklearn_gpu_cancel_returns_409(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "gpu_cancel"}).json()
    project_root = tmp_path / "dev-user" / project["id"]
    (project_root / "data" / "customer_churn.csv").write_text(
        "score,churn\n0.1,no\n0.9,yes\n",
        encoding="utf-8",
    )

    async def fake_acquire_gpu(
        task_id: str,
        project_id: str,
        timeout_seconds: float | None = None,
    ):
        raise GPUAcquireCancelled("GPU request was canceled")

    monkeypatch.setattr("app.api.machine_learning.gpu_scheduler.acquire_gpu", fake_acquire_gpu)

    response = client.post(
        f"/api/projects/{project['id']}/ml/train-sklearn",
        json={
            "dataset_path": "data/customer_churn.csv",
            "target_column": "churn",
            "session_id": "gpu-cancel",
            "use_gpu": True,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "GPU request was canceled"
