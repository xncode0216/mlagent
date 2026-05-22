# Phase 8 Self-Evolution MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 8 self-evolution vertical slice: extract candidate lessons from completed sessions, review them, promote high-confidence rules, match rules before new tasks, and audit prompt injection.

**Architecture:** Extend the existing `EvolutionService` instead of replacing it. Keep project-local storage under `evolution/`, expose small FastAPI endpoints, stream matched/extracted rule events through the existing WebSocket, and render the workflow in the current IDE-style Evolution workspace.

**Tech Stack:** FastAPI, Pydantic, dataclasses, JSON/JSONL project files, pytest, React, TypeScript, Vite, ESLint.

---

## Current Status Snapshot（2026-05-22）

Phase 8 的主要闭环已经落地，并且向 Phase 9/10 做了提前延展：

- [x] 候选经验模型、状态迁移、规则索引和注入日志已接入后端。
- [x] `extract-from-session`、手动 `extract`、采纳/拒绝/冲突、规则匹配、协议列表、注入日志 API 已接入。
- [x] WebSocket 与前端工作台可以展示会话、事件、产物、命中规则和自进化审核区。
- [x] 自进化前端支持状态筛选、详情审核、规则协议展示、图谱/高级洞察 tab。
- [x] 知识图谱 API 与前端图谱视图已具备第一版：数据列、实验、经验规则、知识空白、惊奇连接。
- [x] 图谱视图新增加载失败反馈、空态引导、规则节点跳转经验详情、键盘访问和类型防护。
- [x] GPU 调度基础服务、状态 API 与测试已进入代码库，供 Phase 9 继续扩展。
- [x] 验证：后端 `73 passed, 3 skipped`；前端 test/lint/typecheck/build 均通过；Edge headless 页面烟测通过。

剩余重点：

- [ ] 扩展 `LessonExtractor` 模板，让更多分析/训练结果能稳定产出候选经验。
- [ ] 为图谱节点补齐“定位到文件、实验详情、日志片段”的深链接。
- [ ] 把 GPU 队列状态完整反馈到训练 UI，支持取消、超时释放和真实 worker 资源绑定。
- [ ] 强化 Docker/Jupyter Kernel 真实沙箱、资源限制和异常恢复。
- [ ] 增加自进化规则批量审核、规则合并和冲突裁决工作流。

---

## File Structure

Backend files:

- Modify `backend/app/services/evolution_service.py`: lesson data model, status-aware storage, rule index, conflict support.
- Create `backend/app/services/lesson_extractor.py`: deterministic missing-value and error lesson extraction from session events/artifacts.
- Create `backend/app/services/rule_injection_service.py`: rule matching, prompt snippet creation, injection log writing.
- Modify `backend/app/api/evolution.py`: status query, conflict endpoint, extract-from-session endpoint, rule match endpoint, injection log endpoint.
- Modify `backend/app/api/ws.py`: emit `rules_matched` before work and `lesson_extracted` after completion.
- Modify `backend/tests/test_evolution_api.py`: API coverage.
- Create `backend/tests/test_evolution_service.py`: storage and state transition coverage.
- Create `backend/tests/test_lesson_extractor.py`: deterministic extraction coverage.
- Create `backend/tests/test_rule_injection_service.py`: matching and injection log coverage.

Frontend files:

- Modify `frontend/src/lib/api.ts`: extend lesson types and add new evolution API helpers.
- Modify `frontend/src/features/chat/types.ts`: add `rules_matched` event.
- Modify `frontend/src/features/chat/AgentWorkspace.tsx`: display matched historical rules before Agent execution.
- Modify `frontend/src/features/evolution/EvolutionWorkspace.tsx`: richer review queue, status filters, details, conflict action.
- Modify `frontend/src/app/AppShell.tsx`: wire new API actions and refresh behavior.
- Modify `frontend/src/styles.css`: compact styles for rule match cards and lesson details.

## Task 1: Upgrade EvolutionService Storage and Lesson Model

**Files:**
- Modify: `backend/app/services/evolution_service.py`
- Create: `backend/tests/test_evolution_service.py`

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/test_evolution_service.py`:

```python
from pathlib import Path

from app.services.evolution_service import EvolutionService


def test_lesson_status_directories_and_rule_index(tmp_path: Path):
    service = EvolutionService(tmp_path)
    lesson = service.create_lesson(
        source_type="analysis_session",
        source_id="session-1",
        domain=["data-analysis", "missing-value"],
        observation="age has 2% missing values",
        recommendation="Use median imputation with a missing indicator",
        confidence=0.74,
        evidence={"column": "age"},
        title="Median imputation for low missing numeric columns",
        conditions={"feature_type": "numeric", "missing_ratio_range": [0, 0.05]},
        expected_benefit={"metric": "data_quality", "description": "Keep rows while preserving signal"},
    )

    pending_path = tmp_path / "evolution" / "lessons" / "pending" / f"{lesson.id}.json"
    assert pending_path.exists()

    adopted = service.adopt_lesson(lesson.id)
    assert adopted.status == "high_confidence"
    assert not pending_path.exists()
    assert (tmp_path / "evolution" / "lessons" / "high-confidence" / f"{lesson.id}.json").exists()
    assert (tmp_path / "evolution" / "rules" / "index.json").exists()


def test_reject_and_mark_conflict(tmp_path: Path):
    service = EvolutionService(tmp_path)
    lesson = service.create_lesson(
        source_type="training",
        source_id="exp-1",
        domain=["machine-learning"],
        observation="LightGBM beat the baseline",
        recommendation="Try LightGBM before neural models",
        confidence=0.81,
    )

    rejected = service.reject_lesson(lesson.id)
    assert rejected.status == "rejected"
    assert (tmp_path / "evolution" / "lessons" / "rejected" / f"{lesson.id}.json").exists()

    conflict_source = service.create_lesson(
        source_type="analysis",
        source_id="session-2",
        domain=["data-analysis"],
        observation="Target leakage was detected",
        recommendation="Remove leakage columns before training",
        confidence=0.91,
    )
    conflicted = service.mark_conflict(conflict_source.id, "Contradicts current approved preprocessing rule")
    assert conflicted.status == "conflicted"
    assert conflicted.evidence["conflict_reason"] == "Contradicts current approved preprocessing rule"
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_evolution_service.py -v
```

Expected: tests fail because `title`, `conditions`, `expected_benefit`, status directories, rule index, and `mark_conflict` are not implemented.

- [ ] **Step 3: Implement the upgraded service**

Modify `backend/app/services/evolution_service.py`:

```python
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
    title: str = ""
    conditions: dict[str, Any] | None = None
    expected_benefit: dict[str, Any] | None = None
```

Add status directories:

```python
LESSON_STATUS_DIRS = {
    "pending_review": "pending",
    "high_confidence": "high-confidence",
    "rejected": "rejected",
    "conflicted": "conflicts",
}
```

Update `EvolutionService.__init__`:

```python
self.evolution_dir = project_root / "evolution"
self.lessons_root = self.evolution_dir / "lessons"
self.rules_dir = self.evolution_dir / "rules"
self.rule_index_path = self.rules_dir / "index.json"
```

Update `_write_lesson` to write into the status directory and remove stale copies from other status directories:

```python
def _write_lesson(self, lesson: LessonRecord) -> None:
    target_dir = self._lesson_dir_for_status(lesson.status)
    target_dir.mkdir(parents=True, exist_ok=True)
    for status in LESSON_STATUS_DIRS:
        stale_path = self._lesson_dir_for_status(status) / f"{lesson.id}.json"
        if stale_path.exists() and stale_path.parent != target_dir:
            stale_path.unlink()
    (target_dir / f"{lesson.id}.json").write_text(
        json.dumps(asdict(lesson), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
```

Add `mark_conflict`:

```python
def mark_conflict(self, lesson_id: str, reason: str) -> LessonRecord:
    lesson = self.get_lesson(lesson_id)
    lesson.status = "conflicted"
    lesson.updated_at = datetime.now(UTC).isoformat()
    lesson.evidence = {**lesson.evidence, "conflict_reason": reason}
    self._write_lesson(lesson)
    self._write_rule_index()
    return lesson
```

Update `adopt_lesson` and `reject_lesson` to call `_write_rule_index()`.

Add `_write_rule_index()`:

```python
def _write_rule_index(self) -> None:
    self.rules_dir.mkdir(parents=True, exist_ok=True)
    high_confidence = [
        asdict(lesson)
        for lesson in self.list_lessons(status="high_confidence")
    ]
    self.rule_index_path.write_text(
        json.dumps({"items": high_confidence}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_evolution_service.py -v
```

Expected: `2 passed`.

- [ ] **Step 5: Run existing evolution API tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_evolution_api.py -v
```

Expected: existing tests pass after updating expected rule path if needed.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/services/evolution_service.py backend/tests/test_evolution_service.py backend/tests/test_evolution_api.py
git commit -m "feat: add status-aware lesson storage"
```

## Task 2: Add LessonExtractor for Session-Derived Candidates

**Files:**
- Create: `backend/app/services/lesson_extractor.py`
- Modify: `backend/app/api/evolution.py`
- Modify: `backend/tests/test_evolution_api.py`
- Create: `backend/tests/test_lesson_extractor.py`

- [ ] **Step 1: Write extractor tests**

Create `backend/tests/test_lesson_extractor.py`:

```python
import json
from pathlib import Path

from app.services.lesson_extractor import LessonExtractor


def test_extracts_missing_value_lesson_from_artifact(tmp_path: Path):
    session_id = "session-1"
    artifact_path = tmp_path / "results" / session_id / "missing.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        json.dumps(
            {
                "columns": {
                    "age": {"missing_count": 3, "missing_ratio": 0.03},
                    "churn": {"missing_count": 0, "missing_ratio": 0.0},
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    events = [
        {
            "type": "artifact_created",
            "trace_id": "trace-1",
            "artifact": {"type": "dataframe", "name": "missing.json", "path": f"results/{session_id}/missing.json"},
        }
    ]
    lessons = LessonExtractor(tmp_path).extract_from_session(session_id, events)

    assert len(lessons) == 1
    assert lessons[0]["domain"] == ["data-analysis", "missing-value"]
    assert lessons[0]["conditions"]["missing_ratio_range"] == [0, 0.05]


def test_extracts_kernel_error_lesson(tmp_path: Path):
    events = [
        {
            "type": "kernel_output",
            "trace_id": "trace-2",
            "stream": "stderr",
            "text": "ModuleNotFoundError: No module named 'lightgbm'",
        }
    ]
    lessons = LessonExtractor(tmp_path).extract_from_session("session-2", events)

    assert len(lessons) == 1
    assert lessons[0]["domain"] == ["runtime", "kernel-error"]
    assert "lightgbm" in lessons[0]["recommendation"].lower()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_lesson_extractor.py -v
```

Expected: import fails because `lesson_extractor.py` does not exist.

- [ ] **Step 3: Implement LessonExtractor**

Create `backend/app/services/lesson_extractor.py`:

```python
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

    def _extract_missing_value_lessons(self, session_id: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
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

    def _extract_kernel_error_lessons(self, session_id: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        lessons = []
        for event in events:
            text = str(event.get("text", ""))
            if event.get("type") == "kernel_output" and event.get("stream") == "stderr" and "ModuleNotFoundError" in text:
                lessons.append(
                    {
                        "source_type": "kernel_error",
                        "source_id": session_id,
                        "domain": ["runtime", "kernel-error"],
                        "title": "Kernel 缺少依赖时应先检查运行镜像",
                        "observation": text[:240],
                        "recommendation": "先确认 Docker/Jupyter Kernel 镜像包含任务依赖，再重跑训练或分析任务。",
                        "confidence": 0.78,
                        "conditions": {"error_type": "ModuleNotFoundError"},
                        "expected_benefit": {"metric": "debug_time", "description": "减少重复运行失败任务的时间。"},
                        "evidence": {"trace_id": event.get("trace_id"), "stderr": text},
                    }
                )
        return lessons
```

- [ ] **Step 4: Add extract-from-session API test**

Append to `backend/tests/test_evolution_api.py`:

```python
def test_extract_lessons_from_session_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    root = tmp_path / "dev-user" / project["id"]
    artifact_path = root / "results" / "session-1" / "missing.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        '{"columns":{"age":{"missing_count":2,"missing_ratio":0.02}}}',
        encoding="utf-8",
    )
    session_dir = root / "sessions" / "session-1"
    session_dir.mkdir(parents=True)
    (root / "sessions" / "index.json").write_text(
        '{"sessions":[{"id":"session-1","project_id":"%s","mode":"analysis","title":"分析","created_at":"now","updated_at":"now","message_count":0}]}'
        % project["id"],
        encoding="utf-8",
    )
    (session_dir / "events.jsonl").write_text(
        '{"payload":{"type":"artifact_created","trace_id":"trace-1","artifact":{"name":"missing.json","path":"results/session-1/missing.json"}}}\n',
        encoding="utf-8",
    )

    response = client.post(f"/api/projects/{project['id']}/evolution/lessons/extract-from-session", json={"session_id": "session-1"})

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["status"] == "pending_review"
```

- [ ] **Step 5: Implement API endpoint**

In `backend/app/api/evolution.py`, add:

```python
class ExtractFromSessionRequest(BaseModel):
    session_id: str = Field(min_length=1)


@router.post("/lessons/extract-from-session")
def extract_lessons_from_session(project_id: str, payload: ExtractFromSessionRequest) -> LessonList:
    root = _project_root(project_id)
    evolution = EvolutionService(root)
    session_service = SessionService(root)
    events = session_service.list_events(payload.session_id)
    candidates = LessonExtractor(root).extract_from_session(payload.session_id, events)
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
    return LessonList(items=lessons)
```

Add imports:

```python
from app.services.lesson_extractor import LessonExtractor
from app.services.session_service import SessionService
```

- [ ] **Step 6: Run extractor and API tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_lesson_extractor.py tests\test_evolution_api.py -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/services/lesson_extractor.py backend/app/api/evolution.py backend/tests/test_lesson_extractor.py backend/tests/test_evolution_api.py
git commit -m "feat: extract lessons from sessions"
```

## Task 3: Add RuleMatcher and PromptInjector

**Files:**
- Create: `backend/app/services/rule_injection_service.py`
- Modify: `backend/app/api/evolution.py`
- Create: `backend/tests/test_rule_injection_service.py`
- Modify: `backend/tests/test_evolution_api.py`

- [ ] **Step 1: Write matching and injection tests**

Create `backend/tests/test_rule_injection_service.py`:

```python
from app.services.evolution_service import EvolutionService
from app.services.rule_injection_service import RuleInjectionService


def test_matches_high_confidence_rules_and_writes_injection_log(tmp_path):
    evolution = EvolutionService(tmp_path)
    lesson = evolution.create_lesson(
        source_type="analysis_session",
        source_id="session-1",
        domain=["data-analysis", "missing-value"],
        observation="age has low missing ratio",
        recommendation="Use median imputation with an indicator",
        confidence=0.82,
        conditions={"task_modes": ["analysis"], "feature_type": "numeric", "missing_ratio_range": [0, 0.05]},
    )
    evolution.adopt_lesson(lesson.id)

    service = RuleInjectionService(tmp_path)
    result = service.match_rules(
        session_id="session-2",
        context={"mode": "analysis", "feature_type": "numeric", "missing_ratio": 0.03, "tags": ["missing-value"]},
    )

    assert result["matched_rules"][0]["lesson_id"] == lesson.id
    assert result["matched_rules"][0]["score"] >= 0.65

    snippet = service.inject_prompt("session-2", result["matched_rules"])
    assert lesson.id in snippet
    assert (tmp_path / "evolution" / "injection-log.jsonl").exists()
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_rule_injection_service.py -v
```

Expected: import fails because `rule_injection_service.py` does not exist.

- [ ] **Step 3: Implement RuleInjectionService**

Create `backend/app/services/rule_injection_service.py`:

```python
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
        for lesson in self.evolution.list_lessons(status="high_confidence"):
            score = self._score_lesson(lesson.conditions or {}, lesson.domain, lesson.confidence, context)
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
        return [json.loads(line) for line in self.injection_log_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def _append_log(self, session_id: str, matched_rules: list[dict[str, Any]], snippet: str) -> None:
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
    def _score_lesson(conditions: dict[str, Any], domain: list[str], confidence: float, context: dict[str, Any]) -> float:
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
```

- [ ] **Step 4: Add API endpoints**

In `backend/app/api/evolution.py`, add:

```python
class RuleMatchRequest(BaseModel):
    session_id: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)


@router.post("/rules/match")
def match_rules(project_id: str, payload: RuleMatchRequest) -> dict[str, Any]:
    service = RuleInjectionService(_project_root(project_id))
    result = service.match_rules(payload.session_id, payload.context)
    result["prompt_snippet"] = service.inject_prompt(payload.session_id, result["matched_rules"])
    return result


@router.get("/injection-log")
def list_injection_log(project_id: str) -> dict[str, list[dict[str, Any]]]:
    return {"items": RuleInjectionService(_project_root(project_id)).list_injection_log()}
```

Add import:

```python
from app.services.rule_injection_service import RuleInjectionService
```

- [ ] **Step 5: Add API tests**

Append to `backend/tests/test_evolution_api.py`:

```python
def test_match_rules_api_writes_injection_log(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    lesson = client.post(
        f"/api/projects/{project['id']}/evolution/lessons/extract",
        json={
            "source_type": "analysis",
            "source_id": "session-1",
            "domain": ["data-analysis", "missing-value"],
            "observation": "age has low missing ratio",
            "recommendation": "Use median imputation",
            "confidence": 0.82,
            "evidence": {},
        },
    ).json()
    client.post(f"/api/projects/{project['id']}/evolution/lessons/{lesson['id']}/adopt")

    response = client.post(
        f"/api/projects/{project['id']}/evolution/rules/match",
        json={"session_id": "session-2", "context": {"mode": "analysis", "tags": ["missing-value"]}},
    )

    assert response.status_code == 200
    assert response.json()["matched_rules"]
    log_response = client.get(f"/api/projects/{project['id']}/evolution/injection-log")
    assert log_response.json()["items"]
```

- [ ] **Step 6: Run tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_rule_injection_service.py tests\test_evolution_api.py -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/services/rule_injection_service.py backend/app/api/evolution.py backend/tests/test_rule_injection_service.py backend/tests/test_evolution_api.py
git commit -m "feat: match and inject evolution rules"
```

## Task 4: Stream Rule Match and Lesson Extraction Events

**Files:**
- Modify: `backend/app/api/ws.py`
- Modify: `backend/tests/test_websocket_session.py`
- Modify: `frontend/src/features/chat/types.ts`

- [ ] **Step 1: Write WebSocket test**

Append to `backend/tests/test_websocket_session.py`:

```python
def test_session_socket_emits_rules_and_lessons(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (tmp_path / "dev-user" / project["id"] / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n,0\n37,0\n",
        encoding="utf-8",
    )

    with client.websocket_connect("/ws/sessions/evolution-session") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "content": "分析数据",
                "context": {"project_id": project["id"], "active_file": "data/customer_churn.csv", "mode": "analysis"},
            }
        )
        seen = []
        while True:
            event = websocket.receive_json()
            seen.append(event["type"])
            if event["type"] == "task_progress":
                break

    assert "rules_matched" in seen
    assert "lesson_extracted" in seen
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_websocket_session.py::test_session_socket_emits_rules_and_lessons -v
```

Expected: fails because WebSocket does not emit these events yet.

- [ ] **Step 3: Implement WebSocket integration**

In `backend/app/api/ws.py`, import:

```python
from app.services.evolution_service import EvolutionService
from app.services.lesson_extractor import LessonExtractor
from app.services.rule_injection_service import RuleInjectionService
```

Before tool execution, after session is ensured:

```python
rule_service = RuleInjectionService(project_root)
match_result = rule_service.match_rules(
    session_id=session_id,
    context={"mode": str(context.get("mode") or "analysis"), "tags": ["missing-value"]},
)
prompt_snippet = rule_service.inject_prompt(session_id, match_result["matched_rules"])
rules_event = {
    "type": "rules_matched",
    "trace_id": trace_id,
    "matched_rules": match_result["matched_rules"],
    "prompt_snippet": prompt_snippet,
}
session_service.append_event(session_id=session_id, event_type="rules_matched", payload=rules_event)
await websocket.send_json(rules_event)
```

After artifact events and before final progress:

```python
lesson_candidates = LessonExtractor(project_root).extract_from_session(session_id, session_service.list_events(session_id))
evolution = EvolutionService(project_root)
for item in lesson_candidates:
    lesson = evolution.create_lesson(
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
    lesson_event = {"type": "lesson_extracted", "trace_id": trace_id, "lesson_id": lesson.id, "confidence": lesson.confidence}
    session_service.append_event(session_id=session_id, event_type="lesson_extracted", payload=lesson_event)
    await websocket.send_json(lesson_event)
```

- [ ] **Step 4: Update frontend event type**

Modify `frontend/src/features/chat/types.ts`:

```ts
| ({
    type: "rules_matched";
    matched_rules: Array<{ lesson_id: string; score: number; recommendation: string; reason: string }>;
    prompt_snippet: string;
  } & TraceFields)
```

- [ ] **Step 5: Run WebSocket tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests\test_websocket_session.py tests\test_sessions_api.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add backend/app/api/ws.py backend/tests/test_websocket_session.py frontend/src/features/chat/types.ts
git commit -m "feat: stream evolution rule events"
```

## Task 5: Upgrade Evolution Workspace UI

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/features/evolution/EvolutionWorkspace.tsx`
- Modify: `frontend/src/features/chat/AgentWorkspace.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Update API types and helpers**

Modify `frontend/src/lib/api.ts`:

```ts
export type LessonStatus = "pending_review" | "high_confidence" | "rejected" | "conflicted";

export type Lesson = {
  id: string;
  source_type: string;
  source_id: string;
  domain: string[];
  observation: string;
  recommendation: string;
  confidence: number;
  status: LessonStatus;
  evidence: Record<string, unknown>;
  title?: string;
  conditions?: Record<string, unknown>;
  expected_benefit?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function markLessonConflict(projectId: string, lessonId: string, reason: string): Promise<Lesson> {
  return request<Lesson>(`/api/projects/${projectId}/evolution/lessons/${lessonId}/conflict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}
```

- [ ] **Step 2: Wire conflict action in AppShell**

Modify `frontend/src/app/AppShell.tsx`:

```ts
async function handleMarkLessonConflict(lessonId: string, reason: string) {
  if (!project) return;
  await markLessonConflict(project.id, lessonId, reason);
  setLessons(await listLessons(project.id));
}
```

Pass `onMarkConflict={handleMarkLessonConflict}` to `EvolutionWorkspace`.

- [ ] **Step 3: Update EvolutionWorkspace props**

Modify `frontend/src/features/evolution/EvolutionWorkspace.tsx`:

```ts
type EvolutionWorkspaceProps = {
  lessons: Lesson[];
  protocols: EvolutionProtocol[];
  onAdopt: (lessonId: string) => Promise<void>;
  onReject: (lessonId: string) => Promise<void>;
  onMarkConflict: (lessonId: string, reason: string) => Promise<void>;
};
```

Add status filter state:

```ts
const [statusFilter, setStatusFilter] = useState<Lesson["status"] | "all">("all");
const [selectedLessonId, setSelectedLessonId] = useState<string | null>(lessons[0]?.id ?? null);
const visibleLessons = statusFilter === "all" ? lessons : lessons.filter((lesson) => lesson.status === statusFilter);
const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) ?? visibleLessons[0];
```

- [ ] **Step 4: Render richer review UI**

Replace the current lesson card body with cards that show:

```tsx
<article className={selectedLesson?.id === lesson.id ? "lesson-card selected" : "lesson-card"} key={lesson.id}>
  <button className="lesson-select" onClick={() => setSelectedLessonId(lesson.id)}>
    <div className="lesson-card-header">
      <span>{statusLabel[lesson.status]}</span>
      <strong>{Math.round(lesson.confidence * 100)}%</strong>
    </div>
    <h3>{lesson.title || lesson.recommendation}</h3>
    <p>{lesson.observation}</p>
  </button>
</article>
```

Add detail panel:

```tsx
{selectedLesson ? (
  <section className="lesson-detail">
    <h3>{selectedLesson.title || selectedLesson.recommendation}</h3>
    <p>{selectedLesson.recommendation}</p>
    <pre>{JSON.stringify({ conditions: selectedLesson.conditions, evidence: selectedLesson.evidence }, null, 2)}</pre>
    {selectedLesson.status === "pending_review" ? (
      <div className="lesson-actions">
        <button onClick={() => void onAdopt(selectedLesson.id)}>采纳</button>
        <button onClick={() => void onReject(selectedLesson.id)}>拒绝</button>
        <button onClick={() => void onMarkConflict(selectedLesson.id, "用户在审核时标记为冲突")}>标记冲突</button>
      </div>
    ) : null}
  </section>
) : null}
```

- [ ] **Step 5: Display matched rules in AgentWorkspace**

Modify `frontend/src/features/chat/AgentWorkspace.tsx`:

```ts
const latestRuleMatch = [...events].reverse().find((event) => event.type === "rules_matched");
```

Render before tool event chips:

```tsx
{latestRuleMatch?.type === "rules_matched" && latestRuleMatch.matched_rules.length > 0 ? (
  <div className="matched-rules-panel">
    <strong>命中的历史经验</strong>
    {latestRuleMatch.matched_rules.map((rule) => (
      <span key={rule.lesson_id}>{rule.lesson_id.slice(0, 8)} · {Math.round(rule.score * 100)}%</span>
    ))}
  </div>
) : null}
```

- [ ] **Step 6: Add CSS**

Append to `frontend/src/styles.css`:

```css
.lesson-card.selected {
  border-color: rgba(137, 180, 250, 0.55);
}

.lesson-select {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
  width: 100%;
}

.lesson-detail,
.matched-rules-panel {
  background: rgba(24, 24, 37, 0.72);
  border: 1px solid #313244;
  border-radius: 8px;
  display: grid;
  gap: 10px;
  padding: 12px;
}

.lesson-detail pre {
  background: #11111b;
  border: 1px solid #313244;
  border-radius: 6px;
  color: #cdd6f4;
  font-size: 11px;
  overflow: auto;
  padding: 8px;
}
```

- [ ] **Step 7: Run frontend checks**

Run:

```powershell
cd frontend
npm.cmd run lint
npx.cmd tsc -b --pretty false
npm.cmd run build
```

Expected: lint, typecheck, build all pass.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/lib/api.ts frontend/src/app/AppShell.tsx frontend/src/features/evolution/EvolutionWorkspace.tsx frontend/src/features/chat/AgentWorkspace.tsx frontend/src/styles.css
git commit -m "feat: upgrade evolution review workspace"
```

## Task 6: Final Verification and GitHub Sync

**Files:**
- Review all changed files from Tasks 1-5.

- [ ] **Step 1: Run full backend tests**

Run:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -v
```

Expected: all non-Docker tests pass, Docker/Jupyter tests may remain skipped when Docker is unavailable.

- [ ] **Step 2: Run frontend checks**

Run:

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```

Expected: both pass.

- [ ] **Step 3: Run text and diff checks**

Run:

```powershell
cd C:\Users\Administrator\mlagent
rg -n "姝|鐨|鏁|椤|鍚|鏂|璁|濂|杩|涓|绉|浠|鏈|鑷|闈|鍥|鏃" frontend/src backend/app backend/tests
git diff --check
```

Expected: `rg` finds no mojibake and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Push branch**

Run:

```powershell
git status --short --branch
git push origin codex/foundation-kernel-mvp
```

Expected: branch pushes successfully to GitHub and status is clean.

## Self-Review

Spec coverage:

- Candidate extraction is covered by Task 2.
- Review workflow, status migration, and conflict marking are covered by Tasks 1 and 5.
- High-confidence rule index is covered by Task 1.
- Rule matching, prompt injection, and injection log are covered by Task 3.
- Agent integration events are covered by Task 4.
- UI review workspace and matched-rule visibility are covered by Task 5.
- Verification and GitHub sync are covered by Task 6.

No placeholder markers are intentionally present. Type names used across backend and frontend are aligned around `LessonRecord`, `Lesson`, `rules_matched`, `lesson_extracted`, and `injection-log.jsonl`.
