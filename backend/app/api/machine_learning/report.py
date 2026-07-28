"""评估报告的 Markdown 渲染与产物写入。"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.api.machine_learning.support import _relative_project_path


def _markdown_cell(value: Any) -> str:
    if value is None:
        return "-"
    return str(value).replace("\n", " ").replace("|", "\\|")


def _markdown_table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    if not rows:
        return []
    return [
        "| " + " | ".join(_markdown_cell(header) for header in headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(_markdown_cell(value) for value in row) + " |" for row in rows],
    ]


def _format_percent(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "-"
    return f"{value * 100:.2f}%"


def _format_count(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return "-"
    return str(int(value))


def _render_metric_summary(metrics: dict[str, Any]) -> list[list[str]]:
    return [
        ["Accuracy", _format_percent(metrics.get("accuracy"))],
        ["F1 weighted", _format_percent(metrics.get("f1_weighted"))],
        ["Rows", _format_count(metrics.get("row_count"))],
        ["Train rows", _format_count(metrics.get("train_row_count"))],
        ["Eval rows", _format_count(metrics.get("eval_row_count", metrics.get("row_count")))],
        ["Class count", _format_count(metrics.get("class_count"))],
        ["Holdout strategy", str(metrics.get("holdout_strategy") or "not recorded")],
    ]


def _render_confusion_rows(metrics: dict[str, Any]) -> tuple[list[str], list[list[Any]]]:
    confusion = metrics.get("confusion_matrix")
    if not isinstance(confusion, dict) or not confusion:
        return [], []
    labels = sorted(
        {
            str(label)
            for expected, predictions in confusion.items()
            for label in ([expected] + list(predictions.keys() if isinstance(predictions, dict) else []))
        }
    )
    return ["True \\ Pred", *labels], [
        [expected, *[confusion.get(expected, {}).get(predicted, 0) for predicted in labels]]
        for expected in labels
    ]


def _render_evaluation_report(
    *,
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
    prediction_samples_artifact: dict[str, Any] | None,
    preprocessing_plan_artifact: dict[str, Any] | None,
    report_path: str,
) -> str:
    lines = [
        "# Model Evaluation Report",
        "",
        "## Experiment",
        "",
        *_markdown_table(
            ["Field", "Value"],
            [
                ["Experiment ID", experiment_id],
                ["Engine", engine],
                ["Dataset", dataset_path],
                ["Target column", target_column],
                ["GPU requested", "yes" if use_gpu else "no"],
                ["Best model", model.get("strategy") or model.get("algorithm") or "not recorded"],
            ],
        ),
        "",
        "## Metric Summary",
        "",
        *_markdown_table(["Metric", "Value"], _render_metric_summary(metrics)),
        "",
    ]

    if candidate_runs:
        lines.extend(
            [
                "## Candidate Model Comparison",
                "",
                *_markdown_table(
                    ["Model", "Accuracy", "F1 weighted", "Eval rows", "Strategy"],
                    [
                        [
                            run.get("model_name"),
                            _format_percent(run.get("metrics", {}).get("accuracy")),
                            _format_percent(run.get("metrics", {}).get("f1_weighted")),
                            _format_count(
                                run.get("metrics", {}).get("eval_row_count", run.get("metrics", {}).get("row_count"))
                            ),
                            run.get("metrics", {}).get("holdout_strategy") or "-",
                        ]
                        for run in candidate_runs
                    ],
                ),
                "",
            ]
        )

    per_class = metrics.get("per_class")
    if isinstance(per_class, dict) and per_class:
        lines.extend(
            [
                "## Per-Class Quality",
                "",
                *_markdown_table(
                    ["Class", "Precision", "Recall", "F1", "Support"],
                    [
                        [
                            label,
                            _format_percent(class_metrics.get("precision")),
                            _format_percent(class_metrics.get("recall")),
                            _format_percent(class_metrics.get("f1")),
                            _format_count(class_metrics.get("support")),
                        ]
                        for label, class_metrics in sorted(per_class.items())
                        if isinstance(class_metrics, dict)
                    ],
                ),
                "",
            ]
        )

    confusion_headers, confusion_rows = _render_confusion_rows(metrics)
    if confusion_rows:
        lines.extend(
            [
                "## Confusion Matrix",
                "",
                *_markdown_table(confusion_headers, confusion_rows),
                "",
            ]
        )

    feature_importance = model.get("feature_importance")
    if isinstance(feature_importance, list) and feature_importance:
        lines.extend(
            [
                "## Feature Importance",
                "",
                *_markdown_table(
                    ["Feature", "Importance"],
                    [
                        [item.get("feature"), item.get("importance")]
                        for item in feature_importance
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    permutation_importance = model.get("permutation_importance")
    if isinstance(permutation_importance, list) and permutation_importance:
        lines.extend(
            [
                "## Permutation Importance",
                "",
                *_markdown_table(
                    ["Feature", "Mean", "Std"],
                    [
                        [item.get("feature"), item.get("mean_importance"), item.get("std_importance")]
                        for item in permutation_importance
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    linear_coefficients = model.get("linear_coefficients")
    if isinstance(linear_coefficients, list) and linear_coefficients:
        lines.extend(
            [
                "## Linear Coefficients",
                "",
                *_markdown_table(
                    ["Feature", "Coefficient", "Abs"],
                    [
                        [item.get("feature"), item.get("coefficient"), item.get("abs_coefficient")]
                        for item in linear_coefficients
                        if isinstance(item, dict)
                    ],
                ),
                "",
            ]
        )

    if model.get("explanation_warning"):
        lines.extend(["## Explanation Warning", "", str(model["explanation_warning"]), ""])

    artifact_rows = [
        ["Model file", model_artifact.get("path")],
        ["Metrics JSON", metrics_artifact.get("path")],
    ]
    if prediction_samples_artifact is not None:
        artifact_rows.append(["Prediction samples", prediction_samples_artifact.get("path")])
    if preprocessing_plan_artifact is not None:
        artifact_rows.append(["Preprocessing plan", preprocessing_plan_artifact.get("path")])
    artifact_rows.append(["Evaluation report", report_path])

    lines.extend(
        [
            "## Artifacts",
            "",
            *_markdown_table(
                ["Artifact", "Path"],
                artifact_rows,
            ),
            "",
        ]
    )
    return "\n".join(lines)


def _write_evaluation_report_artifact(
    *,
    root: Path,
    project_id: str,
    session_id: str,
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
    prediction_samples_artifact: dict[str, Any] | None = None,
    preprocessing_plan_artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    artifact_id = uuid4().hex
    created_at = datetime.now(UTC).isoformat()
    report_name = "model_evaluation_report.md"
    report_file = root / "results" / session_id / report_name
    report_file.parent.mkdir(parents=True, exist_ok=True)
    report_project_path = _relative_project_path(root, report_file)
    report_file.write_text(
        _render_evaluation_report(
            experiment_id=experiment_id,
            engine=engine,
            dataset_path=dataset_path,
            target_column=target_column,
            use_gpu=use_gpu,
            metrics=metrics,
            model=model,
            candidate_runs=candidate_runs,
            model_artifact=model_artifact,
            metrics_artifact=metrics_artifact,
            prediction_samples_artifact=prediction_samples_artifact,
            preprocessing_plan_artifact=preprocessing_plan_artifact,
            report_path=report_project_path,
        ),
        encoding="utf-8",
    )
    return {
        "id": artifact_id,
        "type": "report",
        "name": report_name,
        "path": report_project_path,
        "created_at": created_at,
        "metadata": {
            "project_id": project_id,
            "session_id": session_id,
            "experiment_id": experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": metrics_artifact.get("path"),
            "prediction_samples_path": (
                prediction_samples_artifact.get("path") if prediction_samples_artifact is not None else None
            ),
            "model_path": model_artifact.get("path"),
            "preprocessing_plan_path": (
                preprocessing_plan_artifact.get("path") if preprocessing_plan_artifact is not None else None
            ),
        },
    }
