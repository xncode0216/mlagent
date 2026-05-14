import json
from datetime import UTC, datetime
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
        best_model_name: str | None = None,
    ) -> dict[str, Any]:
        created_at = datetime.now(UTC).isoformat()
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
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        path = self.runs_dir / f"{experiment_id}.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        return record

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
