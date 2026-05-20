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
