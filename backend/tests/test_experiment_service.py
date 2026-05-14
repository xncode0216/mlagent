from pathlib import Path

from app.services.experiment_service import ExperimentService


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
        model_artifact={"type": "model", "name": "sklearn.joblib", "path": "models/sklearn.joblib"},
        metrics_artifact={
            "id": "metrics-2",
            "type": "training",
            "name": "sklearn_training_metrics.json",
            "path": "results/manual/sklearn_training_metrics.json",
            "created_at": "2026-05-14T00:01:00+00:00",
        },
    )

    assert first["best_model_name"] == "baseline"
    assert second["best_model_name"] == "sklearn"
    assert (tmp_path / "experiments" / "runs" / "run-1.json").exists()
    assert [run["experiment_id"] for run in service.list_runs()] == ["run-2", "run-1"]
    assert service.list_runs()[0]["use_gpu"] is True
