import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


class ExperimentService:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.runs_dir = self.project_root / "experiments" / "runs"

    def record_run(
        self,
        *,
        project_id: str,
        experiment_id: str,
        engine: str,
        dataset_path: str,
        target_column: str,
        use_gpu: bool,
        metrics: dict[str, Any],
        model: dict[str, Any],
        candidate_runs: list[dict[str, Any]],
        model_artifact: dict[str, Any],
        metrics_artifact: dict[str, Any],
        evaluation_report_artifact: dict[str, Any] | None = None,
        prediction_samples_artifact: dict[str, Any] | None = None,
        preprocessing_plan_artifact: dict[str, Any] | None = None,
        preprocessing_plan: dict[str, Any] | None = None,
        best_model_name: str | None = None,
    ) -> dict[str, Any]:
        created_at = self._next_created_at()
        record = {
            "experiment_id": experiment_id,
            "project_id": project_id,
            "status": "completed",
            "engine": engine,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "use_gpu": use_gpu,
            "best_model_name": best_model_name or engine,
            "metrics": metrics,
            "model": model,
            "candidate_runs": candidate_runs,
            "model_artifact": model_artifact,
            "metrics_artifact": metrics_artifact,
            "created_at": created_at,
        }
        if evaluation_report_artifact is not None:
            record["evaluation_report_artifact"] = evaluation_report_artifact
        if prediction_samples_artifact is not None:
            record["prediction_samples_artifact"] = prediction_samples_artifact
        if preprocessing_plan_artifact is not None:
            record["preprocessing_plan_artifact"] = preprocessing_plan_artifact
        if preprocessing_plan is not None:
            record["preprocessing_plan"] = preprocessing_plan
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        path = self.runs_dir / f"{experiment_id}.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return record

    def _next_created_at(self) -> str:
        # The list_runs newest-first contract sorts by created_at, so timestamps must
        # stay strictly increasing even when consecutive runs land inside one Windows
        # clock tick (~15ms); otherwise ordering degrades to filesystem glob order.
        now = datetime.now(UTC)
        latest = self._latest_created_at()
        if latest is not None and now <= latest:
            now = latest + timedelta(microseconds=1)
        return now.isoformat()

    def _latest_created_at(self) -> datetime | None:
        if not self.runs_dir.exists():
            return None
        latest: datetime | None = None
        for path in self.runs_dir.glob("*.json"):
            try:
                raw = json.loads(path.read_text(encoding="utf-8")).get("created_at")
                value = datetime.fromisoformat(raw) if isinstance(raw, str) else None
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if value is not None and (latest is None or value > latest):
                latest = value
        return latest

    def list_runs(self) -> list[dict[str, Any]]:
        if not self.runs_dir.exists():
            return []
        records = []
        for path in self.runs_dir.glob("*.json"):
            records.append(json.loads(path.read_text(encoding="utf-8")))
        return sorted(records, key=lambda record: record["created_at"], reverse=True)

    def get_run(self, experiment_id: str) -> dict[str, Any] | None:
        path = self.runs_dir / f"{experiment_id}.json"
        if not path.exists() or not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def update_run(self, experiment_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        record = self.get_run(experiment_id)
        if record is None:
            raise FileNotFoundError(experiment_id)
        record.update(updates)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        path = self.runs_dir / f"{experiment_id}.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return record
