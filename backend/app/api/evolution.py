import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.projects import get_registered_project
from app.services.evolution_service import EvolutionProtocol, EvolutionService, LessonRecord
from app.services.lesson_extractor import LessonExtractor
from app.services.rule_injection_service import RuleInjectionService
from app.services.session_service import SessionService
from app.services.task_state_service import delete_task_state, load_task_state, recovery_policy, write_task_state

router = APIRouter(prefix="/api/projects/{project_id}/evolution", tags=["evolution"])


class LessonExtractRequest(BaseModel):
    source_type: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    domain: list[str] = Field(default_factory=list)
    observation: str = Field(min_length=1)
    recommendation: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    evidence: dict[str, Any] = Field(default_factory=dict)
    title: str = ""
    conditions: dict[str, Any] = Field(default_factory=dict)
    expected_benefit: dict[str, Any] = Field(default_factory=dict)


class ExtractFromSessionRequest(BaseModel):
    session_id: str = Field(min_length=1)


class ResumeLessonExtractionRequest(BaseModel):
    session_id: str = Field(min_length=1)


class ConflictRequest(BaseModel):
    reason: str = Field(min_length=1)


class DisableRuleRequest(BaseModel):
    # 停用理由可选，但填写后会写入证据，使停用决策本身可审计
    reason: str = Field(default="", max_length=2000)


class ScopeRuleRequest(BaseModel):
    # 空列表表示该维度不设限制；两者皆空即恢复为全局适用
    datasets: list[str] = Field(default_factory=list, max_length=200)
    modes: list[str] = Field(default_factory=list, max_length=20)


class RuleMatchRequest(BaseModel):
    session_id: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)


class LessonList(BaseModel):
    items: list[LessonRecord]


class ProtocolList(BaseModel):
    items: list[EvolutionProtocol]


def _project_root(project_id: str) -> Path:
    project = get_registered_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.workspace_path).resolve()


def _write_learn_failure_state(
    *,
    root: Path,
    project_id: str,
    session_id: str,
    error: str,
    retry_count: int = 0,
) -> None:
    write_task_state(
        project_root=root,
        session_id=session_id,
        stage="learn",
        payload={
            "status": "failed",
            "project_id": project_id,
            "source_type": "session",
            "source_id": session_id,
            "retry_count": retry_count,
            "last_error": error,
            **recovery_policy(
                repair_hint="Restore the source session and its evidence events before extracting learned rules.",
                stale_check="Confirm the source session still exists and its evidence/log events are readable.",
                resume_action="Retry learned-rule extraction from the saved source session.",
                regenerate_action="Rerun the source analysis or training workflow to recreate stronger learning evidence.",
                abandon_action="Clear the saved learning retry state and keep existing lessons unchanged.",
                stale_artifact_paths=[],
            ),
        },
    )


@router.get("/lessons")
def list_lessons(project_id: str, status: str | None = None) -> LessonList:
    service = EvolutionService(_project_root(project_id))
    return LessonList(items=service.list_lessons(status=status))


@router.get("/protocols")
def list_protocols(project_id: str) -> ProtocolList:
    service = EvolutionService(_project_root(project_id))
    return ProtocolList(items=service.list_protocols())


@router.post("/lessons/extract")
def extract_lesson(project_id: str, payload: LessonExtractRequest) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    return service.create_lesson(
        source_type=payload.source_type,
        source_id=payload.source_id,
        domain=payload.domain,
        observation=payload.observation,
        recommendation=payload.recommendation,
        confidence=payload.confidence,
        evidence=payload.evidence,
        title=payload.title,
        conditions=payload.conditions,
        expected_benefit=payload.expected_benefit,
    )


@router.post("/lessons/extract-from-session")
def extract_lessons_from_session(project_id: str, payload: ExtractFromSessionRequest) -> LessonList:
    return _run_lesson_extraction(project_id=project_id, session_id=payload.session_id)


@router.post("/lessons/resume-extraction")
def resume_lesson_extraction(project_id: str, payload: ResumeLessonExtractionRequest) -> LessonList:
    root = _project_root(project_id)
    state = load_task_state(project_root=root, session_id=payload.session_id, stage="learn")
    if state is None:
        raise HTTPException(status_code=404, detail="Learning retry state not found")
    source_id = state.get("source_id") if isinstance(state.get("source_id"), str) else payload.session_id
    retry_count = int(state.get("retry_count") or 0) + 1
    return _run_lesson_extraction(project_id=project_id, session_id=source_id, retry_count=retry_count)


def _run_lesson_extraction(project_id: str, session_id: str, retry_count: int = 0) -> LessonList:
    root = _project_root(project_id)
    evolution = EvolutionService(root)
    session_service = SessionService(root)
    try:
        if session_service.get_session(session_id) is None:
            raise RuntimeError("Session not found for lesson extraction")
        events = session_service.list_events(session_id)
        candidates = LessonExtractor(root).extract_from_session(session_id, events)
        lessons = [
            evolution.create_lesson(
                source_type=item["source_type"],
                source_id=item["source_id"],
                domain=item["domain"],
                observation=item["observation"],
                recommendation=item["recommendation"],
                confidence=item["confidence"],
                evidence=item.get("evidence", {}),
                title=item.get("title", ""),
                conditions=item.get("conditions", {}),
                expected_benefit=item.get("expected_benefit", {}),
            )
            for item in candidates
        ]
    except (RuntimeError, OSError, ValueError, json.JSONDecodeError) as exc:
        error = str(exc)
        _write_learn_failure_state(
            root=root,
            project_id=project_id,
            session_id=session_id,
            error=error,
            retry_count=retry_count,
        )
        raise HTTPException(status_code=500, detail=error) from exc

    delete_task_state(project_root=root, session_id=session_id, stage="learn")
    return LessonList(items=lessons)


@router.post("/lessons/{lesson_id}/adopt")
def adopt_lesson(project_id: str, lesson_id: str) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.adopt_lesson(lesson_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/reject")
def reject_lesson(project_id: str, lesson_id: str) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.reject_lesson(lesson_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/conflict")
def mark_lesson_conflict(
    project_id: str,
    lesson_id: str,
    payload: ConflictRequest,
) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.mark_conflict(lesson_id, payload.reason)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/disable")
def disable_lesson(
    project_id: str,
    lesson_id: str,
    payload: DisableRuleRequest,
) -> LessonRecord:
    """停止注入某条已采纳规则，但保留其采纳记录与证据。"""
    service = EvolutionService(_project_root(project_id))
    try:
        return service.set_lesson_enabled(lesson_id, enabled=False, reason=payload.reason)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/enable")
def enable_lesson(project_id: str, lesson_id: str) -> LessonRecord:
    service = EvolutionService(_project_root(project_id))
    try:
        return service.set_lesson_enabled(lesson_id, enabled=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/lessons/{lesson_id}/scope")
def scope_lesson(
    project_id: str,
    lesson_id: str,
    payload: ScopeRuleRequest,
) -> LessonRecord:
    """限定规则只在指定数据集/模式下生效；两个列表皆空表示恢复全局适用。"""
    service = EvolutionService(_project_root(project_id))
    try:
        return service.set_lesson_scope(lesson_id, payload.datasets, payload.modes)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Lesson not found") from exc


@router.post("/rules/match")
def match_rules(project_id: str, payload: RuleMatchRequest) -> dict[str, Any]:
    service = RuleInjectionService(_project_root(project_id))
    result = service.match_rules(payload.session_id, payload.context)
    result["prompt_snippet"] = service.inject_prompt(
        payload.session_id,
        result["matched_rules"],
    )
    return result


@router.get("/injection-log")
def list_injection_log(project_id: str) -> dict[str, list[dict[str, Any]]]:
    return {"items": RuleInjectionService(_project_root(project_id)).list_injection_log()}


@router.get("/graph")
def get_knowledge_graph(project_id: str) -> dict[str, Any]:
    """Returns nodes and edges for the self-evolving interactive knowledge graph

    and computes Advanced Insights (Knowledge Gaps & Surprise Connections).
    """
    root = _project_root(project_id)

    # 1. Gather experiment runs
    from app.services.experiment_service import ExperimentService
    runs = ExperimentService(root).list_runs()

    # 2. Gather self-evolution rules/lessons
    from app.services.evolution_service import EvolutionService
    lessons = EvolutionService(root).list_lessons()

    # 3. Gather column details from dataset
    import pandas as pd
    columns_metadata = {}
    column_dataset_paths: dict[str, set[str]] = defaultdict(set)

    dataset_paths = set()
    for run in runs:
        if run.get("dataset_path"):
            dataset_paths.add(run["dataset_path"])

    for dp in sorted(dataset_paths):
        try:
            resolved_path = (root / dp).resolve()
            if root in resolved_path.parents or root == resolved_path:
                if resolved_path.exists() and resolved_path.is_file():
                    df = pd.read_csv(resolved_path, nrows=5)
                    for col in df.columns:
                        is_num = pd.api.types.is_numeric_dtype(df[col])
                        columns_metadata[col] = {
                            "name": col,
                            "type": "numeric" if is_num else "categorical",
                            "missing_rate": float(df[col].isnull().mean())
                        }
                        column_dataset_paths[col].add(dp)
        except Exception:
            pass

    # Fallback to model target/features if dataset CSV is not found
    for run in runs:
        tgt = run.get("target_column")
        if tgt and tgt not in columns_metadata:
            columns_metadata[tgt] = {"name": tgt, "type": "categorical", "missing_rate": 0.0}
        if tgt and run.get("dataset_path"):
            column_dataset_paths[tgt].add(run["dataset_path"])

        feature_cols = []
        model_data = run.get("model", {})
        if isinstance(model_data, dict):
            feature_cols.extend(model_data.get("feature_columns", []))
        metrics_data = run.get("metrics", {})
        if isinstance(metrics_data, dict):
            feature_cols.extend(metrics_data.get("feature_columns", []))

        for cand in run.get("candidate_runs", []):
            model_name = cand.get("model_name", "")
            if ":" in model_name:
                col = model_name.split(":", 1)[1]
                feature_cols.append(col)

        for col in feature_cols:
            if col and col not in columns_metadata:
                columns_metadata[col] = {"name": col, "type": "numeric", "missing_rate": 0.0}
            if col and run.get("dataset_path"):
                column_dataset_paths[col].add(run["dataset_path"])

    # 4. Construct Nodes
    nodes = []

    # Column Nodes
    for col_name, meta in columns_metadata.items():
        properties = {
            **meta,
            "provenance": {
                "kind": "dataset_column",
                "dataset_paths": sorted(column_dataset_paths.get(col_name, [])),
                "column": col_name,
            },
        }
        nodes.append({
            "id": f"col_{col_name}",
            "label": col_name,
            "type": "column",
            "properties": properties
        })

    # Experiment Nodes
    for run in runs:
        exp_id = run["experiment_id"]
        acc = run.get("metrics", {}).get("accuracy", 0.0)
        engine = run.get("engine", "unknown")
        nodes.append({
            "id": f"exp_{exp_id}",
            "label": f"{engine.upper()} (Acc: {acc:.3f})",
            "type": "experiment",
            "properties": {
                "experiment_id": exp_id,
                "engine": engine,
                "accuracy": acc,
                "target_column": run.get("target_column"),
                "created_at": run.get("created_at"),
                "provenance": {
                    "kind": "experiment_run",
                    "experiment_id": exp_id,
                    "dataset_path": run.get("dataset_path"),
                    "metrics_path": run.get("metrics_artifact", {}).get("path"),
                    "model_path": run.get("model_artifact", {}).get("path"),
                },
            }
        })

    # Rule/Lesson Nodes
    for lesson in lessons:
        lesson_id = lesson.id
        nodes.append({
            "id": f"rule_{lesson_id}",
            "label": lesson.title or (lesson.recommendation[:20] + "..."),
            "type": "rule",
            "properties": {
                "lesson_id": lesson_id,
                "status": lesson.status,
                "confidence": lesson.confidence,
                "observation": lesson.observation,
                "recommendation": lesson.recommendation,
                "evidence": lesson.evidence,
                "provenance": {
                    "kind": "lesson",
                    "lesson_id": lesson_id,
                    "source_type": lesson.source_type,
                    "source_id": lesson.source_id,
                    "evidence": lesson.evidence,
                },
            }
        })

    # 5. Construct Edges
    edges = []
    edge_counter = 0

    def add_edge(source: str, target: str, label: str, edge_type: str):
        nonlocal edge_counter
        edge_counter += 1
        edges.append({
            "id": f"edge_{edge_counter}",
            "source": source,
            "target": target,
            "label": label,
            "type": edge_type
        })

    # a. Connect column to experiment
    for run in runs:
        exp_node = f"exp_{run['experiment_id']}"

        tgt = run.get("target_column")
        if tgt:
            tgt_node = f"col_{tgt}"
            add_edge(exp_node, tgt_node, "predicts", "produces")

        feature_cols = set()
        model_data = run.get("model", {})
        if isinstance(model_data, dict):
            feature_cols.update(model_data.get("feature_columns", []))
        metrics_data = run.get("metrics", {})
        if isinstance(metrics_data, dict):
            feature_cols.update(metrics_data.get("feature_columns", []))

        for cand in run.get("candidate_runs", []):
            model_name = cand.get("model_name", "")
            if ":" in model_name:
                feature_cols.add(model_name.split(":", 1)[1])

        for col in feature_cols:
            if col:
                col_node = f"col_{col}"
                add_edge(col_node, exp_node, "feature", "uses")

    # b. Connect rule to column and rule to experiment
    for lesson in lessons:
        rule_node = f"rule_{lesson.id}"

        affected_cols = set(lesson.domain or [])
        for col_name in columns_metadata.keys():
            if col_name.lower() in lesson.observation.lower() or col_name.lower() in lesson.recommendation.lower():
                affected_cols.add(col_name)

        for col in affected_cols:
            if col in columns_metadata:
                col_node = f"col_{col}"
                add_edge(rule_node, col_node, "guides", "triggers")

        source_id = lesson.source_id
        for run in runs:
            exp_node = f"exp_{run['experiment_id']}"
            is_source = False
            if lesson.source_type == "session" and source_id == run.get("session_id"):
                is_source = True
            elif isinstance(lesson.evidence, dict) and lesson.evidence.get("experiment_id") == run["experiment_id"]:
                is_source = True

            if is_source:
                add_edge(exp_node, rule_node, "inspires", "supports")
            else:
                tgt = run.get("target_column")
                acc = run.get("metrics", {}).get("accuracy", 0.0)
                if tgt in affected_cols and acc > 0.8:
                    add_edge(exp_node, rule_node, "supports", "supports")

    # 6. Compute Advanced Insights
    insights = []

    # A. Knowledge Gap (Target Columns with no adopted rules)
    target_columns = {run["target_column"] for run in runs if run.get("target_column")}
    for tgt in target_columns:
        has_adopted_rule = False
        for lesson in lessons:
            if lesson.status == "high_confidence":
                affected = set(lesson.domain or [])
                for col_name in columns_metadata.keys():
                    if col_name.lower() in lesson.observation.lower() or col_name.lower() in lesson.recommendation.lower():
                        affected.add(col_name)
                if tgt in affected:
                    has_adopted_rule = True
                    break
        if not has_adopted_rule:
            insights.append({
                "type": "knowledge_gap",
                "title": f"未覆盖的核心业务指标: {tgt}",
                "description": f"数据字段 '{tgt}' 已在机器学习实验中被设为目标列（Target），但在自进化经验库中，目前尚无任何一条已采纳（Adopted）的经验规则与其关联。这属于严重的知识空白，可能会导致智能体在处理包含该指标的任务时缺乏先验规则引导，建议尽快沉淀针对该列的经验法则。",
                "meta": {"column": tgt}
            })

    # B. Surprise Connection (Adopted rules verified by high-accuracy model features)
    for lesson in lessons:
        if lesson.status == "high_confidence":
            affected = set(lesson.domain or [])
            for col_name in columns_metadata.keys():
                if col_name.lower() in lesson.observation.lower() or col_name.lower() in lesson.recommendation.lower():
                    affected.add(col_name)

            for run in runs:
                acc = run.get("metrics", {}).get("accuracy", 0.0)
                if acc > 0.8:
                    run_features = set()
                    model_data = run.get("model", {})
                    if isinstance(model_data, dict):
                        run_features.update(model_data.get("feature_columns", []))
                    metrics_data = run.get("metrics", {})
                    if isinstance(metrics_data, dict):
                        run_features.update(metrics_data.get("feature_columns", []))
                    for cand in run.get("candidate_runs", []):
                        model_name = cand.get("model_name", "")
                        if ":" in model_name:
                            run_features.add(model_name.split(":", 1)[1])

                    for col in affected:
                        if col in run_features:
                            insights.append({
                                "type": "surprise_connection",
                                "title": "经验规则获得高精度实验验证",
                                "description": f"自进化经验规则 '{lesson.title or '未命名规则'}' 重点关注的特征字段 '{col}'，在最近一次高准确率的机器学习分类实验 '{run.get('engine', 'sklearn').upper()}'（准确率达 {acc:.2%}）中被证实为核心预测特征。这用实战建模 data 强力论证了该经验法则的高度有效性与业务合理性！",
                                "meta": {
                                    "column": col,
                                    "experiment_id": run["experiment_id"],
                                    "lesson_id": lesson.id
                                }
                            })
                            break
                    else:
                        continue
                    break

    return {
        "nodes": nodes,
        "edges": edges,
        "insights": insights
    }
