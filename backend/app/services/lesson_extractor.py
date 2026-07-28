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

    def _read_artifact(self, event: dict[str, Any], name: str) -> dict[str, Any] | None:
        if event.get("type") != "artifact_created":
            return None
        artifact = event.get("artifact") or {}
        if artifact.get("name") != name:
            return None
        path = self.project_root / str(artifact.get("path", ""))
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _low_missing_numeric_columns(payload: dict[str, Any]) -> list[tuple[str, float]]:
        """挑出适合中位数填充建议的列：有缺失但缺失率低的数值列。

        两条流程的画像产物结构不同——legacy ``missing.json`` 是 ``{列名: 统计}``
        的映射且不带类型信息；现代 ``data_quality_profile.json`` 是带 ``kind``
        的列表。这里统一成同一份判定，避免两处各写一遍而慢慢分叉。
        """
        columns = payload.get("columns")
        if isinstance(columns, dict):
            candidates = [
                (str(name), float(stats.get("missing_ratio", 0)))
                for name, stats in columns.items()
                # legacy 产物没有列类型，沿用其原有行为：不按类型过滤
                if isinstance(stats, dict)
            ]
        elif isinstance(columns, list):
            candidates = [
                (str(column.get("name")), float(column.get("missing_ratio", 0)))
                for column in columns
                if isinstance(column, dict) and column.get("kind") == "numeric"
            ]
        else:
            return []
        return [(name, ratio) for name, ratio in candidates if 0 < ratio <= 0.05]

    def _extract_missing_value_lessons(
        self,
        session_id: str,
        events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        lessons: list[dict[str, Any]] = []
        seen_columns: set[str] = set()
        for event in events:
            # 现代自然语言流程产出 data_quality_profile.json，legacy 分析流程产出
            # missing.json。只认后者会让主路径上的"沉淀经验"永远找不到候选。
            payload = self._read_artifact(event, "data_quality_profile.json") or self._read_artifact(
                event, "missing.json"
            )
            if payload is None:
                continue
            for column, ratio in self._low_missing_numeric_columns(payload):
                # 一次会话里两条流程可能各产出一份画像，同一列不该沉淀两次
                if column in seen_columns:
                    continue
                seen_columns.add(column)
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
