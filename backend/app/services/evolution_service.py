import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


@dataclass
class LessonRecord:
    id: str
    source_type: str
    source_id: str
    domain: list[str]
    observation: str
    recommendation: str
    confidence: float
    status: str
    evidence: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class EvolutionProtocol:
    id: str
    source_skill: str
    name: str
    purpose: str
    trigger: str
    agent_policy: list[str]
    inject_into: list[str]
    stability: str = "stable"


DEFAULT_EVOLUTION_PROTOCOLS = [
    EvolutionProtocol(
        id="grill-with-docs",
        source_skill="mattpocock/skills:grill-with-docs",
        name="任务前澄清与领域语言沉淀",
        purpose="在数据分析或建模前追问模糊目标，形成共享术语，避免 Agent 按错误理解执行。",
        trigger="用户提出高层目标、目标列不明确、业务指标含糊或术语与项目上下文冲突时。",
        agent_policy=[
            "先检查项目上下文和历史经验，再提出一个最关键的澄清问题。",
            "术语确定后写入项目知识区，避免后续任务重复解释。",
            "只有当决策代价高且存在真实权衡时，才沉淀为 ADR 风格决策记录。",
        ],
        inject_into=["data_analysis_agent", "ml_training_agent", "evolution_agent"],
    ),
    EvolutionProtocol(
        id="diagnose-loop",
        source_skill="mattpocock/skills:diagnose",
        name="可复现反馈闭环",
        purpose="处理失败分析、训练异常和性能退化时，先建立可重复验证的信号，再修复。",
        trigger="工具报错、Kernel 失败、训练指标异常、页面打不开或用户报告 bug 时。",
        agent_policy=[
            "优先构造自动化复现：测试、HTTP 脚本、WebSocket 回放或浏览器脚本。",
            "提出 3 到 5 个可证伪假设，并用最小插桩逐个验证。",
            "修复后保留回归测试，删除临时调试输出。",
        ],
        inject_into=["data_analysis_agent", "ml_training_agent", "tool_runtime", "evolution_agent"],
    ),
    EvolutionProtocol(
        id="tdd-vertical-slice",
        source_skill="mattpocock/skills:tdd",
        name="垂直切片 TDD",
        purpose="新增工具、API 或训练能力时，用一个行为测试驱动一条端到端实现路径。",
        trigger="实现新数据分析工具、机器学习能力、文件 API 或自进化规则时。",
        agent_policy=[
            "测试描述用户可观察行为，不测试私有实现细节。",
            "一次只写一个失败测试，最小实现通过后再进入下一条行为。",
            "所有测试通过后再重构，避免红灯状态下重构。",
        ],
        inject_into=["tool_authoring_agent", "ml_training_agent", "evolution_agent"],
    ),
    EvolutionProtocol(
        id="two-axis-review",
        source_skill="mattpocock/skills:review",
        name="规范与目标双轴审查",
        purpose="审核 Agent 产物时，把是否符合项目规范和是否符合原始目标分开判断。",
        trigger="采纳经验、合并规则、导出模型、生成报告或完成一轮自动修复后。",
        agent_policy=[
            "Standards 轴检查是否符合项目约定、领域语言和已有决策。",
            "Spec 轴检查是否真正满足用户任务，而不是只看起来合理。",
            "两轴分别给出结论，避免规范通过掩盖目标偏离。",
        ],
        inject_into=["evolution_agent", "review_agent"],
        stability="experimental",
    ),
    EvolutionProtocol(
        id="architecture-deepening",
        source_skill="mattpocock/skills:improve-codebase-architecture",
        name="架构深化机会发现",
        purpose="从历史失败和重复任务中发现浅模块、脆弱接口和缺失测试缝隙。",
        trigger="同类 bug 多次出现、工具重复实现、测试难以覆盖或 Agent 经常迷路时。",
        agent_policy=[
            "用删除测试判断模块是否只是转发层。",
            "优先寻找能提高局部性和杠杆率的深模块。",
            "把高价值架构建议沉淀为待审核经验，而不是自动重构。",
        ],
        inject_into=["evolution_agent", "architecture_review_agent"],
    ),
    EvolutionProtocol(
        id="handoff-compression",
        source_skill="mattpocock/skills:handoff",
        name="长任务交接压缩",
        purpose="把长会话中的关键决策、文件路径、验证结果和下一步浓缩成可接力上下文。",
        trigger="任务跨天、换电脑继续、长训练结束、或 Agent 上下文接近上限时。",
        agent_policy=[
            "只记录其他文档没有覆盖的上下文，避免复制完整历史。",
            "引用提交、文档、实验 ID 和 artifact 路径作为证据。",
            "明确下一位 Agent 应优先使用哪些技能和验证命令。",
        ],
        inject_into=["evolution_agent", "handoff_agent"],
    ),
]


class EvolutionService:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.lessons_dir = project_root / "evolution" / "lessons"
        self.high_confidence_dir = project_root / "evolution" / "rules" / "high-confidence"

    def create_lesson(
        self,
        source_type: str,
        source_id: str,
        domain: list[str],
        observation: str,
        recommendation: str,
        confidence: float,
        evidence: dict[str, Any] | None = None,
    ) -> LessonRecord:
        now = datetime.now(UTC).isoformat()
        record = LessonRecord(
            id=uuid4().hex,
            source_type=source_type,
            source_id=source_id,
            domain=domain,
            observation=observation,
            recommendation=recommendation,
            confidence=round(confidence, 4),
            status="pending_review",
            evidence=evidence or {},
            created_at=now,
            updated_at=now,
        )
        self._write_lesson(record)
        return record

    def list_lessons(self) -> list[LessonRecord]:
        self.lessons_dir.mkdir(parents=True, exist_ok=True)
        lessons = [self._read_lesson(path) for path in self.lessons_dir.glob("*.json")]
        return sorted(lessons, key=lambda lesson: lesson.created_at, reverse=True)

    def list_protocols(self) -> list[EvolutionProtocol]:
        return DEFAULT_EVOLUTION_PROTOCOLS

    def adopt_lesson(self, lesson_id: str) -> LessonRecord:
        lesson = self.get_lesson(lesson_id)
        lesson.status = "high_confidence"
        lesson.updated_at = datetime.now(UTC).isoformat()
        self._write_lesson(lesson)
        self.high_confidence_dir.mkdir(parents=True, exist_ok=True)
        (self.high_confidence_dir / f"{lesson.id}.json").write_text(
            json.dumps(asdict(lesson), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return lesson

    def reject_lesson(self, lesson_id: str) -> LessonRecord:
        lesson = self.get_lesson(lesson_id)
        lesson.status = "rejected"
        lesson.updated_at = datetime.now(UTC).isoformat()
        self._write_lesson(lesson)
        return lesson

    def get_lesson(self, lesson_id: str) -> LessonRecord:
        path = self.lessons_dir / f"{lesson_id}.json"
        if not path.exists():
            raise FileNotFoundError(lesson_id)
        return self._read_lesson(path)

    def _write_lesson(self, lesson: LessonRecord) -> None:
        self.lessons_dir.mkdir(parents=True, exist_ok=True)
        (self.lessons_dir / f"{lesson.id}.json").write_text(
            json.dumps(asdict(lesson), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _read_lesson(path: Path) -> LessonRecord:
        return LessonRecord(**json.loads(path.read_text(encoding="utf-8")))
