from datetime import UTC, datetime
from pathlib import Path

from app.services.experiment_service import ExperimentService


def _record_minimal_run(service: ExperimentService, experiment_id: str) -> dict:
    return service.record_run(
        project_id="project-1",
        experiment_id=experiment_id,
        engine="baseline",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.5},
        model={"strategy": "majority_class"},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "m.json", "path": "models/m.json"},
        metrics_artifact={
            "id": f"metrics-{experiment_id}",
            "type": "training",
            "name": "training_metrics.json",
            "path": f"results/{experiment_id}/training_metrics.json",
            "created_at": "2026-05-14T00:00:00+00:00",
        },
    )


def test_record_run_keeps_newest_first_order_when_clock_is_frozen(tmp_path: Path, monkeypatch):
    frozen = datetime(2026, 6, 14, 12, 0, 0, tzinfo=UTC)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen if tz is None else frozen.astimezone(tz)

    monkeypatch.setattr("app.services.experiment_service.datetime", FrozenDatetime)
    service = ExperimentService(tmp_path)

    first = _record_minimal_run(service, "run-1")
    second = _record_minimal_run(service, "run-2")

    assert second["created_at"] > first["created_at"]
    assert [run["experiment_id"] for run in service.list_runs()] == ["run-2", "run-1"]


def test_experiment_service_records_and_lists_runs(tmp_path: Path):
    service = ExperimentService(tmp_path)

    first = service.record_run(
        project_id="project-1",
        experiment_id="run-1",
        engine="baseline",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.5, "row_count": 4, "class_count": 2},
        model={"strategy": "majority_class"},
        candidate_runs=[{"model_name": "majority_class", "metrics": {"accuracy": 0.5}}],
        model_artifact={"type": "model", "name": "baseline.json", "path": "models/baseline.json"},
        metrics_artifact={
            "id": "metrics-1",
            "type": "training",
            "name": "training_metrics.json",
            "path": "results/manual/training_metrics.json",
            "created_at": "2026-05-14T00:00:00+00:00",
        },
    )
    second = service.record_run(
        project_id="project-1",
        experiment_id="run-2",
        engine="sklearn",
        dataset_path="data/customer_churn.csv",
        target_column="churn",
        use_gpu=True,
        metrics={"accuracy": 0.875, "f1_weighted": 0.87, "row_count": 8, "class_count": 2},
        model={
            "algorithm": "random_forest",
            "feature_importance": [{"feature": "score", "importance": 0.72}],
        },
        candidate_runs=[{"model_name": "random_forest", "metrics": {"accuracy": 0.875}}],
        model_artifact={"type": "model", "name": "sklearn.pkl", "path": "models/sklearn.pkl"},
        metrics_artifact={
            "id": "metrics-2",
            "type": "training",
            "name": "sklearn_training_metrics.json",
            "path": "results/manual/sklearn_training_metrics.json",
            "created_at": "2026-05-14T00:01:00+00:00",
        },
        evaluation_report_artifact={
            "id": "report-2",
            "type": "report",
            "name": "model_evaluation_report.md",
            "path": "results/manual/model_evaluation_report.md",
            "created_at": "2026-05-14T00:01:01+00:00",
        },
    )

    assert first["best_model_name"] == "baseline"
    assert second["best_model_name"] == "sklearn"
    assert (tmp_path / "experiments" / "runs" / "run-1.json").exists()
    assert [run["experiment_id"] for run in service.list_runs()] == ["run-2", "run-1"]
    assert service.list_runs()[0]["use_gpu"] is True
    assert service.get_run("run-2")["model"]["feature_importance"][0]["feature"] == "score"
    assert service.get_run("run-2")["evaluation_report_artifact"]["path"] == "results/manual/model_evaluation_report.md"
    assert service.get_run("missing") is None
