"""agent_command / props event builders extracted from the orchestrator (P1-6 slice 2).

These are stateless apart from two ids (trace_id, session_id). The builder
functions take the orchestrator itself as ``meta`` and read only those two
attributes, so the facade methods delegate with ``return f(self, ...)``.
"""

from __future__ import annotations

from typing import Any

from app.services.agent_orchestrator.contexts import (
    AgentContext,
    AmbiguousRunContext,
    EvaluationContext,
    MissingDatasetContext,
    ProjectSessionContext,
    TrainingConfigurationContext,
)


def profile_props(context: AgentContext, profile_artifact: dict[str, Any]) -> dict[str, Any]:
    metadata = profile_artifact.get("metadata") if isinstance(profile_artifact.get("metadata"), dict) else {}
    candidates = metadata.get("target_candidates") if isinstance(metadata.get("target_candidates"), list) else []
    target_columns = [
        str(candidate.get("column"))
        for candidate in candidates
        if isinstance(candidate, dict) and isinstance(candidate.get("column"), str)
    ]
    return {
        "dataset_path": context.active_file,
        "profile_path": profile_artifact.get("path"),
        "row_count": int(metadata.get("row_count") or 0),
        "column_count": int(metadata.get("column_count") or 0),
        "target_candidates": target_columns,
        "source": "intent_router",
    }


def training_command_event(meta, context: TrainingConfigurationContext) -> dict[str, Any]:
    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "train",
            "dataset_path": context.dataset_path,
            "dataset_version_id": context.dataset_version_id,
            "target_column": context.target_column,
            "selected_run_id": None,
            "selected_artifacts": [context.preprocessing_plan_path] if context.preprocessing_plan_path else [],
            "missing_context": [],
            "risk_level": "medium",
            "planned_steps": ["train"],
            "proposed_tools": ["train_sklearn"],
            "approval_required": False,
            "component_requests": ["training_config"],
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "dataset_path": context.dataset_path,
            "dataset_version_id": context.dataset_version_id,
            "target_column": context.target_column,
            "preprocessing_plan_path": context.preprocessing_plan_path,
        },
    }


def missing_dataset_command_event(meta, context: MissingDatasetContext) -> dict[str, Any]:
    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "train",
            "dataset_path": None,
            "dataset_version_id": None,
            "target_column": None,
            "selected_run_id": None,
            "selected_artifacts": [],
            "missing_context": ["dataset_path"],
            "risk_level": "medium",
            "planned_steps": ["train"],
            "proposed_tools": ["train_sklearn"],
            "approval_required": True,
            "component_requests": ["training_config"],
            "candidate_datasets": context.candidate_datasets,
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "active_file": context.active_file,
            "candidate_datasets": context.candidate_datasets,
        },
    }


def evaluation_command_event(meta, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
    selected_artifacts: list[str] = []
    for key in (
        "metrics_path",
        "model_path",
        "evaluation_report_path",
        "prediction_samples_path",
        "preprocessing_plan_path",
    ):
        value = props.get(key)
        if isinstance(value, str) and value and value not in selected_artifacts:
            selected_artifacts.append(value)

    dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
    target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
    dataset_version_id = (
        context.run.get("dataset_version_id")
        if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
        else None
    )
    missing_context = [
        key
        for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
        if not value
    ]

    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "evaluate",
            "dataset_path": dataset_path,
            "dataset_version_id": dataset_version_id,
            "target_column": target_column or None,
            "selected_run_id": context.experiment_id,
            "selected_artifacts": selected_artifacts,
            "missing_context": missing_context,
            "risk_level": "low",
            "planned_steps": ["evaluate"],
            "proposed_tools": ["model_comparison", "evaluation_report"],
            "approval_required": False,
            "component_requests": ["model_comparison", "evaluation_report"],
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "experiment_id": context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": props.get("metrics_path"),
            "model_path": props.get("model_path"),
            "evaluation_report_path": props.get("evaluation_report_path"),
            "prediction_samples_path": props.get("prediction_samples_path"),
            "preprocessing_plan_path": props.get("preprocessing_plan_path"),
        },
    }


def diagnosis_command_event(
    meta,
    context: EvaluationContext,
    props: dict[str, Any],
    diagnosis: dict[str, Any],
) -> dict[str, Any]:
    selected_artifacts: list[str] = []
    for key in (
        "metrics_path",
        "model_path",
        "evaluation_report_path",
        "prediction_samples_path",
        "preprocessing_plan_path",
    ):
        value = props.get(key)
        if isinstance(value, str) and value and value not in selected_artifacts:
            selected_artifacts.append(value)

    dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
    target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
    dataset_version_id = (
        context.run.get("dataset_version_id")
        if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
        else None
    )
    missing_context = [
        key
        for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
        if not value
    ]
    diagnosis_summary = {
        "worst_class": diagnosis.get("worst_class"),
        "main_confusion": diagnosis.get("main_confusion"),
        "error_count": diagnosis.get("error_count"),
        "recommendation": diagnosis.get("recommendation"),
    }

    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "diagnose",
            "dataset_path": dataset_path,
            "dataset_version_id": dataset_version_id,
            "target_column": target_column or None,
            "selected_run_id": context.experiment_id,
            "selected_artifacts": selected_artifacts,
            "missing_context": missing_context,
            "risk_level": "low",
            "planned_steps": ["diagnose"],
            "proposed_tools": ["error_analysis", "prediction_samples"],
            "approval_required": False,
            "component_requests": ["error_analysis", "prediction_samples"],
            "diagnosis_summary": diagnosis_summary,
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "experiment_id": context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": props.get("metrics_path"),
            "model_path": props.get("model_path"),
            "evaluation_report_path": props.get("evaluation_report_path"),
            "prediction_samples_path": props.get("prediction_samples_path"),
            "preprocessing_plan_path": props.get("preprocessing_plan_path"),
            "worst_class": diagnosis.get("worst_class"),
            "main_confusion": diagnosis.get("main_confusion"),
            "error_count": diagnosis.get("error_count"),
            "recommendation": diagnosis.get("recommendation"),
        },
    }


def export_command_event(meta, context: EvaluationContext, props: dict[str, Any]) -> dict[str, Any]:
    selected_artifacts: list[str] = []
    for key in (
        "metrics_path",
        "model_path",
        "evaluation_report_path",
        "prediction_samples_path",
        "preprocessing_plan_path",
        "export_bundle_path",
    ):
        value = props.get(key)
        if isinstance(value, str) and value and value not in selected_artifacts:
            selected_artifacts.append(value)

    dataset_path = props.get("dataset_path") if isinstance(props.get("dataset_path"), str) else ""
    target_column = props.get("target_column") if isinstance(props.get("target_column"), str) else ""
    dataset_version_id = (
        context.run.get("dataset_version_id")
        if isinstance(context.run.get("dataset_version_id"), str) and context.run.get("dataset_version_id")
        else None
    )
    missing_required = (
        props.get("missing_required_artifacts")
        if isinstance(props.get("missing_required_artifacts"), list)
        else []
    )
    missing_context = [
        key
        for key, value in (("dataset_path", dataset_path), ("target_column", target_column))
        if not value
    ]
    missing_context.extend(
        f"artifact:{str(item)}"
        for item in missing_required
        if isinstance(item, str) and item
    )

    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "export",
            "dataset_path": dataset_path,
            "dataset_version_id": dataset_version_id,
            "target_column": target_column or None,
            "selected_run_id": context.experiment_id,
            "selected_artifacts": selected_artifacts,
            "missing_context": missing_context,
            "risk_level": "medium",
            "planned_steps": ["export"],
            "proposed_tools": ["evaluation_report", "export_bundle"],
            "approval_required": False,
            "component_requests": ["evaluation_report", "export_bundle"],
            "bundle_ready": props.get("bundle_ready") is True,
            "missing_required_artifacts": missing_required,
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "experiment_id": context.experiment_id,
            "dataset_path": dataset_path,
            "target_column": target_column,
            "metrics_path": props.get("metrics_path"),
            "model_path": props.get("model_path"),
            "evaluation_report_path": props.get("evaluation_report_path"),
            "prediction_samples_path": props.get("prediction_samples_path"),
            "preprocessing_plan_path": props.get("preprocessing_plan_path"),
            "export_bundle_path": props.get("export_bundle_path"),
            "bundle_ready": props.get("bundle_ready") is True,
            "missing_required_artifacts": missing_required,
        },
    }


def learning_command_event(meta, context: ProjectSessionContext, props: dict[str, Any]) -> dict[str, Any]:
    source_artifact_items = (
        props.get("source_artifacts")
        if isinstance(props.get("source_artifacts"), list)
        else []
    )
    source_artifacts = [
        str(item)
        for item in source_artifact_items
        if isinstance(item, str) and item
    ]
    has_candidates = props.get("has_extractable_candidates") is True
    candidate_count = int(props.get("candidate_count") or 0)
    high_confidence_count = int(props.get("high_confidence_count") or 0)
    missing_context = [] if has_candidates else ["candidate_lessons"]

    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": "learn",
            "dataset_path": None,
            "dataset_version_id": None,
            "target_column": None,
            "selected_run_id": None,
            "selected_artifacts": source_artifacts,
            "missing_context": missing_context,
            "risk_level": "high",
            "planned_steps": ["learn"],
            "proposed_tools": ["lesson_review"],
            "approval_required": True,
            "component_requests": ["lesson_review"],
            "source_session_id": props.get("source_session_id"),
            "source_event_count": props.get("source_event_count"),
            "candidate_count": candidate_count,
            "high_confidence_count": high_confidence_count,
            "has_extractable_candidates": has_candidates,
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "source_session_id": props.get("source_session_id"),
            "source_event_count": props.get("source_event_count"),
            "candidate_count": candidate_count,
            "high_confidence_count": high_confidence_count,
            "latest_event_type": props.get("latest_event_type"),
            "source_artifacts": source_artifacts,
            "has_extractable_candidates": has_candidates,
        },
    }


def missing_run_command_event(meta, *, intent: str, context: AmbiguousRunContext) -> dict[str, Any]:
    component_requests = {
        "evaluate": ["model_comparison", "evaluation_report"],
        "diagnose": ["error_analysis", "prediction_samples"],
        "export": ["evaluation_report", "export_bundle"],
        "iterate": ["iteration_proposal"],
    }.get(intent, [])
    return {
        "type": "agent_command",
        "trace_id": meta.trace_id,
        "task_id": meta.session_id,
        "command": {
            "intent": intent,
            "dataset_path": None,
            "dataset_version_id": None,
            "target_column": None,
            "selected_run_id": None,
            "selected_artifacts": [],
            "missing_context": ["experiment_id"],
            "risk_level": "medium",
            "planned_steps": [intent],
            "proposed_tools": component_requests,
            "approval_required": True,
            "component_requests": component_requests,
            "candidate_runs": context.candidate_runs,
        },
        "resolved_context": {
            "project_id": context.project_id,
            "mode": context.mode,
            "active_file": context.active_file,
            "candidate_runs": context.candidate_runs,
        },
    }


def dataset_registry_props(registry_artifact: dict[str, Any]) -> dict[str, Any]:
    metadata = registry_artifact.get("metadata") if isinstance(registry_artifact.get("metadata"), dict) else {}
    columns = metadata.get("columns") if isinstance(metadata.get("columns"), list) else []
    return {
        "dataset_path": str(metadata.get("dataset_path") or ""),
        "registry_path": registry_artifact.get("path"),
        "dataset_version_id": str(metadata.get("dataset_version_id") or ""),
        "row_count": int(metadata.get("row_count") or 0),
        "column_count": int(metadata.get("column_count") or 0),
        "columns": [str(column) for column in columns],
        "sample_strategy": str(metadata.get("sample_strategy") or "unknown"),
        "source": "intent_router",
    }
