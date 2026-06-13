from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_generate_analysis_report_writes_markdown_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,,0\n55,91.0,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/report",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "report-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"]["type"] == "report"
    assert payload["artifact"]["path"] == "results/report-session/analysis_report.md"
    assert payload["artifact"]["metadata"]["dataset_path"] == "data/customer_churn.csv"
    report_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    report = report_path.read_text(encoding="utf-8")
    assert "# 数据分析报告" in report
    assert "data/customer_churn.csv" in report
    assert "行数: 3" in report
    assert "列数: 3" in report
    assert "monthly_charges" in report


def test_generate_analysis_report_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/report",
        json={"dataset_path": "../escape.csv", "session_id": "report-session"},
    )

    assert response.status_code == 400


def test_generate_data_profile_writes_quality_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,,0\n55,91.0,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/profile",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "profile-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"]["type"] == "dataframe"
    assert payload["artifact"]["path"] == "results/profile-session/data_quality_profile.json"
    assert payload["artifact"]["metadata"]["profile_type"] == "data_quality"
    assert payload["profile"]["row_count"] == 3
    assert payload["profile"]["missing_cells"] == 1
    assert payload["profile"]["target_candidates"][0]["column"] == "churn"

    profile_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    profile = profile_path.read_text(encoding="utf-8")
    assert "data_quality" not in profile
    assert "monthly_charges" in profile


def test_generate_preprocessing_plan_writes_plan_and_pipeline_script(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "customer_id,age,contract,churn\n"
        "c1,42,Month-to-month,No\n"
        "c2,,One year,Yes\n"
        "c3,55,,No\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plan"]["target_column"] == "churn"
    assert payload["plan"]["drop_columns"] == ["customer_id"]
    assert payload["plan"]["numeric_features"] == ["age"]
    assert payload["plan"]["categorical_features"] == ["contract"]
    assert payload["plan_artifact"]["path"] == "results/feature-session/preprocessing_plan.json"
    assert payload["pipeline_artifact"]["path"] == "notebooks/feature-session_preprocessing_pipeline.py"

    plan_path = Path(project["workspace_path"]) / payload["plan_artifact"]["path"]
    plan = plan_path.read_text(encoding="utf-8")
    assert "ColumnTransformer" in plan
    assert "customer_id" in plan

    script_path = Path(project["workspace_path"]) / payload["pipeline_artifact"]["path"]
    script = script_path.read_text(encoding="utf-8")
    assert "SimpleImputer(strategy='median')" in script
    assert "OneHotEncoder(handle_unknown='ignore'" in script
    assert "customer_churn_preprocessed.csv" in script


def test_generate_preprocessing_plan_keeps_default_sample_features(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n",
        encoding="utf-8",
    )

    plan_response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )
    plan_path = plan_response.json()["plan_artifact"]["path"]
    execute_response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={"preprocessing_plan_path": plan_path, "session_id": "feature-session"},
    )

    assert plan_response.status_code == 200
    assert plan_response.json()["plan"]["feature_columns"] == ["age", "income"]
    assert execute_response.status_code == 200
    assert execute_response.json()["summary"]["encoded_feature_columns"] == ["age", "income"]


def test_execute_preprocessing_plan_writes_dataset_summary_and_report(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "customer_id,age,contract,churn\n"
        "c1,42,Month-to-month,No\n"
        "c2,,One year,Yes\n"
        "c3,55,,No\n",
        encoding="utf-8",
    )
    plan_response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )
    plan_path = plan_response.json()["plan_artifact"]["path"]

    response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "preprocessing_plan_path": plan_path,
            "session_id": "feature-session",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["target_column"] == "churn"
    assert payload["summary"]["preprocessing_plan_path"] == plan_path
    assert payload["transformed_data_artifact"]["path"] == "results/feature-session/customer_churn_planned.csv"
    assert payload["transformed_data_artifact"]["metadata"]["artifact_role"] == "preprocessed_dataset"
    assert payload["summary_artifact"]["path"] == "results/feature-session/preprocessing_transform_report.json"
    assert payload["report_artifact"]["path"] == "results/feature-session/preprocessing_transform_report.md"

    transformed_path = Path(project["workspace_path"]) / payload["transformed_data_artifact"]["path"]
    transformed = transformed_path.read_text(encoding="utf-8")
    assert "customer_id" not in transformed
    assert "age" in transformed
    assert "contract_Month-to-month" in transformed
    assert "churn" in transformed

    report_path = Path(project["workspace_path"]) / payload["report_artifact"]["path"]
    report = report_path.read_text(encoding="utf-8")
    assert "# Preprocessing Transformation Report" in report
    assert "customer_churn_planned.csv" in report
    assert plan_path in report


def test_execute_preprocessing_plan_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={
            "dataset_path": "../escape.csv",
            "preprocessing_plan_path": "results/plan/preprocessing_plan.json",
            "session_id": "feature-session",
        },
    )

    assert response.status_code == 400


def test_clean_dataset_writes_cleaned_csv_and_script(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "id,age,contract,churn\n1,42,Month-to-month,1\n2,,One year,0\n3,55,,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/clean",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "clean-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cleaned_data_artifact"]["path"] == "results/clean-session/customer_churn_cleaned.csv"
    assert payload["cleaned_data_artifact"]["metadata"]["dataset_path"] == "data/customer_churn.csv"
    assert payload["cleaned_data_artifact"]["metadata"]["fill_values"]["numeric"]["age"] == 48.5
    assert payload["script_artifact"]["path"] == "notebooks/clean-session_cleaning.py"

    cleaned_path = Path(project["workspace_path"]) / payload["cleaned_data_artifact"]["path"]
    cleaned = cleaned_path.read_text(encoding="utf-8")
    assert ",48.5," in cleaned
    assert "Month-to-month" in cleaned
    assert ",0\n" in cleaned

    script_path = Path(project["workspace_path"]) / payload["script_artifact"]["path"]
    script = script_path.read_text(encoding="utf-8")
    assert "fillna" in script
    assert "customer_churn_cleaned.csv" in script


def test_clean_dataset_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/clean",
        json={"dataset_path": "../escape.csv", "session_id": "clean-session"},
    )

    assert response.status_code == 400


def test_handoff_dataset_to_ml_writes_handoff_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn_cleaned.csv"
    dataset_path.write_text(
        "customer_id,monthly_charges,total_charges,churn\n1,29.85,100.0,No\n2,56.95,300.0,Yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/handoff-to-ml",
        json={"dataset_path": "data/customer_churn_cleaned.csv", "session_id": "handoff-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "machine-learning"
    assert payload["dataset_path"] == "data/customer_churn_cleaned.csv"
    assert payload["recommended_target_column"] == "churn"
    assert payload["artifact"]["path"] == "results/handoff-session/ml_handoff.json"

    handoff_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    handoff = handoff_path.read_text(encoding="utf-8")
    assert "customer_churn_cleaned.csv" in handoff
    assert "churn" in handoff


def test_handoff_dataset_to_ml_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/handoff-to-ml",
        json={"dataset_path": "../escape.csv", "session_id": "handoff-session"},
    )

    assert response.status_code == 400
