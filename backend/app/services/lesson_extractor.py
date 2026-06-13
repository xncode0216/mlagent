import json
from pathlib import Path
from typing import Any


class LessonExtractor:
    def __init__(self, project_root: Path):
        self.project_root = project_root

    def extract_from_session(self, session_id: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        lessons: list[dict[str, Any]] = []
        lessons.extend(self._extract_missing_value_lessons(session_id, events))
        lessons.extend(self._extract_kernel_error_lessons(session_id, events))
        return lessons

    def _extract_missing_value_lessons(
        self,
        session_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        lessons: list[dict[str, Any]] = []
        for event in events:
            if event.get("type") != "artifact_created":
                continue
            artifact = event.get("artifact") or {}
            if artifact.get("name") != "missing.json":
                continue
            path = self.project_root / str(artifact.get("path", ""))
            if not path.exists():
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            for column, stats in payload.get("columns", {}).items():
                ratio = float(stats.get("missing_ratio", 0))
                if 0 < ratio <= 0.05:
                    lessons.append(
                        {
                            "source_type": "analysis_session",
                            "source_id": session_id,
                            "domain": ["data-analysis", "missing-value"],
                            "title": "低缺失率数值列可优先使用中位数填充",
                            "observation": f"{column} 缺失率为 {ratio:.2%}，属于低缺失率字段。",
                            "recommendation": "优先尝试中位数填充，并增加缺失指示列保留缺失模式信号。",
                            "confidence": 0.72,
                            "conditions": {
                                "task_modes": ["analysis", "machine-learning"],
                                "feature_type": "numeric",
                                "missing_ratio_range": [0, 0.05],
                            },
                            "expected_benefit": {
                                "metric": "data_quality",
                                "description": "减少删除样本带来的信息损失。",
                            },
                            "evidence": {
                                "column": column,
                                "missing_ratio": ratio,
                                "trace_id": event.get("trace_id"),
                            },
                        }
                    )
        return lessons

    def _extract_kernel_error_lessons(
        self,
        session_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        lessons = []
        for event in events:
            text = str(event.get("text", ""))
            if (
                event.get("type") == "kernel_output"
                and event.get("stream") == "stderr"
                and "ModuleNotFoundError" in text
            ):
                package_name = text.rsplit("'", maxsplit=2)[1] if "'" in text else "任务依赖"
                lessons.append(
                    {
                        "source_type": "kernel_error",
                        "source_id": session_id,
                        "domain": ["runtime", "kernel-error"],
                        "title": "Kernel 缺少依赖时应先检查运行镜像",
                        "observation": text[:240],
                        "recommendation": f"先确认 Docker/Jupyter Kernel 镜像包含 {package_name}，再重跑训练或分析任务。",
                        "confidence": 0.78,
                        "conditions": {"error_type": "ModuleNotFoundError"},
                        "expected_benefit": {
                            "metric": "debug_time",
                            "description": "减少重复运行失败任务的时间。",
                        },
                        "evidence": {"trace_id": event.get("trace_id"), "stderr": text},
                    }
                )
        return lessons
