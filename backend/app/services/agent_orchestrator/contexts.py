"""Typed context dataclasses passed between orchestrator stages (P1-6)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.services.session_service import SessionService


@dataclass(frozen=True)
class ActiveFileResolution:
    csv_path: Path | None
    code: str | None = None
    message: str | None = None


@dataclass(frozen=True)
class AgentContext:
    project_id: str
    project_root: Path
    active_file: str
    csv_path: Path
    mode: str
    session_service: SessionService


@dataclass(frozen=True)
class ProjectSessionContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService


@dataclass(frozen=True)
class TrainingConfigurationContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService
    dataset_path: str
    dataset_version_id: str
    dataset_file: Path
    target_column: str
    preprocessing_plan_path: str | None


@dataclass(frozen=True)
class MissingDatasetContext:
    project_id: str
    mode: str
    active_file: str
    candidate_datasets: list[dict[str, str]]


@dataclass(frozen=True)
class EvaluationContext:
    project_id: str
    project_root: Path
    mode: str
    session_service: SessionService
    experiment_id: str
    run: dict[str, Any]


@dataclass(frozen=True)
class AmbiguousRunContext:
    project_id: str
    mode: str
    active_file: str
    candidate_runs: list[dict[str, str]]
