from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.tools.data_analysis import correlation_matrix, detect_missing, profile_dataset

router = APIRouter(prefix="/api/projects/{project_id}/analysis", tags=["analysis"])


class AnalysisReportRequest(BaseModel):
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
    created_at = datetime.now(UTC).isoformat()
    artifact_id = uuid4().hex

    return {
        "artifact": {
            "id": artifact_id,
            "project_id": project_id,
            "session_id": payload.session_id,
            "type": "report",
            "name": report_path.name,
            "path": _relative_path(root, report_path),
            "metadata": {"dataset_path": payload.dataset_path},
            "created_at": created_at,
        }
    }
