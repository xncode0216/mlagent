from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
import pandas as pd
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.tools.data_analysis import correlation_matrix, detect_missing, profile_dataset

router = APIRouter(prefix="/api/projects/{project_id}/analysis", tags=["analysis"])


class AnalysisReportRequest(BaseModel):
    dataset_path: str = Field(min_length=1, max_length=4096)
    session_id: str = Field(default="manual-analysis", min_length=1, max_length=128)


class CleanDatasetRequest(BaseModel):
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
