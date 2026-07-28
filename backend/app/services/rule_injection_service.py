import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.services.evolution_service import EvolutionService


class RuleInjectionService:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.evolution = EvolutionService(project_root)
        self.injection_log_path = project_root / "evolution" / "injection-log.jsonl"

    def match_rules(self, session_id: str, context: dict[str, Any]) -> dict[str, Any]:
        matches = []
        for lesson in self.evolution.list_active_rules():
            # scope 先于打分：它是用户设定的边界，越界即完全不考虑，
            # 否则一条高置信规则仍可能靠 conditions 打分跨过阈值而越界生效。
            if not self._within_scope(lesson.scope, context):
                continue
            score = self._score_lesson(
                lesson.conditions or {},
                lesson.domain,
                lesson.confidence,
                context,
            )
            if score >= 0.65:
                matches.append(
                    {
                        "lesson_id": lesson.id,
                        "score": round(score, 4),
                        "recommendation": lesson.recommendation,
                        "reason": "匹配当前任务模式、数据特征和经验标签。",
                    }
                )
        matches.sort(key=lambda item: item["score"], reverse=True)
        return {"session_id": session_id, "matched_rules": matches[:5]}

    def inject_prompt(self, session_id: str, matched_rules: list[dict[str, Any]]) -> str:
        lines = ["历史经验命中："]
        for item in matched_rules[:5]:
            lines.append(f"- [{item['lesson_id']}] {item['recommendation']} 原因：{item['reason']}")
        snippet = "\n".join(lines) if matched_rules else ""
        self._append_log(session_id, matched_rules, snippet)
        return snippet

    def list_injection_log(self) -> list[dict[str, Any]]:
        if not self.injection_log_path.exists():
            return []
        return [
            json.loads(line)
            for line in self.injection_log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def _append_log(
        self,
        session_id: str,
        matched_rules: list[dict[str, Any]],
        snippet: str,
    ) -> None:
        self.injection_log_path.parent.mkdir(parents=True, exist_ok=True)
        event = {
            "session_id": session_id,
            "matched_rules": matched_rules,
            "snippet": snippet,
            "created_at": datetime.now(UTC).isoformat(),
        }
        with self.injection_log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    @staticmethod
    def _within_scope(scope: dict[str, Any] | None, context: dict[str, Any]) -> bool:
        """Whether a rule is allowed to apply at all in this context.

        An empty or absent dimension places no restriction on that dimension,
        so a lesson saved before scoping existed keeps applying everywhere.
        """
        if not scope:
            return True
        datasets = scope.get("datasets") or []
        if datasets and context.get("dataset_path") not in datasets:
            return False
        modes = scope.get("modes") or []
        if modes and context.get("mode") not in modes:
            return False
        return True

    @staticmethod
    def _score_lesson(
        conditions: dict[str, Any],
        domain: list[str],
        confidence: float,
        context: dict[str, Any],
    ) -> float:
        score = 0.0
        if context.get("mode") in conditions.get("task_modes", []):
            score += 0.25
        if context.get("feature_type") == conditions.get("feature_type"):
            score += 0.2
        ratio_range = conditions.get("missing_ratio_range")
        if ratio_range and ratio_range[0] <= float(context.get("missing_ratio", 1)) <= ratio_range[1]:
            score += 0.25
        if set(context.get("tags", [])) & set(domain):
            score += 0.2
        score += min(confidence, 1.0) * 0.1
        return score
