"""Pure run/dataset/context query helpers extracted from the orchestrator (P1-6 slice 3).

All of these are stateless functions over dicts/paths; the facade methods delegate.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from app.services.agent_orchestrator.support import (
    DATASET_CANDIDATE_SUFFIXES,
    TARGET_COLUMN_FALLBACKS,
    _dataset_version_id_from_path,
    _relative_path,
)


def requests_latest_run(content: str) -> bool:
    normalized = content.lower()
    return any(token in normalized for token in ("latest", "most recent", "newest", "最近", "最新"))


def artifact_path_from_run(run: dict[str, Any], key: str) -> str | None:
    artifact = run.get(key) if isinstance(run.get(key), dict) else {}
    path = artifact.get("path") if isinstance(artifact.get("path"), str) else None
    return path


def match_run_by_active_file(runs: list[dict[str, Any]], active_file: str) -> dict[str, Any] | None:
    if not active_file:
        return None
    matches: list[dict[str, Any]] = []
    for run in runs:
        candidate_paths = [
            run.get("dataset_path") if isinstance(run.get("dataset_path"), str) else None,
            artifact_path_from_run(run, "metrics_artifact"),
            artifact_path_from_run(run, "model_artifact"),
            artifact_path_from_run(run, "evaluation_report_artifact"),
            artifact_path_from_run(run, "prediction_samples_artifact"),
            artifact_path_from_run(run, "preprocessing_plan_artifact"),
            artifact_path_from_run(run, "export_bundle_artifact"),
        ]
        if active_file in [path for path in candidate_paths if path]:
            matches.append(run)
    return matches[0] if len(matches) == 1 else None


def run_candidate_summary(run: dict[str, Any]) -> dict[str, str]:
    return {
        "experiment_id": str(run.get("experiment_id") or ""),
        "dataset_path": str(run.get("dataset_path") or ""),
        "target_column": str(run.get("target_column") or ""),
        "best_model_name": str(run.get("best_model_name") or run.get("engine") or ""),
    }


def target_candidates_for_columns(columns: list[str]) -> list[str]:
    normalized = {column.strip().lower(): column.strip() for column in columns if column.strip()}
    prioritized = [normalized[key] for key in TARGET_COLUMN_FALLBACKS if key in normalized]
    for column in columns:
        column = column.strip()
        if column and column not in prioritized:
            prioritized.append(column)
        if len(prioritized) >= 3:
            break
    return prioritized[:3]


def candidate_dataset_summaries(project_root: Path) -> list[dict[str, str]]:
    candidates: list[dict[str, str]] = []
    ignored_roots = {"sessions", "experiments", ".git", "__pycache__"}
    for dataset_file in sorted(
        (
            path
            for path in project_root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in DATASET_CANDIDATE_SUFFIXES
            and not any(part in ignored_roots for part in path.relative_to(project_root).parts)
        ),
        key=lambda path: _relative_path(project_root, path).lower(),
    ):
        try:
            with dataset_file.open(newline="", encoding="utf-8") as handle:
                reader = csv.reader(handle)
                columns = [column.strip() for column in next(reader, []) if column.strip()]
                row_count = sum(1 for _ in reader)
        except (OSError, UnicodeDecodeError, csv.Error):
            continue
        if not columns:
            continue
        candidates.append(
            {
                "dataset_path": _relative_path(project_root, dataset_file),
                "dataset_version_id": _dataset_version_id_from_path(_relative_path(project_root, dataset_file)),
                "row_count": str(row_count),
                "column_count": str(len(columns)),
                "target_candidates": ", ".join(target_candidates_for_columns(columns)),
            }
        )
        if len(candidates) >= 5:
            break
    return candidates


def diagnosis_summary(run: dict[str, Any]) -> dict[str, Any]:
    metrics = run.get("metrics") if isinstance(run.get("metrics"), dict) else {}
    confusion = metrics.get("confusion_matrix") if isinstance(metrics.get("confusion_matrix"), dict) else {}
    error_slices: list[dict[str, Any]] = []
    for label, predictions in confusion.items():
        if not isinstance(predictions, dict):
            continue
        counts = {str(predicted): int(count) for predicted, count in predictions.items() if isinstance(count, int | float)}
        support = sum(counts.values())
        correct = counts.get(str(label), 0)
        errors = max(0, support - correct)
        primary_confusion = sorted(
            [
                {
                    "label": predicted,
                    "count": count,
                    "rate": count / support if support else 0,
                }
                for predicted, count in counts.items()
                if predicted != str(label) and count > 0
            ],
            key=lambda item: item["count"],
            reverse=True,
        )
        if support > 0:
            error_slices.append(
                {
                    "label": str(label),
                    "support": support,
                    "correct": correct,
                    "errors": errors,
                    "error_rate": errors / support,
                    "primary_confusion": primary_confusion[0] if primary_confusion else None,
                }
            )
    error_slices.sort(key=lambda item: (-item["error_rate"], -item["errors"], item["label"]))
    worst_slice = next((item for item in error_slices if item["errors"] > 0), None)
    main_confusion = (
        f"{worst_slice['label']} -> {worst_slice['primary_confusion']['label']}"
        if worst_slice and worst_slice.get("primary_confusion")
        else None
    )
    total_errors = sum(int(item["errors"]) for item in error_slices)
    return {
        "worst_class": worst_slice["label"] if worst_slice else None,
        "main_confusion": main_confusion,
        "error_count": total_errors,
        "error_slices": error_slices,
        "recommendation": (
            f"Inspect {worst_slice['label']} prediction samples, then review features or preprocessing for this class."
            if worst_slice
            else "No class-level errors were found in the recorded confusion matrix."
        ),
    }


def infer_target_column(csv_path: Path) -> str:
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        columns = next(reader, [])
    normalized = {column.strip().lower(): column for column in columns if column.strip()}
    for candidate in TARGET_COLUMN_FALLBACKS:
        if candidate in normalized:
            return normalized[candidate]
    return columns[-1].strip() if columns else "target"
