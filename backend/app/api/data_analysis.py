import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException
import pandas as pd
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.tools.data_analysis import (
    correlation_matrix,
    data_quality_profile,
    detect_missing,
    execute_preprocessing_plan,
    preprocessing_plan,
    preview_preprocessing_plan,
    profile_dataset,
)
from app.tools.data_analysis.preprocessing_strategies import (
    PreprocessingStrategies,
    strategy_metadata,
)

router = APIRouter(prefix="/api/projects/{project_id}/analysis", tags=["analysis"])


class AnalysisReportRequest(BaseModel):
    dataset_path: str = Field(min_length=1, max_length=4096)
    session_id: str = Field(default="manual-analysis", min_length=1, max_length=128)


class DataProfileRequest(AnalysisReportRequest):
    pass


class PreprocessingPlanRequest(AnalysisReportRequest):
    # None 表示沿用自动质量丢弃规则；给定列表则由调用方显式决定参与训练的特征。
    selected_features: list[str] | None = Field(default=None, max_length=4096)
    # None 表示沿用自动推断；给定则由调用方指定目标列，整份计划围绕它重算。
    target_column: str | None = Field(default=None, min_length=1, max_length=512)
    # 填充/缩放/编码策略。取值词表在 preprocessing_strategies 里，非法值由该模块拒绝。
    numeric_imputer: str | None = Field(default=None, min_length=1, max_length=64)
    numeric_scaler: str | None = Field(default=None, min_length=1, max_length=64)
    categorical_imputer: str | None = Field(default=None, min_length=1, max_length=64)


class ExecutePreprocessingPlanRequest(BaseModel):
    dataset_path: str | None = Field(default=None, min_length=1, max_length=4096)
    preprocessing_plan_path: str = Field(min_length=1, max_length=4096)
    session_id: str = Field(default="manual-analysis", min_length=1, max_length=128)


class CleanDatasetRequest(BaseModel):
    dataset_path: str = Field(min_length=1, max_length=4096)
    session_id: str = Field(default="manual-analysis", min_length=1, max_length=128)


class HandoffToMlRequest(BaseModel):
    dataset_path: str = Field(min_length=1, max_length=4096)
    session_id: str = Field(default="manual-analysis", min_length=1, max_length=128)


def _get_project_root(project_id: str) -> Path:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


def _resolve_project_path(root: Path, path: str) -> Path:
    current = (root / path).resolve()
    if root != current and root not in current.parents:
        raise HTTPException(status_code=400, detail="Invalid path")
    return current


def _relative_path(root: Path, target: Path) -> str:
    return str(target.relative_to(root)).replace("\\", "/")


def _render_report(dataset_path: str, profile: dict, missing: dict, correlation: dict) -> str:
    missing_rows = sorted(
        (
            (column, values.get("missing_count", 0), values.get("missing_ratio", 0.0))
            for column, values in missing.get("columns", {}).items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    missing_table = "\n".join(
        f"| {column} | {count} | {ratio * 100:.2f}% |" for column, count, ratio in missing_rows[:12]
    )
    if not missing_table:
        missing_table = "| - | 0 | 0.00% |"

    numeric_columns = ", ".join(correlation.get("columns", [])) or "无"
    generated_at = datetime.now(UTC).isoformat()

    return "\n".join(
        [
            "# 数据分析报告",
            "",
            f"- 数据集: `{dataset_path}`",
            f"- 生成时间: `{generated_at}`",
            f"- 行数: {profile.get('row_count', 0)}",
            f"- 列数: {profile.get('column_count', 0)}",
            "",
            "## 缺失值最高字段",
            "",
            "| 字段 | 缺失数量 | 缺失比例 |",
            "| --- | ---: | ---: |",
            missing_table,
            "",
            "## 数值相关性字段",
            "",
            numeric_columns,
            "",
            "## 后续建议",
            "",
            "1. 优先处理高缺失比例字段，确认缺失机制后再选择删除、填充或建模保留。",
            "2. 对数值特征做相关性检查，避免强共线字段同时进入线性模型。",
            "3. 将清洗策略和特征工程步骤保存到 `notebooks/` 或 `agent_schema/` 以便复现。",
            "",
        ]
    )


def _artifact_payload(
    project_id: str,
    session_id: str,
    artifact_type: str,
    name: str,
    path: str,
    metadata: dict | None = None,
) -> dict:
    return {
        "id": uuid4().hex,
        "project_id": project_id,
        "session_id": session_id,
        "type": artifact_type,
        "name": name,
        "path": path,
        "metadata": metadata or {},
        "created_at": datetime.now(UTC).isoformat(),
    }


def _target_candidates(df: pd.DataFrame) -> list[dict[str, Any]]:
    target_hints = {"target", "label", "churn", "default", "fraud", "y"}
    candidates: list[dict[str, Any]] = []
    row_count = max(1, len(df))
    for index, column in enumerate(df.columns):
        series = df[column]
        lower_name = column.lower()
        unique_count = int(series.nunique(dropna=True))
        missing_ratio = float(series.isna().mean()) if len(series) else 0.0
        score = 0.0
        reasons: list[str] = []

        if lower_name in target_hints:
            score += 0.7
            reasons.append("字段名匹配常见目标列")
        if any(hint in lower_name for hint in target_hints - {"y"}):
            score += 0.25
            reasons.append("字段名包含建模目标语义")
        if 1 < unique_count <= max(20, row_count * 0.2):
            score += 0.2
            reasons.append("唯一值数量适合作为监督学习目标")
        if index == len(df.columns) - 1:
            score += 0.15
            reasons.append("位于数据集最后一列")
        if lower_name.endswith(("_id", "id")):
            score -= 0.4
            reasons.append("疑似标识符字段")

        candidates.append(
            {
                "column": column,
                "score": round(max(0.0, min(score, 1.0)), 4),
                "dtype": str(series.dtype),
                "unique_count": unique_count,
                "missing_ratio": missing_ratio,
                "reason": "；".join(reasons) or "可作为备选目标列，需要用户确认",
            }
        )

    return sorted(candidates, key=lambda item: item["score"], reverse=True)


@router.post("/report")
def generate_analysis_report(project_id: str, payload: AnalysisReportRequest) -> dict:
    root = _get_project_root(project_id)
    dataset = _resolve_project_path(root, payload.dataset_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    profile = profile_dataset(dataset)
    missing = detect_missing(dataset)
    correlation = correlation_matrix(dataset)
    report = _render_report(payload.dataset_path, profile, missing, correlation)

    report_dir = root / "results" / payload.session_id
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "analysis_report.md"
    report_path.write_text(report, encoding="utf-8", newline="")

    return {
        "artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "report",
            report_path.name,
            _relative_path(root, report_path),
            {"dataset_path": payload.dataset_path},
        )
    }


@router.post("/profile")
def generate_data_profile(project_id: str, payload: DataProfileRequest) -> dict:
    root = _get_project_root(project_id)
    dataset = _resolve_project_path(root, payload.dataset_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    profile = data_quality_profile(dataset)
    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    profile_path = result_dir / "data_quality_profile.json"
    profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "profile": profile,
        "artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            profile_path.name,
            _relative_path(root, profile_path),
            {"dataset_path": payload.dataset_path, "profile_type": "data_quality"},
        ),
    }


@router.post("/preprocess-plan")
def generate_preprocessing_plan(project_id: str, payload: PreprocessingPlanRequest) -> dict:
    root = _get_project_root(project_id)
    dataset = _resolve_project_path(root, payload.dataset_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    if payload.selected_features is not None and not payload.selected_features:
        # 训练侧在计划无特征时会回退到“使用全部列”，空选择因此会静默违背用户意图
        raise HTTPException(status_code=400, detail="At least one feature must be selected")

    defaults = PreprocessingStrategies()
    try:
        plan = preprocessing_plan(
            dataset,
            dataset_path=payload.dataset_path,
            selected_features=payload.selected_features,
            target_column=payload.target_column,
            strategies=PreprocessingStrategies(
                numeric_imputer=payload.numeric_imputer or defaults.numeric_imputer,
                numeric_scaler=payload.numeric_scaler or defaults.numeric_scaler,
                categorical_imputer=payload.categorical_imputer or defaults.categorical_imputer,
            ),
        )
    except ValueError as error:
        # 目标列不在数据集里，或策略取值不受支持。放行只会把失败推迟到执行/训练时，
        # 那里的报错离用户更远。
        raise HTTPException(status_code=400, detail=str(error)) from error
    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    plan_path = result_dir / "preprocessing_plan.json"

    output_dataset_path = _relative_path(root, result_dir / f"{dataset.stem}_preprocessed.csv")
    script = str(plan.pop("pipeline_script"))
    script = script.replace(
        f"output_path = {'results/manual-analysis/' + dataset.stem + '_preprocessed.csv'!r}",
        f"output_path = {output_dataset_path!r}",
    )
    plan["output_dataset_path"] = output_dataset_path
    plan["sklearn_pipeline_script_path"] = f"notebooks/{payload.session_id}_preprocessing_pipeline.py"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    script_dir = root / "notebooks"
    script_dir.mkdir(parents=True, exist_ok=True)
    script_path = script_dir / f"{payload.session_id}_preprocessing_pipeline.py"
    script_path.write_text(script, encoding="utf-8", newline="")

    return {
        "plan": plan,
        "plan_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            plan_path.name,
            _relative_path(root, plan_path),
            {
                "dataset_path": payload.dataset_path,
                "target_column": plan["target_column"],
                "artifact_role": "preprocessing_plan",
                **strategy_metadata(plan.get("steps")),
            },
        ),
        "pipeline_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "code",
            script_path.name,
            _relative_path(root, script_path),
            {
                "dataset_path": payload.dataset_path,
                "target_column": plan["target_column"],
                "plan_path": _relative_path(root, plan_path),
            },
        ),
    }


def _render_transformation_report(summary: dict[str, Any]) -> str:
    numeric_rows = "\n".join(
        f"| {column} | {details.get('fill_value')} | {details.get('scaler')} |"
        for column, details in summary.get("transformations", {}).get("numeric", {}).items()
    )
    if not numeric_rows:
        numeric_rows = "| - | - | - |"
    categorical_rows = "\n".join(
        f"| {column} | {details.get('fill_value')} | {details.get('encoder')} |"
        for column, details in summary.get("transformations", {}).get("categorical", {}).items()
    )
    if not categorical_rows:
        categorical_rows = "| - | - | - |"
    drop_rows = "\n".join(
        f"| {column} | {reason} |" for column, reason in summary.get("transformations", {}).get("dropped", {}).items()
    )
    if not drop_rows:
        drop_rows = "| - | - |"

    return "\n".join(
        [
            "# Preprocessing Transformation Report",
            "",
            "## Summary",
            "",
            f"- Source dataset: `{summary['source_dataset_path']}`",
            f"- Preprocessing plan: `{summary['preprocessing_plan_path']}`",
            f"- Output dataset: `{summary['output_dataset_path']}`",
            f"- Target column: `{summary['target_column']}`",
            f"- Input shape: {summary['input_shape']['rows']} rows x {summary['input_shape']['columns']} columns",
            f"- Output shape: {summary['output_shape']['rows']} rows x {summary['output_shape']['columns']} columns",
            "",
            "## Dropped Columns",
            "",
            "| Column | Reason |",
            "| --- | --- |",
            drop_rows,
            "",
            "## Numeric Transforms",
            "",
            "| Column | Fill Value | Scaler |",
            "| --- | ---: | --- |",
            numeric_rows,
            "",
            "## Categorical Transforms",
            "",
            "| Column | Fill Value | Encoder |",
            "| --- | --- | --- |",
            categorical_rows,
            "",
        ]
    )


@router.post("/execute-preprocess-plan")
def execute_preprocessing_plan_endpoint(project_id: str, payload: ExecutePreprocessingPlanRequest) -> dict:
    root = _get_project_root(project_id)
    dataset_project_path = payload.dataset_path
    dataset: Path | None = None
    if dataset_project_path is not None:
        dataset = _resolve_project_path(root, dataset_project_path)
        if not dataset.exists() or not dataset.is_file():
            raise HTTPException(status_code=404, detail="Dataset not found")

    plan_file = _resolve_project_path(root, payload.preprocessing_plan_path)
    if not plan_file.exists() or not plan_file.is_file():
        raise HTTPException(status_code=404, detail="Preprocessing plan not found")
    try:
        plan_payload = json.loads(plan_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if dataset_project_path is None:
        dataset_project_path = plan_payload.get("dataset_path")
        if not isinstance(dataset_project_path, str) or not dataset_project_path:
            raise HTTPException(status_code=400, detail="Dataset path is required")
        dataset = _resolve_project_path(root, dataset_project_path)
        if not dataset.exists() or not dataset.is_file():
            raise HTTPException(status_code=404, detail="Dataset not found")

    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    output_path = result_dir / f"{dataset.stem}_planned.csv"
    output_project_path = _relative_path(root, output_path)

    try:
        summary = execute_preprocessing_plan(
            csv_path=dataset,
            plan_path=plan_file,
            output_path=output_path,
            dataset_path=dataset_project_path,
            plan_project_path=payload.preprocessing_plan_path,
            output_project_path=output_project_path,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    summary_path = result_dir / "preprocessing_transform_report.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    report_path = result_dir / "preprocessing_transform_report.md"
    report_path.write_text(_render_transformation_report(summary), encoding="utf-8", newline="")

    return {
        "summary": summary,
        "transformed_data_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            output_path.name,
            output_project_path,
            {
                "dataset_path": dataset_project_path,
                "preprocessing_plan_path": payload.preprocessing_plan_path,
                "target_column": summary["target_column"],
                "artifact_role": "preprocessed_dataset",
            },
        ),
        "summary_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            summary_path.name,
            _relative_path(root, summary_path),
            {
                "dataset_path": dataset_project_path,
                "preprocessing_plan_path": payload.preprocessing_plan_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_summary",
            },
        ),
        "report_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "report",
            report_path.name,
            _relative_path(root, report_path),
            {
                "dataset_path": dataset_project_path,
                "preprocessing_plan_path": payload.preprocessing_plan_path,
                "output_dataset_path": output_project_path,
                "artifact_role": "preprocessing_transform_report",
            },
        ),
    }


@router.post("/preview-preprocess-plan")
def preview_preprocessing_plan_endpoint(project_id: str, payload: ExecutePreprocessingPlanRequest) -> dict:
    """算出计划会把数据变成什么样，但不写变换后的数据集。

    与执行端点共用同一段变换计算，所以预览不会和实际执行说两套话。请求体也复用执行的
    模型：预览和执行要针对**同一份**计划与数据集，两个形状不同的请求体反而容易漏字段。
    """
    root = _get_project_root(project_id)
    dataset_project_path = payload.dataset_path
    plan_file = _resolve_project_path(root, payload.preprocessing_plan_path)
    if not plan_file.exists() or not plan_file.is_file():
        raise HTTPException(status_code=404, detail="Preprocessing plan not found")
    if dataset_project_path is None:
        try:
            plan_payload = json.loads(plan_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        dataset_project_path = plan_payload.get("dataset_path")
        if not isinstance(dataset_project_path, str) or not dataset_project_path:
            raise HTTPException(status_code=400, detail="Dataset path is required")
    dataset = _resolve_project_path(root, dataset_project_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        preview = preview_preprocessing_plan(
            csv_path=dataset,
            plan_path=plan_file,
            dataset_path=dataset_project_path,
            plan_project_path=payload.preprocessing_plan_path,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    preview_path = result_dir / "preprocessing_transform_preview.json"
    preview_path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "preview": preview,
        "preview_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            preview_path.name,
            _relative_path(root, preview_path),
            {
                "dataset_path": dataset_project_path,
                "preprocessing_plan_path": payload.preprocessing_plan_path,
                "artifact_role": "preprocessing_transform_preview",
            },
        ),
    }


@router.post("/handoff-to-ml")
def handoff_to_ml(project_id: str, payload: HandoffToMlRequest) -> dict:
    root = _get_project_root(project_id)
    dataset = _resolve_project_path(root, payload.dataset_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = pd.read_csv(dataset)
    candidates = _target_candidates(df)
    recommended_target = candidates[0]["column"] if candidates else ""
    handoff = {
        "mode": "machine-learning",
        "dataset_path": payload.dataset_path,
        "recommended_target_column": recommended_target,
        "target_candidates": candidates,
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "created_at": datetime.now(UTC).isoformat(),
    }

    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    handoff_path = result_dir / "ml_handoff.json"
    handoff_path.write_text(json.dumps(handoff, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        **handoff,
        "artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "training",
            handoff_path.name,
            _relative_path(root, handoff_path),
            {
                "dataset_path": payload.dataset_path,
                "recommended_target_column": recommended_target,
            },
        ),
    }


@router.post("/clean")
def clean_dataset(project_id: str, payload: CleanDatasetRequest) -> dict:
    root = _get_project_root(project_id)
    dataset = _resolve_project_path(root, payload.dataset_path)
    if not dataset.exists() or not dataset.is_file():
        raise HTTPException(status_code=404, detail="Dataset not found")

    df = pd.read_csv(dataset)
    cleaned = df.copy()
    numeric_fill_values: dict[str, float] = {}
    categorical_fill_values: dict[str, str] = {}
    for column in cleaned.columns:
        if not cleaned[column].isna().any():
            continue
        if pd.api.types.is_numeric_dtype(cleaned[column]):
            fill_value = float(cleaned[column].median()) if cleaned[column].notna().any() else 0.0
            numeric_fill_values[column] = fill_value
            cleaned[column] = cleaned[column].fillna(fill_value)
        else:
            mode = cleaned[column].mode(dropna=True)
            fill_value = str(mode.iloc[0]) if not mode.empty else "__missing__"
            categorical_fill_values[column] = fill_value
            cleaned[column] = cleaned[column].fillna(fill_value)

    result_dir = root / "results" / payload.session_id
    result_dir.mkdir(parents=True, exist_ok=True)
    cleaned_path = result_dir / f"{dataset.stem}_cleaned.csv"
    cleaned.to_csv(cleaned_path, index=False)

    script_dir = root / "notebooks"
    script_dir.mkdir(parents=True, exist_ok=True)
    script_path = script_dir / f"{payload.session_id}_cleaning.py"
    script = [
        "import pandas as pd",
        "",
        f"df = pd.read_csv({payload.dataset_path!r})",
    ]
    for column, fill_value in numeric_fill_values.items():
        script.append(f"df[{column!r}] = df[{column!r}].fillna({fill_value!r})")
    for column, fill_value in categorical_fill_values.items():
        script.append(f"df[{column!r}] = df[{column!r}].fillna({fill_value!r})")
    script.extend(
        [
            f"df.to_csv({_relative_path(root, cleaned_path)!r}, index=False)",
            "",
        ]
    )
    script_path.write_text("\n".join(script), encoding="utf-8", newline="")

    return {
        "cleaned_data_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "dataframe",
            cleaned_path.name,
            _relative_path(root, cleaned_path),
            {
                "dataset_path": payload.dataset_path,
                "fill_values": {
                    "numeric": numeric_fill_values,
                    "categorical": categorical_fill_values,
                },
            },
        ),
        "script_artifact": _artifact_payload(
            project_id,
            payload.session_id,
            "code",
            script_path.name,
            _relative_path(root, script_path),
            {"dataset_path": payload.dataset_path},
        ),
        "fill_values": {
            "numeric": numeric_fill_values,
            "categorical": categorical_fill_values,
        },
    }
