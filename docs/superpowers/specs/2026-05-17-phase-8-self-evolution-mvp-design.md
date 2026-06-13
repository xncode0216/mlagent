# Phase 8 自进化知识 MVP 设计

## 1. 目标

Phase 8 的目标是把 MLAgent 从“能执行数据分析和机器学习任务”推进到“能从历史任务中沉淀可复用经验，并在后续任务中有控制地使用经验”。

本阶段采用“候选经验 -> 人工审核 -> 高置信规则 -> 命中注入”的保守路线。系统先从数据分析、模型训练、工具调用、错误日志中抽取候选经验，用户审核后才进入高置信规则区。后续 Agent 任务开始前，系统根据当前上下文匹配规则，并把少量高相关经验注入 Agent 提示词和执行计划。

## 2. 非目标

本阶段不做完整知识图谱、不做全自动无审核规则采纳、不做跨企业多租户权限细分，也不做复杂 LLM 反思闭环。知识图谱、知识空白检测和惊奇连接检测留到 Phase 10。

本阶段也不把经验库做成远程数据库优先。项目当前工作方式接近 IDE，本阶段继续使用每个项目本地 `evolution/` 文件夹作为经验存储位置，便于版本化、迁移和调试。

## 3. 核心用户流程

1. 用户完成一次数据分析或机器学习训练任务。
2. 系统从任务产物、日志事件、训练结果和错误信息中抽取候选经验。
3. 候选经验进入“待审核”列表。
4. 用户查看经验证据、适用条件、预期收益和风险，选择采纳、拒绝或标记冲突。
5. 被采纳经验进入高置信规则区。
6. 用户开始新任务时，系统根据任务上下文匹配高置信规则。
7. Agent 在执行前展示“本次命中的历史经验”，并把规则摘要注入到执行上下文。
8. 注入行为写入 `evolution/injection-log.jsonl`，方便审计。

## 4. 存储结构

项目本地新增以下文件结构：

```text
evolution/
├── lessons/
│   ├── pending/
│   │   └── lesson_<id>.json
│   ├── high-confidence/
│   │   └── lesson_<id>.json
│   └── rejected/
│       └── lesson_<id>.json
├── rules/
│   └── index.json
├── conflicts/
│   └── conflict_<id>.json
└── injection-log.jsonl
```

`lessons/*` 保存完整经验记录，`rules/index.json` 保存可快速匹配的高置信规则索引，`injection-log.jsonl` 保存每次任务注入了哪些规则、为什么命中、注入给哪个 session。

## 5. Lesson 数据模型

候选经验使用统一 JSON 结构：

```json
{
  "id": "lesson_20260517_001",
  "status": "pending_review",
  "source": {
    "type": "analysis_session",
    "session_id": "session-events",
    "trace_id": "abc123",
    "artifact_paths": ["results/session-events/missing.json"]
  },
  "domain": ["data-analysis", "missing-value"],
  "title": "数值列低缺失率可优先使用中位数填充",
  "observation": "数据集中 total_charges 缺失率为 0.22%，且列类型为数值型。",
  "recommendation": "在类似数值列缺失率低于 5% 时，优先尝试中位数填充，并记录填充指示列。",
  "conditions": {
    "task_modes": ["analysis", "machine-learning"],
    "feature_type": "numeric",
    "missing_ratio_range": [0, 0.05],
    "sample_size_min": 100
  },
  "expected_benefit": {
    "metric": "data_quality",
    "description": "减少删除样本带来的信息损失，并保留缺失模式信号。"
  },
  "confidence": 0.72,
  "evidence": {
    "validation_count": 1,
    "contradiction_count": 0,
    "last_validated_at": "2026-05-17T00:00:00Z"
  },
  "created_at": "2026-05-17T00:00:00Z",
  "updated_at": "2026-05-17T00:00:00Z"
}
```

状态枚举：

- `pending_review`：候选经验，等待用户审核。
- `high_confidence`：已采纳，可参与规则匹配和注入。
- `rejected`：用户拒绝，不参与注入。
- `conflicted`：存在反例或与其他规则冲突，暂不注入。

## 6. 后端模块设计

### LessonExtractor

`LessonExtractor` 从已有事件和产物中生成候选经验。第一版使用规则模板，不依赖 LLM 自动总结，确保可解释和可测试。

输入：

- `session_id`
- session events
- artifacts：`missing.json`、`profile.json`、`correlation.json`、training metrics
- error events 和 kernel stderr

输出：

- 0 到多条 `LessonRecord`

第一批抽取模板：

- 缺失值模板：数值列/类别列按缺失率生成填充建议。
- 目标泄漏模板：特征与目标高度相关或字段名疑似泄漏时生成剔除建议。
- 类别特征模板：类别列较多且训练算法支持类别处理时生成编码建议。
- 模型比较模板：某个模型在验证集明显优于基线时生成模型选择建议。
- 错误排障模板：Kernel 或训练失败时生成可复用排障经验。

### LessonStore

`LessonStore` 负责读写 `evolution/` 下的 lesson 文件、状态迁移和规则索引更新。

核心接口：

- `extract_candidates(project_id, session_id) -> list[LessonRecord]`
- `list_lessons(project_id, status=None) -> list[LessonRecord]`
- `adopt_lesson(project_id, lesson_id) -> LessonRecord`
- `reject_lesson(project_id, lesson_id) -> LessonRecord`
- `mark_conflict(project_id, lesson_id, reason) -> LessonRecord`

状态迁移规则：

- `pending_review -> high_confidence`
- `pending_review -> rejected`
- `high_confidence -> conflicted`
- `conflicted -> high_confidence` 需要用户再次确认

### RuleMatcher

`RuleMatcher` 在新任务开始前匹配高置信规则。

输入上下文：

- `mode`：analysis、machine-learning、evolution
- `active_file`
- 数据 profile 摘要
- 目标列、任务类型、模型候选、是否使用 GPU
- 历史错误或用户明确目标

输出：

```json
{
  "matched_rules": [
    {
      "lesson_id": "lesson_20260517_001",
      "score": 0.86,
      "reason": "当前数据存在低比例数值缺失，匹配 missing_ratio_range 与 feature_type 条件。"
    }
  ]
}
```

匹配规则第一版采用确定性打分：

- 任务模式匹配：+0.25
- 数据类型匹配：+0.2
- 条件范围匹配：+0.25
- 标签匹配：+0.2
- 最近验证或高 confidence：+0.1

低于 `0.65` 不注入。单次任务最多注入 5 条规则。

### PromptInjector

`PromptInjector` 将匹配结果转换为短提示片段。注入内容必须包含规则 ID 和适用原因，避免不可追踪的隐式影响。

注入格式：

```text
历史经验命中：
- [lesson_20260517_001] 当前数据存在低比例数值缺失。优先尝试中位数填充，并记录填充指示列。原因：匹配 numeric + missing_ratio 0-5%。
```

注入要求：

- 只注入 `high_confidence` 且未冲突规则。
- 每条不超过 120 个中文字符。
- 保留 `lesson_id`。
- 写入 `evolution/injection-log.jsonl`。

## 7. API 设计

新增或完善以下 API：

```http
POST /api/projects/{project_id}/evolution/lessons/extract-from-session
GET  /api/projects/{project_id}/evolution/lessons?status=pending_review
POST /api/projects/{project_id}/evolution/lessons/{lesson_id}/adopt
POST /api/projects/{project_id}/evolution/lessons/{lesson_id}/reject
POST /api/projects/{project_id}/evolution/lessons/{lesson_id}/conflict
POST /api/projects/{project_id}/evolution/rules/match
GET  /api/projects/{project_id}/evolution/injection-log
```

已有 lesson API 可复用时优先复用，不重复造接口。新增 `extract-from-session` 用于从真实 session 事件和 artifacts 生成候选经验。

## 8. 前端设计

自进化知识页保留 IDE 三栏风格：

左侧仍是项目文件树和 `evolution/` 文件区域。中间主区域展示经验审核工作台，右侧继续使用图谱、代码、数据、训练、日志面板。

自进化知识主区域分为四个区块：

1. 指标条：高置信、待审核、冲突、已注入次数。
2. 候选经验列表：卡片展示标题、置信度、来源、标签、状态。
3. 经验详情：展示 observation、recommendation、conditions、evidence、source。
4. 审核操作：采纳、拒绝、标记冲突、查看来源日志。

新任务开始前，在 Agent 对话区显示“命中的历史经验”小面板，用户可以展开查看规则 ID、命中原因和注入摘要。

## 9. Agent 集成点

数据分析任务结束后：

1. WebSocket 发出 `task_progress` 完成事件。
2. 后端调用 `LessonExtractor.extract_from_session`。
3. 如果产生候选经验，发出 `lesson_extracted` 事件。
4. 前端自进化知识页和日志页展示候选经验。

新任务开始前：

1. 后端读取 active file 的轻量 profile。
2. `RuleMatcher` 匹配高置信规则。
3. `PromptInjector` 生成注入片段。
4. WebSocket 发出 `rules_matched` 事件。
5. Agent 执行时使用注入片段。
6. 写入 `injection-log.jsonl`。

## 10. 错误处理与防污染

经验库污染是本阶段最大风险，必须保守处理：

- 候选经验默认不注入。
- 只有用户采纳后的 `high_confidence` 才能注入。
- 规则有冲突时立即停止注入。
- 匹配分数低于阈值不注入。
- 注入规则必须记录到 `injection-log.jsonl`。
- 经验抽取失败不能影响主任务完成，只写日志和错误事件。

## 11. 验收标准

本阶段完成后必须满足：

- 数据分析或训练任务完成后，系统能生成至少 1 条候选经验。
- 用户能在自进化知识页采纳、拒绝、标记冲突。
- 被采纳经验移动到高置信规则区，并更新 `rules/index.json`。
- 新任务开始前能匹配高置信规则，并在 UI 显示命中结果。
- Agent 注入内容可在 `evolution/injection-log.jsonl` 中审计。
- 后端测试覆盖抽取、状态迁移、规则匹配、注入日志。
- 前端构建、lint 和后端完整测试通过。

## 12. 推荐开发顺序

1. 实现 `LessonStore` 文件存储和状态迁移测试。
2. 实现 `LessonExtractor` 的缺失值和错误排障两个模板。
3. 新增 `extract-from-session` API，并在 WebSocket 任务完成后触发候选经验事件。
4. 完善自进化知识页候选列表和详情审核操作。
5. 实现 `RuleMatcher` 和 `PromptInjector`。
6. 在新任务开始前展示并注入命中规则。
7. 增加 `injection-log.jsonl` API 和 UI 查看入口。
8. 增加冲突标记与防注入策略。

## 13. 测试策略

后端：

- `LessonStore`：文件创建、列表、采纳、拒绝、冲突迁移。
- `LessonExtractor`：给定 missing/profile/training artifact 生成确定候选经验。
- `RuleMatcher`：给定上下文和规则索引返回稳定排序。
- `PromptInjector`：最多注入 5 条，带 lesson ID，写入 injection log。
- WebSocket：任务完成后能产生 `lesson_extracted` 事件。

前端：

- 自进化知识页能渲染 pending/high-confidence/rejected/conflicted 状态。
- 审核按钮调用正确 API 并更新列表。
- Agent 开始任务前能展示命中规则。
- `npm run lint` 和 `npm run build` 必须通过。

## 14. 后续扩展

Phase 9 可以让 GPU 调度和高级训练结果也进入经验抽取链路，例如“某类任务使用 GPU/LightGBM 收益明显”。Phase 10 再把 lesson、artifact、feature、experiment、trace 连接成知识图谱，做知识空白和冲突关系可视化。
