"""Workflow stage runners extracted from the orchestrator (P1-6 slice 4).

拆分自单文件 `stages.py`（P3-5 切片 2）：15 个 stage runner 按 intent 分成
六组，彼此不互相调用，因此分组是纯归属划分。这里把它们重新组合成
`StageRunnersMixin`——`AgentOrchestrator` 的导入路径与组合方式都不变。
"""

from __future__ import annotations

from app.services.agent_orchestrator.stages.data import DataStagesMixin
from app.services.agent_orchestrator.stages.diagnosis import DiagnosisStagesMixin
from app.services.agent_orchestrator.stages.handoff import HandoffStagesMixin
from app.services.agent_orchestrator.stages.model import ModelStagesMixin
from app.services.agent_orchestrator.stages.preprocessing import PreprocessingStagesMixin
from app.services.agent_orchestrator.stages.recovery import RecoveryStagesMixin

__all__ = ["StageRunnersMixin"]


class StageRunnersMixin(
    DataStagesMixin,
    PreprocessingStagesMixin,
    ModelStagesMixin,
    DiagnosisStagesMixin,
    HandoffStagesMixin,
    RecoveryStagesMixin,
):
    """六组 stage runner 的聚合入口，不添加任何自身行为。"""
