# MLAgent 项目进度同步

更新时间：2026-07-28

## 当前阶段

项目已完成生产就绪整改 P0/P1、P2-1 至 P2-8 全部切片，以及 P3-1 至 P3-4 的自进化闭环与工程健康整改。当前进入 P3-5 超大文件拆分：第一片已把 `RightPanel.tsx` 从 2,367 行按状态与职责边界拆到 329 行，并保持首屏 bundle 不变；后续将依次处理 `stages.py`、`componentRegistry.ts` 和 `machine_learning.py`。当前分支具备真实 LLM 路由、认证与多租户、结构化可观测性、文件系统优先持久化、现代前端状态架构、自动 CI 与 Playwright golden path。

## 已完成

- 前端工作台：三栏 IDE 布局、顶部数据分析/机器学习/自进化知识切换、左侧项目与文件管理、右侧图表/代码/数据/训练/日志面板。
- LLM 能力：OpenAI/Anthropic/DeepSeek/vLLM 适配、LLM 意图路由、流式回复、分析工具调用循环和真实模型状态指示器。
- 认证与隔离：JWT/OIDC、Authorization Code + PKCE、BFF HttpOnly 会话、Redis 共享会话、组织/角色 claims、租户资源隔离和认证审计。
- 工程架构：React Query 服务端状态、Zustand UI 状态、AppShell 领域 action hooks、拆分后的后端 orchestrator、结构化日志/request-id/统一错误响应。
- 项目管理：创建项目、打开本地项目、项目文件树、上传/新建/重命名/删除/下载/预览文件。
- Agent 会话：按模式创建会话、加载历史消息、WebSocket 事件流、任务进度和产物事件。
- 数据分析：CSV profile、缺失值检测、清洗数据、生成分析报告，并把结果同步到右侧面板和项目产物。
- 数据质量画像：`/analysis/profile` 生成列级质量表、目标列候选、缺失/唯一值/质量标记，并在前端右侧数据面板渲染。
- 机器学习：baseline/sklearn 训练、训练记录、模型与指标产物、数据分析到 ML 的 handoff、`use_gpu` 参数链路。
- 自进化知识：候选经验抽取、经验状态迁移、采纳/拒绝/冲突、规则索引、命中规则注入、注入日志、协议展示。
- 知识图谱：后端 `/evolution/graph` API，前端图谱/高级洞察 tab；React Query 托管加载/刷新，支持无项目与无证据空态、首次骨架、失败重试和刷新失败保留旧图。P2-6 已用懒加载 Cytoscape + COSE 替换手写 SVG，支持 compound 语义聚类、缩放/平移/节点拖拽、邻域强调、44px 视口控制、键盘节点定位、规则/文件/实验 provenance 深链和 insight 节点定位。
- GPU 调度基础：GPU scheduler 服务、状态 API、队列结构和测试。
- 前端稳定性：自进化状态统计抽为可测试函数，修复冲突/拒绝统计反转问题，图谱属性由 `any` 收紧为 `unknown` 并做类型防护。
- 前端深链与测试：保留覆盖广泛的 `smoke:deep-links`；新增标准 Playwright golden path，以真实 FastAPI + Vite 验证数据画像、预处理执行、baseline 训练和实验详情，并接入 GitHub Actions。
- P2 视觉与动效基础：P2-1 与 P2-2 均已完成并补齐跨源关闭审计。当前 99 个调色板/语义/尺寸/层级/动效自定义属性中 94 个已引用、0 个未定义；生产 CSS/TS/TSX 中除 `tokens.css` 外无裸色、数值 RGB、渐变或 React `<style>`，且无 `transition: all`。普通过渡只使用 token 化 opacity/transform，图谱持续装饰动画为 0；阶段/产物完成反馈仅执行一次 200ms opacity/transform 入场，全局 reduced-motion 回退已由正式 Playwright 运行时验证。
- P1-7 数据真实性：删除 File Explorer 假文件树、启动时自动建演示项目/上传示例 CSV 及虚构默认选择；生产源码契约持续禁止退役 demo 标识、路径和自动建项。
- P2-2 加载态切片：项目、会话、文件、Artifact Preview、Evolution 图谱、ActiveFilePreview 与 model/auth 顶栏服务状态已接入真实异步语义。选中产物内容由版本化 React Query 缓存托管；图谱使用稳定查询键，并在经验审核/训练变更后显式失效；活动文件复用 current-version 查询键，后台刷新保留缓存内容与未保存草稿，保存后同步写入内容缓存并失效文件树元数据。模型/账户弹层保留最后成功 provider/身份并就地重试，登出失败不丢身份、成功先提交匿名缓存再验证。各区域支持首次加载、后台刷新、错误、局部恢复和 `aria-busy`；无项目时显示明确引导并禁用不安全操作。
- P2-2 完成反馈：从结构化 `stage_completed`、`step_completed`、`artifact_created` 事件派生最近一次真实完成状态；后续普通进度不会清除它，新的完成事件会替换旧状态。Workflow 摘要通过 `aria-live="polite"` 播报阶段或产物完成，产物提供真实打开动作；不对文件/训练等服务端规范写入预先宣告成功，只在服务端成功后提交缓存，并保留明确 pending/error 状态。
- P2-7 可访问性审计：`accessibility.e2e.ts` 用 `@axe-core/playwright` 对分析工作区、命令面板、模型/账户对话框、ML 实验详情、Evolution 图谱 6 个关键状态做 WCAG 2 A/AA 零容忍扫描；全局 `:focus-visible` 基线与 muted 文本对比度已达审计阈值；抽取共享 `useDialogFocus` hook，统一命令面板与模型/账户 popover 的焦点移入、Tab 陷阱与关闭后焦点恢复，E2E 追加真实浏览器键盘焦点断言。
- P2-8 Bundle performance：`EvolutionWorkspace` 已按路由懒加载，首屏 JS 降至 458.95kB / gzip 131.84kB；构建流程加入可量化预算门禁，约束首屏 JS/CSS、chunk 数量与重依赖懒加载状态，P0/P1/P2 主线全部关闭。
- P3-1 至 P3-3 自进化闭环：现代 `data_quality_profile.json` 已接入经验抽取；训练失败会真实发射 `kernel_output`；未解决 kernel 错误会进入情境标签。数据缺失和运行时错误两类经验均可在真实主路径完成“发现 → 沉淀 → 采纳 → 再次命中”。
- P3-4 工程测试：为四个领域 action hook 增加 31 项直接契约测试，覆盖文件路径级联、产物交接、训练入参与失败处理、治理操作缓存失效；同时修复训练经验 domain 使用下划线导致规则永远无法命中的词汇不一致问题。
- P3-5 第一切片：`RightPanel.tsx` 拆为 9 组职责模块，实验详情的局部状态与联动一并下沉；修复“评估策略”乱码与二进制提示双重字面量，新增 29 项 CSV/格式化测试，首屏 bundle 与拆分前逐字节一致。

## 最近验证

- 后端测试：`backend\.venv\Scripts\python.exe -m pytest -q`，最近完整结果 `252 passed, 3 skipped`。
- 前端测试：`npm.cmd test`，最近完整结果 `43 passed files / 307 tests`。
- 前端 lint：`npm.cmd run lint`，通过。
- 前端构建：`npm.cmd run build`，TypeScript、Vite 与 bundle 预算门禁通过；P3-5 第一切片首屏 JS 为 469.02kB / gzip 135.02kB。
- Playwright E2E：真实 FastAPI + Vite 全套 `10 passed`，覆盖自然语言数据/ML golden path、自进化闭环、命令面板、知识图谱、响应式与可访问性状态。
- GitHub：当前分支 `refactor/right-panel-split` 已推送并建立 PR #10；backend、frontend、Playwright 三个 CI 闸门全部通过。
- 本地健康检查：当前未启动开发服务，本次未执行在线探测；后端回归状态以完整 pytest 与 GitHub CI 结果为准。

## 下一步优先级

1. P3-5 超大文件拆分：按已勘察边界先把 `stages.py` 的 15 个 `_run_*` 方法拆为 recovery/data/model/governance mixin，再处理 `componentRegistry.ts` 与 `machine_learning.py`。
2. 每个拆分切片保持外部接口与行为不变，以现有后端 252 项、前端 307 项及 10 条 Playwright E2E 为回归基线，并持续守住 bundle 预算。
3. P3-5 完成后继续扩展真实数据/ML 工具与全链路 provenance，并推进 Docker Kernel、Redis 多实例和 GitHub Actions Node 运行时升级验证。

## 当前注意事项

- `.codex-runs/` 是本地浏览器烟测截图和服务日志目录，已加入 `.gitignore`。
- `playwright-report/`、`test-results/` 与 `.playwright-workspaces/` 是 E2E 临时产物，均已忽略。
- Docker/Jupyter 真实沙箱仍是后续硬化重点，当前可继续使用本地开发模式验证核心流程。
- 自进化规则仍应保持人工审核或高置信门槛，避免经验污染 Agent 行为。

## 2026-05-24 Sklearn Evaluation Update

- Completed the next ML tool-library slice: sklearn classifier runs now emit holdout strategy, train/eval row counts, class distribution, eval class distribution, and per-class precision/recall/F1/support.
- The training panel now surfaces richer experiment detail with candidate model comparison, evaluation summary, and per-class quality tables when those metrics are available.
- Verification passed: focused backend ML tests, backend ruff, frontend lint, frontend tests, frontend build, and the deep-link browser smoke runner. The smoke runner now also asserts that the model comparison table renders for focused experiments.
- Next recommended slice: add feature-engineering and model-explanation tooling that feeds this same training detail surface, starting with permutation/feature-importance summaries and exportable evaluation reports.

## 2026-05-24 Model Explanation Update

- Added model-explanation summaries to sklearn training: permutation importance for model-agnostic feature impact and logistic-regression coefficient tables for linear models.
- The training detail panel now renders Permutation Importance and Linear Coefficients when those fields are present, alongside candidate comparison, class quality, confusion matrix, and existing feature importance.
- The deep-link smoke runner now seeds a deterministic sklearn explanation experiment and verifies the explanation tables in browser DOM QA without requiring a live Docker/Jupyter training run.
- Next recommended slice: generate an exportable model evaluation report artifact for review/handoff, combining metrics, class quality, confusion matrix, candidate comparison, and explanations.

## 2026-05-26 Preprocessing-Aware Training Update

- Sklearn training now accepts an optional `preprocessing_plan_path` generated by the analysis workflow.
- Training metrics, evaluation reports, experiment records, and run-detail responses now preserve the preprocessing plan artifact and summarized plan metadata.
- The frontend training panel can toggle use of the selected preprocessing plan, and keeps the training dataset path stable when the active file is a plan/report preview.
- The deep-link smoke fixture now verifies that focused sklearn experiments display the linked Preprocessing Plan in the training detail panel.
- Training detail artifact paths now open their canonical file preview directly; browser smoke clicks the Preprocessing Plan path and verifies the structured plan preview.
- Training detail now includes confusion-derived Error Slices for per-class support, error counts, error rate, and main confusion direction.
- Training now emits `prediction_samples.json` artifacts for concrete row-level prediction/error inspection, and training detail previews those samples with errors first.
- Added a workspace-stable `Codex Clean Env` launcher to work around the current Windows Codex process `PATH`/`Path` duplication. The launcher verifies with one `Path` variable and working `Start-Process`; use it for future Codex sessions before running local servers and browser smoke.
- Verification baseline was restored on 2026-05-28: backend ruff passed, backend pytest returned `89 passed, 3 skipped`, frontend lint passed, frontend tests returned `10 passed files / 30 tests`, frontend build passed, and `npm.cmd run smoke:deep-links` passed end to end after temporary local services were started.
- The training detail surface now supports historical run filtering/sorting, candidate-model sorting and best-only view, a compact diagnostic summary, clickable error-slice filters, and prediction-sample filters by status, actual label, predicted label, and query.
- The deep-link smoke runner now asserts the focused experiment diagnostics and prediction-sample filter controls, and its knowledge summary check accepts the current normal Chinese UI labels.
- Next recommended slice: make preprocessing plans executable as first-class artifacts, producing a transformed dataset plus transformation report that can feed sklearn training directly.

## 2026-05-28 Codex-Style Data/ML Agent Direction Update

- 项目后续产品方向更新为：面向数据分析与机器学习的垂直 Codex-style IDE，而不是单纯的数据/ML 工具集合。
- 目标体验是一个持久的中间 Agent 工作区：用户用自然语言描述目标，Agent 规划并推进数据读取、画像、清洗、转换、训练、评估、诊断、迭代、导出和经验沉淀。
- 当前三栏工作台、项目/文件 API、WebSocket 会话流、数据质量画像、预处理计划、sklearn 训练、评估报告、预测样本、日志和知识图谱/自进化能力，已经构成这个方向的基础。
- 主要前端差距：中间 `AgentWorkspace` 还偏向聊天和静态卡片，需要升级成 Agent cockpit，包含计划时间线、当前步骤状态、审批节点、工具进度和阶段性数据/ML 组件。
- 主要后端差距：当前 WebSocket 分析链路仍偏硬编码，需要演进为意图识别、计划生成、工具路由、结构化事件流、审批、重试、恢复和产物追踪的 Agent orchestrator。
- 计划引入结构化任务事件：`stage_started`、`tool_started`、`artifact_created`、`approval_required`、`component_requested`、`step_failed`、`step_completed`、`task_resumed`。
- 计划把数据画像、质量审查、预处理计划编辑、特征/目标列选择、训练配置、模型对比、错误切片、预测样本、报告预览和 provenance 链接做成由 Agent 状态触发的上下文组件。
- 已同步更新 `task_plan.md` 和 `progress.md`：下一阶段将先定义单 Agent 工作台模型与事件协议，再改造中心计划时间线和组件注册机制，随后把“可执行预处理计划”作为第一个端到端 Agent 控制的纵向切片。

## 2026-05-28 Agent Cockpit Workflow Update

- Completed the first frontend slice toward the Codex-style data/ML agent cockpit.
- Added typed workbench events for future orchestration: `stage_started`, `stage_completed`, `tool_started`, `approval_required`, `component_requested`, `step_failed`, `step_completed`, and `task_resumed`.
- Added a pure workflow-state model that derives ingest/profile/clean/transform/train/evaluate/diagnose/export/learn stage status from both existing events and the future typed event contract.
- Upgraded the center `AgentWorkspace` into a first-pass cockpit with a phase timeline, current-step guidance, approval checkpoint summary, requested component summary, and latest-artifact context.
- Connected preprocessing-plan generation and execution to the cockpit event model: generating a plan now raises approval/component state, and executing it advances transform and hands the planned dataset to training.
- Verification passed: frontend lint, frontend tests `11 files / 35 tests`, frontend build, and browser DOM QA on `http://127.0.0.1:5174/?mode=analysis`.
- Temporary local services are running for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.
- Next recommended slice: add a frontend component registry and render real inline cockpit cards for data quality, preprocessing approval/execution, planned dataset handoff, and training configuration before replacing the hardcoded WebSocket flow with the backend orchestrator.

## 2026-05-30 Cockpit Component Registry Update

- Completed the next frontend slice toward the Codex-style data/ML agent cockpit.
- Added a cockpit component registry that maps structured agent/artifact events into real inline cards for data quality, preprocessing plan approval/execution, planned dataset handoff, and training configuration.
- The center cockpit now exposes real workflow actions: Generate Profile, Generate Plan, Open Plan, Execute/Re-run Plan, Open Dataset, Open Training, and Start sklearn.
- File-tree and search selection now route through the canonical project-file selection handler, keeping active file, training dataset, and selected preprocessing plan state aligned.
- Fixed the default churn-sample preprocessing path: tiny-sample numeric columns are no longer dropped only because each value is unique, while explicit ID-like fields such as `customer_id` still drop as identifiers.
- Browser QA passed for the center cockpit flow: Generate Profile -> Generate Plan -> Execute Plan produced `customer_churn_planned.csv`, rendered Planned Dataset and Training Configuration cards, and showed no console warnings/errors or page-level horizontal overflow.
- Verification passed: backend ruff, backend pytest `94 passed, 3 skipped`, focused data-analysis tests `19 passed`, frontend lint, frontend tests `12 files / 39 tests`, frontend build, and browser DOM QA on `http://127.0.0.1:5174/?mode=analysis&file=data/customer_churn.csv`.
- Temporary local services are running for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.
- Next recommended slice: replace the hardcoded WebSocket analysis flow with an intent-aware backend orchestrator and implement the first natural-language golden path for "analyze this dataset and prepare it for modeling".

## 2026-05-30 Agent Orchestrator Golden Path Update

- Completed the first backend orchestrator slice for the Codex-style data/ML agent cockpit.
- `backend/app/api/ws.py` is now a thin WebSocket transport that delegates user messages to `AgentOrchestrator`.
- `AgentOrchestrator` currently routes legacy analysis overview and modeling-prep intents, resolves the active dataset safely, persists session messages/events, streams assistant deltas, and emits typed workflow events for the cockpit.
- The legacy analysis behavior remains compatible with existing session/log/lesson contracts while the new modeling-prep path adds stage/tool/artifact/approval/component events.
- Natural-language prompt `Analyze this dataset and prepare it for modeling` now profiles data quality, generates `preprocessing_plan.json`, emits an approval checkpoint, writes the pipeline script, executes preprocessing, writes the planned dataset and transformation reports, and hands the result to training configuration.
- The frontend component registry now distinguishes canonical preprocessing plans from transformation reports, so training cards keep the correct `preprocessing_plan.json` path after execution.
- Browser QA passed against the running local app: the prompt produced Data Quality, Preprocessing Plan, Planned Dataset, and Training Configuration cockpit cards, with the correct plan/dataset paths and no visible error alerts.
- Verification passed: backend ruff, full backend pytest `95 passed, 3 skipped`, focused WebSocket/session tests `8 passed`, focused golden/data-analysis tests `12 passed`, frontend lint, frontend tests `12 files / 39 tests`, focused component-registry tests `4 passed`, frontend build, and browser DOM QA.
- Follow-up note: this golden-path slice still auto-executed after `approval_required`; the Approval Resume Update below resolves true pause/resume, leaving retry/failure recovery and durable task-state persistence as the next backend-orchestrator work.
- Temporary local services are running for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.

## 2026-05-30 Approval Resume Update

- Completed the first true pause/resume approval slice for the Codex-style data/ML agent cockpit.
- The modeling-prep path now pauses after profile, preprocessing-plan, and pipeline-script generation; it no longer writes `customer_churn_planned.csv` until the user approves the checkpoint.
- The orchestrator persists pending approval metadata for the session, including the original dataset path and plan path, then resumes from that state when the frontend sends an `approval_response`.
- The center cockpit preprocessing-plan card now shows `Approve & Execute` during the pause, sends the approval over the WebSocket session, clears the pending approval after `approval_resolved`, and then renders Planned Dataset and Training Configuration cards after `task_resumed` execution.
- Browser QA passed on a fresh deep-linked session: before approval there was no planned dataset or training config; after approval `customer_churn_planned.csv` and Training Configuration appeared with no visible errors.
- Verification passed: backend `py_compile`, backend ruff, focused WebSocket/session tests `5 passed`, focused backend golden/data-analysis/session tests `15 passed`, frontend lint, focused frontend tests `3 files / 15 tests`, frontend build, and browser DOM QA.
- Next recommended slice: build retry/failure recovery and richer durable task-state persistence, including stale approval detection, revise/decline UX, and visible retry/resume controls for failed transform or training steps.

## 2026-05-30 Approval Revision and Failure Recovery Update

- Completed the first revision/failure branch for preprocessing approvals.
- The preprocessing-plan cockpit card now exposes `Revise Plan` while an approval is pending; choosing it sends a WebSocket approval response with `decision=revise`.
- The orchestrator now resolves the approval as revised, deletes the pending approval record, emits a transform `step_failed`, and rejects later reuse of the same approval id with `approval_not_found`.
- Approved transform execution failures are now represented as structured error events instead of breaking the WebSocket stream.
- The cockpit no longer recreates a fake approval after revision; it keeps the transform step failed and shows `Preprocessing plan needs revision` with a `Refresh Plan` action.
- Browser QA passed on a fresh session: before revision the UI showed both `Approve & Execute` and `Revise Plan`; after revision it showed `Refresh Plan`, no planned dataset, no training config, no synthetic approval, and no traceback.
- Verification passed: backend `py_compile`, backend ruff, focused WebSocket/session tests `6 passed`, focused backend WebSocket/session/golden/data-analysis tests `21 passed`, frontend lint, focused frontend tests `3 files / 18 tests`, frontend build, and browser DOM QA.
- Next recommended slice: add explicit retry/resume controls and richer durable task-state persistence for failed transform/training steps.

## 2026-05-30 Transform Retry Resume Update

- Completed the first explicit retry/resume slice for failed transform execution in the Codex-style data/ML cockpit.
- Approved preprocessing execution failures now persist durable transform task state under the session, including the original dataset, plan path, retry count, and last error.
- Added WebSocket `resume_step(stage="transform")`; retry restores the saved dataset/plan context, reruns preprocessing, emits resumed workflow events, and clears the durable task state after success.
- The center cockpit now distinguishes retryable execution failure from approval revision: retryable failures show `Transform execution failed` with `Retry Transform`, while revised approvals keep the safer `Refresh Plan` path.
- Browser QA passed on a fresh session by forcing a transform failure, confirming the retry card, repairing the plan, retrying from the UI, and reaching Planned Dataset plus Training Configuration cards.
- Verification passed: backend ruff, full backend pytest `97 passed, 3 skipped`, focused WebSocket/session tests `7 passed`, frontend lint, frontend tests `12 files / 47 tests`, frontend build, and browser DOM QA.
- Next recommended slice: extend durable retry/resume to training and evaluation steps, and add a small task-state/log inspector for failed workflow stages.

## 2026-06-01 Training Retry State and Data/ML Agent Roadmap Update

- Extended durable recovery from transform into sklearn training, keeping the project aligned with the Codex-style data/ML agent cockpit direction.
- Added shared task-state persistence for `sessions/<session_id>/task_state/<stage>.json`; transform and training recovery now use the same stage-state model with timestamps, retry count, saved inputs, and last error.
- Added `/api/projects/{project_id}/ml/resume-sklearn`, which resumes a failed sklearn run from saved dataset, target column, GPU flag, and preprocessing-plan path.
- Sklearn training now saves retry state for recoverable failures, including model/runtime errors, validation errors, GPU queue timeout/cancel, and Windows process-launch `OSError`/`PermissionError`.
- The center cockpit now renders a retryable training failure state: `Training execution failed` with `Retry Training`, while preserving dataset, target, and plan context.
- Browser QA confirmed the user-visible chain on the machine-learning deep link: `Start sklearn` -> structured train failure -> durable `task_state/train.json` -> cockpit `Retry Training` action.
- Verification passed: backend `py_compile`, backend ruff, focused backend ML API tests `9 passed`, frontend lint, frontend tests `12 files / 48 tests`, frontend build, and browser DOM QA.
- The project plan now includes a detailed Data/ML Code Agent IDE roadmap covering durable workflow recovery, task-state inspection, orchestrator expansion, contextual data/ML components, editable preprocessing, diagnosis actions, provenance, data-source adapters, export bundles, and end-to-end golden-path coverage.
- Next recommended slice: rehydrate durable failed task state into the cockpit after reload/session reopen, then add a task-state/log inspector before extending retry/resume to evaluation, report export, and learning-rule extraction.

## 2026-06-01 Task-State Rehydration Update

- Added session-level task-state listing with `GET /api/sessions/{session_id}/task-states`, returning persisted failed/retryable workflow state from `sessions/<session_id>/task_state`.
- The center cockpit now rehydrates failed durable task state after reload/session reopen. A saved sklearn training failure restores the failed Train stage, saved dataset/target/plan context, last error, and `Retry Training` action without requiring the user to retrigger training.
- Training actions now write and refresh state against the active session id instead of falling back to `manual-training`, keeping recovery state aligned with the visible conversation.
- Browser QA confirmed the reload path on the train retry fixture: persisted `task_state/train.json` restored `Training execution failed` plus `Retry Training` after a full page reload.
- Verification passed: backend ruff/tests, frontend lint/tests/build, and browser DOM QA.
- Next recommended slice: add a failed-stage task-state/log inspector, then extend durable retry/resume to evaluation, report export, and learning-rule extraction.

## 2026-06-01 Failed Task Inspector Update

- Added a failed-stage task-state inspector to the center cockpit. Persisted failed state now shows saved inputs, dataset, target, plan, engine, GPU flag, retry count, last error, related logs, latest log, and the recommended next recovery action.
- The inspector appears alongside existing retry controls, so a failed sklearn run shows both `Train failure inspector` and `Training execution failed` / `Retry Training`.
- Added `Inspect Logs`, which opens the right-side log panel and filters to the failed task id.
- Browser QA confirmed the train retry fixture shows the inspector and that `Inspect Logs` lands on the filtered `step_failed` event.
- Verification passed: frontend lint, TypeScript, full frontend tests, production build, and browser DOM QA.
- Next recommended slice: extend durable retry/resume to evaluation, report export, and learning-rule extraction.

## 2026-06-01 Codex-Style Data/ML IDE Planning Update

- Synchronized the user's updated product concept into the project plan: MLAgent should become a Codex-style IDE panel specialized for data analysis and machine learning.
- Clarified that the center workspace is the primary natural-language agent cockpit. Users should describe a goal once, then see planning, execution, approvals, tool progress, artifacts, diagnostics, retry controls, and final handoff inside one continuous workflow.
- Documented the target workflow phases: ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn.
- Documented the component strategy: each phase should summon dedicated data/ML UI components, including data profiles, quality warnings, feature/target selectors, preprocessing editors, transform diffs, training configuration, model comparison, error slices, prediction samples, report preview, export bundle controls, and learned-rule review.
- Added a five-phase implementation plan to `task_plan.md`: reliability-first runtime, full workflow router, contextual data/ML components, IDE context inspector/provenance, and verified end-to-end agent experience.
- Updated the roadmap and near-term implementation targets. The next concrete implementation slice remains evaluation/report retry and resume, followed by export/learn recovery, orchestrator intent expansion, contextual cockpit components, right-panel inspector evolution, provenance, and full browser/API golden-path QA.
- This was a planning/documentation update only; no code changed and no tests were required.

## 2026-06-01 Evaluation Report Retry Update

- Completed the evaluation/report durable retry slice.
- Added report regeneration and resume APIs for existing experiment runs. Failed regeneration now saves `task_state/evaluate.json`; successful resume regenerates `model_evaluation_report.md`, updates the run detail, and clears the saved state.
- The center cockpit now rehydrates failed evaluation state with `Evaluate failure inspector`, saved experiment/metrics context, `Retry Evaluation`, `Inspect Logs`, and artifact navigation.
- The training detail panel now includes `Regenerate Report` for the selected experiment run.
- Browser QA confirmed the machine-learning deep link shows the evaluate failure inspector, retry action, missing metrics path, saved error, and report-regeneration action from a real persisted session task state.
- Verification passed: backend ML/session tests, backend ruff, frontend focused tests, full frontend tests, lint, TypeScript, production build, and deep-link browser smoke.
- Next recommended slice: extend durable recovery to export bundles and learned-rule extraction, then add richer retry policy metadata.

## 2026-06-02 Export and Learning Recovery Update

- Completed the export/learn durable recovery slice.
- Added model handoff export bundle APIs and resume support. Failed bundle generation now saves `task_state/export.json`; successful resume writes a zip bundle with manifest/model/metrics/report artifacts, updates the experiment run, and clears state.
- Added learning-rule extraction resume support. Failed session extraction now saves `task_state/learn.json`; successful resume creates lesson candidates and clears state.
- The center cockpit inspector now supports export and learn failures with `Retry Export`, `Retry Learning`, report/source facts, `Inspect Logs`, and artifact navigation.
- The Evolution Knowledge workspace now shows a learn recovery strip with `Retry Learning`, so recovery is visible even when the center Agent cockpit is not rendered in evolution mode.
- The training detail panel now includes `Export Bundle`, and completed bundles appear as downloadable archive artifacts.
- Browser deep-link smoke now covers export retry and learn recovery controls.
- Verification passed: backend ML/evolution tests, backend ruff, frontend focused/full tests, lint, TypeScript, and deep-link smoke.
- Next recommended slice: harden retry policy metadata and add abandon/regenerate/stale-artifact choices across retryable stages.

## 2026-06-02 Codex-Style Data/ML IDE Plan Sync

- Synchronized the refined product direction into the project plan and progress archive: MLAgent should become a Codex-style IDE panel specialized for data analysis and machine learning.
- The center workspace is the primary natural-language agent cockpit. Users should describe goals such as analyzing a dataset, preparing features, training models, diagnosing weak metrics, exporting a report, or extracting lessons without jumping across disconnected modes.
- The target workflow phases are now explicitly tracked as ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn.
- Updated `task_plan.md` with execution-ready milestones:
  - recovery policy hardening,
  - full workflow intent routing,
  - structured agent command language,
  - contextual cockpit components,
  - interactive preprocessing and feature editing,
  - ML run cockpit,
  - actionable diagnosis and iteration,
  - contextual inspector and provenance,
  - safe learning loop,
  - reproducible workflow export,
  - richer data sources/tooling,
  - end-to-end product QA.
- Added a stage component backlog covering expected components, triggers, required state, primary actions, and provenance outputs for each data/ML workflow phase.
- Refined the immediate next implementation order: first retry policy metadata and branch controls, then orchestrator intent expansion, structured context resolution, richer cockpit components, contextual inspector/provenance, workflow export, and full browser/API golden-path coverage.
- This was a planning/documentation update only; no product code changed and no tests were required.

## 2026-06-03 Retry Policy Hardening Update

- Completed the M1 recovery policy hardening slice.
- Durable task state for transform, train, evaluate, export, and learn now carries recovery policy metadata: repair hint, stale check, resume action, regenerate-upstream action, abandon action, and stale artifact paths.
- Added a real abandon-state API at `DELETE /api/sessions/{session_id}/task-states/{stage}`. It clears saved retry state while preserving historical logs and artifacts.
- The center failed-stage inspector now surfaces recovery policy facts and exposes `Abandon State` alongside retry, inspect logs, and open artifact actions.
- The Evolution Knowledge learn recovery strip now shows the same recovery policy facts and can abandon the saved learning retry state without switching back to the center cockpit.
- Browser smoke fixtures now seed export/learn policy metadata and assert the new `Repair`, `Resume`, and `Abandon State` UI.
- Verification passed: backend ruff, backend focused tests `30 passed`, frontend focused tests `18 passed`, full frontend tests `64 passed`, frontend lint, TypeScript, production build, and deep-link smoke.
- Next recommended slice: expand the orchestrator intent router and add "continue from last failure" behavior that reads the new recovery policy metadata.

## 2026-06-03 Continue From Last Failure Intent Update

- Completed the first M2 full-workflow-router slice.
- The backend orchestrator now recognizes natural-language continuation prompts such as `continue from last failure`, `retry last failed step`, and Chinese continue/retry-last-failure variants.
- The continuation path reads persisted failed task state for transform, train, evaluate, export, and learn without requiring the active file to be a dataset preview.
- Saved failures now stream typed cockpit events and request the `task_state_inspector`, allowing the center conversation to surface saved inputs, retry count, last error, repair guidance, stale checks, resume/regenerate/abandon choices, and related recovery actions.
- No saved failure now produces an explicit no-state response instead of attempting an unsafe default retry.
- The frontend refreshes durable task state when the orchestrator requests the inspector, keeping natural-language continuation prompts aligned with the existing failed-stage cockpit card.
- Verification passed: backend WebSocket tests `9 passed`, backend ruff, focused component-registry tests `13 passed`, full frontend tests `65 passed`, frontend lint, TypeScript, production build, and deep-link smoke.
- Next recommended slice: add train/evaluate/diagnose/export/learn intent handlers and connect safe continuation branches to actual resume, regenerate, or abandon execution after user confirmation.

## 2026-06-03 Train Intent Router Update

- Completed the next M2 full-workflow-router slice for natural-language training requests.
- The backend orchestrator now routes explicit sklearn/baseline/classifier/regressor training prompts to a train-stage configuration flow instead of the broader modeling-prep path.
- The training intent resolves dataset, target column, and optional preprocessing plan from current cockpit context. It can infer target-like CSV columns and can use `preprocessing_plan.json` as the active file while still selecting the correct source dataset and plan.
- The stream emits typed train-stage events and requests `training_config`; it does not auto-run training, preserving the user-controlled `Start sklearn` checkpoint.
- The center cockpit now consumes `training_config.props` so the card shows the backend-selected dataset, target, and plan, and the `Start sklearn` action launches the real training API with that same context.
- Browser smoke now includes a natural-language train-intent check from the cockpit composer to the rendered Training Configuration card.
- Verification passed: backend WebSocket tests `11 passed`, backend ruff, focused component-registry tests `14 passed`, full frontend tests `66 passed`, frontend lint, TypeScript, production build, and deep-link smoke.
- Next recommended slice: add natural-language evaluate/report intent routing for selected experiment runs, followed by diagnose/export/learn intents and safer branch execution from continuation prompts.

## 2026-06-04 Evaluate Report Intent Router Update

- Completed the next M2 full-workflow-router slice for natural-language evaluation/report requests.
- The backend orchestrator now routes prompts such as `evaluate this model`, model comparison, evaluation report, and Chinese evaluation/report variants to an evaluate-stage flow.
- Evaluation intent resolves the selected cockpit `experiment_id`; when no run is selected, it falls back to the latest completed experiment run.
- The stream emits typed evaluate-stage events and requests `model_comparison` plus `evaluation_report`, carrying experiment id, dataset, target, best model, metrics, model, report, prediction-sample, and preprocessing-plan context.
- The center cockpit now renders real Model Comparison and Evaluation Report cards from backend props, including `Open Metrics`, `Open Report`, and `Regenerate Report`. The regenerate action calls the existing evaluation-report API from the center cockpit.
- Browser smoke now covers the natural-language evaluate/report flow from a focused ML experiment/report deep link through the composer to rendered cockpit cards.
- Verification passed: backend WebSocket tests `13 passed`, backend ruff, focused component-registry tests `15 passed`, full frontend tests `67 passed`, frontend lint, TypeScript, production build, and deep-link smoke.
- Next recommended slice: add natural-language diagnose/export/learn intent handlers, followed by safer continuation branches that execute resume, regenerate, export, abandon, or learned-rule proposal flows after user confirmation.

## 2026-06-04 Diagnose Intent Router Update

- Completed the next M2 full-workflow-router slice for natural-language model diagnosis requests.
- The backend orchestrator now routes prompts about diagnosis, error slices, confusion matrices, low recall/precision, misclassification, and prediction samples to a diagnose-stage flow.
- Diagnosis intent resolves the selected cockpit `experiment_id`; when no run is selected, it falls back to the latest completed experiment run.
- The orchestrator derives worst class, main confusion, total error rows, error-slice rows, and a next-step recommendation from the saved confusion matrix.
- The stream emits typed diagnose-stage events and requests `error_analysis` plus `prediction_samples`, carrying experiment id, dataset, target, metrics, report, prediction-sample, worst-class, confusion, and recommendation context.
- The center cockpit now renders real Error Analysis and Prediction Samples cards from backend props, including `Open Metrics`, `Open Report`, `Open Samples`, and `Open Diagnostics`.
- Browser smoke now covers the natural-language diagnose flow from a focused ML experiment/report deep link through the composer to rendered cockpit cards.
- Verification passed: backend WebSocket tests `15 passed`, backend ruff, focused component-registry tests `16 passed`, full frontend tests `68 passed`, frontend lint, TypeScript, production build, and deep-link smoke.
- Next recommended slice: add natural-language export/report-bundle and learned-rule proposal intents, followed by safer continuation branches that execute resume, regenerate, export, abandon, or learned-rule proposal flows after user confirmation.

## 2026-06-04 Data/ML Code Agent IDE Plan Table Update

- Updated the project plan table with the user's latest product concept: MLAgent should become a Codex-like IDE panel specialized for full data-analysis and machine-learning workflows.
- The center conversation is now explicitly tracked as the main natural-language agent cockpit. Dedicated data/ML components should appear progressively for ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn phases.
- Added a 13-goal follow-up table to `task_plan.md`, covering workflow routing, structured agent commands, cockpit UX, contextual components, interactive preprocessing, ML run operations, actionable diagnosis, contextual inspector, provenance, reproducible handoff, safe learning, source/tool expansion, and end-to-end golden-path QA.
- Recorded this synchronization in the current phase checklist so future work can proceed from the updated plan order.
- This was a documentation/planning update only; no product code changed and no tests were required.

## 2026-06-04 Export and Learn Intent Router Update

- Completed the next M2 full-workflow-router slice for natural-language export and learned-rule review requests.
- The backend orchestrator now routes export/handoff prompts to an export-stage flow and learned-rule prompts to a learn-stage flow.
- Export intent resolves the selected or latest completed experiment run and requests `evaluation_report` plus `export_bundle` cockpit cards with artifact readiness, missing artifact, and existing bundle context.
- Learn intent reads persisted session evidence, previews candidate lessons through the existing extractor without writing rules yet, and requests a `lesson_review` card with source-session, evidence, candidate, and source-artifact context.
- The center cockpit now exposes wired export/learn actions: `Export Bundle`, `Open Report`, `Open Bundle`, `Extract Lessons`, and `Open Evidence`. Adoption of learned rules remains reviewable through the existing Evolution Knowledge flow.
- Browser smoke now covers natural-language export and learn intent cards in addition to train, evaluate, and diagnose intent cards.
- Verification passed: backend WebSocket tests `17 passed`, backend ruff, focused component-registry tests `18 passed`, full frontend tests `70 passed`, frontend lint, production build, and deep-link smoke.
- Next recommended slice: add remaining ingest/profile/clean/transform/iterate natural-language intents and then connect confirmation-based continuation branches to real resume/regenerate/abandon execution.

## 2026-06-06 Profile Clean Transform Iterate Intent Router Update

- Completed the next M2 full-workflow-router slice for natural-language profile, clean, transform, and iterate prompts.
- Profile prompts now generate `data_quality_profile.json` and request the `data_quality` cockpit card with typed dataset/profile/count/target-candidate props.
- Clean prompts now stay non-mutating: they request a quality review plus a safe preprocessing-plan handoff with planned actions and required confirmation before any dataset change.
- Transform prompts now generate `preprocessing_plan.json`, persist a pending approval, emit `approval_required`, and request the `preprocessing_plan` cockpit card without executing the plan.
- Iterate prompts now resolve the selected/latest experiment run, derive confusion-matrix diagnostics, and request a new `iteration_proposal` cockpit card with metrics/report/samples paths and review-before-retrain guidance.
- The frontend workflow model now includes `iterate`, and the component registry renders `iteration_proposal` using existing open-artifact and training actions.
- Verification passed: backend WebSocket tests `21 passed`, backend ruff, frontend tests `72 passed`, frontend lint, production build, and deep-link smoke after local services were started outside the sandbox.
- Next recommended slice: add the remaining ingest intent, then connect confirmed continuation branches to real resume/regenerate/abandon execution.

## 2026-06-06 Confirmed Abandon Branch Update

- Rechecked current WebSocket coverage and confirmed ingest intent is already implemented and covered by the backend test suite.
- Added the first natural-language confirmed recovery branch execution: `abandon last failure` / `clear last failure` now routes to `abandon_last_failure`.
- The orchestrator now reads durable failed task state without requiring a CSV active file, deletes the newest saved failed state, emits typed `step_completed`, `tool_call_finished`, assistant-message, and `task_progress` events, and preserves historical logs, messages, artifacts, and prior failure events.
- Added backend WebSocket coverage for abandoning a seeded failed training state and verifying the saved task state is gone while the audit trail remains.
- Updated `task_plan.md` so the workflow router status includes ingest and so the next recovery target is structured command output plus direct resume/regenerate branches.
- Verification passed: focused WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff on touched backend files, frontend tests `14 files / 73 tests`, frontend lint, and frontend production build. The known Windows pytest temp cleanup `PermissionError` still appears after successful pytest completion with exit code 0; PowerShell still prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: implement structured agent command/context resolver output, then add confirmed regenerate-upstream and direct resume execution where safe.

## 2026-06-06 Structured Train Command Update

- Completed the first M3 structured Agent Command / Context Resolver slice for natural-language training requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before the train-stage `training_config` component request.
- The train command records intent, dataset path, optional dataset version, target column, selected artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, and component requests.
- Plan-backed training prompts now include the preprocessing plan in both `selected_artifacts` and `resolved_context`, matching the actual training card props.
- Frontend event typing now includes `agent_command`; workflow state can show the interpreted train command, and the log model formats and searches command/resolved-context details.
- Updated `task_plan.md` so M3 Agent command language is now in progress instead of planned.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow/log tests `18 passed`, full frontend tests `14 files / 75 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: extend `agent_command` events to evaluate/diagnose/export/learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Evaluate Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language evaluation/report requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before evaluate-stage `model_comparison` and `evaluation_report` component requests.
- The evaluate command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, and component requests.
- `resolved_context` now carries the selected experiment id and all report-related artifact paths, giving the cockpit/log surface a single auditable explanation for why the model comparison and report cards appeared.
- Frontend workflow-state coverage now asserts that evaluate commands activate the report-review step before cards arrive; existing log formatting/search handles the generic command payload.
- Updated `task_plan.md` so M3 tracks train plus evaluate command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, full frontend tests `14 files / 76 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: extend `agent_command` to diagnose/export/learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Diagnose Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language diagnosis/error-sample requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before diagnose-stage `error_analysis` and `prediction_samples` component requests.
- The diagnose command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, component requests, and a compact diagnosis summary.
- `resolved_context` now carries the selected experiment id, model/report/metrics/sample artifact paths, and the computed worst-class/main-confusion/error-count recommendation so the cockpit/log surface has one auditable explanation for why the diagnostic cards appeared.
- Frontend command typing now allows an optional `diagnosis_summary`, and workflow-state coverage asserts that diagnose commands activate the error-analysis step before diagnostic cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, and diagnose command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `15 passed`, full frontend tests `14 files / 77 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`. After adding model artifact provenance to the diagnose command, focused backend WebSocket tests, backend ruff, focused workflow-state tests, and frontend production build were rerun successfully.
- Next recommended slice: extend `agent_command` to export/learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Export Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language export/handoff requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before export-stage `evaluation_report` and `export_bundle` component requests.
- The export command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing/export-bundle artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, component requests, bundle readiness, and missing required artifacts.
- `resolved_context` now carries selected experiment id, model/report/metrics/sample/preprocessing/export artifact paths, bundle readiness, and missing artifact prerequisites so the cockpit/log surface has one auditable explanation for why the final report and handoff bundle cards appeared.
- Frontend command typing now allows optional export readiness fields, and workflow-state coverage asserts that export commands activate the reproducible handoff step before report/bundle cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, diagnose, and export command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `16 passed`, full frontend tests `14 files / 78 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: extend `agent_command` to learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Learn Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language learned-rule review requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before the learn-stage `lesson_review` component request.
- The learn command records intent, selected source artifacts, missing context, high risk level, planned learn step, proposed `lesson_review` tool, approval requirement, component request, source session id, source event count, candidate count, high-confidence count, and extractability state.
- `resolved_context` now carries project id, mode, source session id, source event count, latest event type, source artifacts, candidate counts, and extractability state so learned-rule proposals can be audited back to session evidence before any rule adoption.
- The command is explicitly non-mutating and `approval_required: true`; actual lesson extraction/adoption remains reviewable through the existing `lesson_review` and Evolution flows.
- Frontend command typing now allows optional learn/source-evidence fields, and workflow-state coverage asserts that learn commands activate the rule-review step before cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, diagnose, export, and learn command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `17 passed`, full frontend tests `14 files / 79 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: add missing-context prompts for ambiguous dataset/run selection and structured continuation commands.

## 2026-06-06 Ambiguous Run Selection Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for ambiguous experiment-run selection.
- The evaluation-context resolver now keeps explicit `experiment_id`, unique active-file matches, and explicit latest/recent/newest prompts deterministic, but treats multiple completed runs without a clear selector as missing context.
- Ambiguous evaluate/diagnose/export prompts now emit and persist an `agent_command` with `missing_context: ["experiment_id"]`, `approval_required: true`, `candidate_runs`, planned component requests, and resolved project/mode/active-file context instead of silently choosing the latest run.
- The ambiguous evaluate flow stops before opening model comparison/report cards, asks the user to select an experiment run, and reports `Waiting for experiment run selection`.
- Frontend stream typing now includes `candidate_runs`, and workflow state marks missing-context command stages as blocked so the cockpit can show the unresolved run-selection state.
- Verification passed: backend WebSocket tests `24 passed`, full backend tests `121 passed, 3 skipped`, backend ruff on touched backend files, focused frontend workflow-state tests `20 passed`, full frontend tests `14 files / 82 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: connect the cockpit's selected run response back into evaluate/diagnose/export continuation, then add missing-context prompts for ambiguous dataset/train contexts and structured continuation commands.

## 2026-06-06 Run Selection Continuation Update

- Completed the next M3 vertical slice: ambiguous experiment-run selection is actionable from the center cockpit.
- Missing-`experiment_id` `agent_command` events with `candidate_runs` now render a blocked `experiment_run_selection` card instead of empty evaluation/diagnosis/export cards.
- Each candidate action carries the selected experiment id and original intent. Clicking it focuses the run in the app and resends the intent through the existing WebSocket `user_message` contract with `experiment_id`, preserving ordinary session-event auditability.
- Backend coverage now proves the two-step evaluate flow: ambiguous prompt -> candidate list/no report cards -> selected candidate -> normal evaluate command plus model-comparison and evaluation-report cards.
- Frontend component-registry coverage now proves the run-selection card facts/actions and prevents premature model/report cards while context is missing.
- Verification passed: focused backend WebSocket tests `24 passed`, full backend tests `121 passed, 3 skipped`, backend ruff on touched backend files, focused component-registry tests `21 passed`, full frontend tests `14 files / 83 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Next recommended slice: add dedicated browser/API golden-path coverage for the run-selection card, then extend missing-context prompts to ambiguous dataset/train contexts and structured continuation commands.

## 2026-06-06 Ambiguous Run Selection Smoke Update

- Completed the browser/API QA hardening slice for ambiguous run selection.
- The deep-link smoke fixture now creates two deterministic completed runs plus a neutral active file and a dedicated `smoke-ambiguous-run-selection` session.
- Browser smoke now verifies the visible cockpit flow: no selected run -> evaluate prompt -> blocked `experiment_run_selection` card with candidates -> no premature report cards -> click selected run -> selected experiment opens real model-comparison and evaluation-report cards.
- The smoke runner now supports a second interaction/assertion stage so future multi-step cockpit flows can be tested inside the same deterministic browser harness.
- Verification passed: `npm.cmd run smoke:deep-links`, frontend lint, frontend production build, full frontend tests `14 files / 83 tests`, focused backend WebSocket tests `24 passed`, backend ruff, and full backend tests `121 passed, 3 skipped`.
- Next recommended slice: add diagnose/export selected-run variants and then extend missing-context prompts to ambiguous dataset/train contexts.

## 2026-06-06 Diagnose Export Run Selection Coverage Update

- Completed the selected-run continuation coverage slice for diagnose and export.
- Backend WebSocket tests now assert the two-step contract for ambiguous diagnose/export prompts: missing run context blocks on candidate selection with no premature cards, then the selected `experiment_id` resumes into real diagnosis or export components.
- The export intent router now recognizes `export experiment <id>`, which is the command shape emitted by the run-selection cockpit action.
- Deep-link smoke now has separate ambiguous evaluate, diagnose, and export sessions; it verifies the blocked `experiment_run_selection` card, selects the deterministic run, and checks the resulting evaluation, diagnosis, or export cards with artifact paths.
- Verification passed: focused backend WebSocket tests `26 passed`, backend ruff on touched backend files, `npm.cmd run smoke:deep-links`, frontend lint, frontend build, full frontend tests `14 files / 83 tests`, and full backend tests `123 passed, 3 skipped`.
- Next recommended slice: add ambiguous dataset/train missing-context prompts and parser/context tests for continuation prompts.

## 2026-06-06 Ambiguous Dataset Train Selection Update

- Completed the ambiguous training-dataset selection slice for M3.
- Train prompts from a neutral/non-CSV active file now emit a persisted missing-`dataset_path` `agent_command` with candidate CSV datasets instead of returning an opaque training-context error or guessing a dataset.
- Candidate dataset summaries include path, row count, column count, and target candidates; supplying a selected `training_dataset_path` resumes into the normal `training_config` card.
- The center cockpit now renders a blocked `dataset_selection` card with one `select_training_dataset` action per candidate and suppresses premature training cards while dataset context is unresolved.
- Deep-link smoke now verifies the visible flow from ambiguous train prompt to dataset selection to selected-dataset training configuration.
- Verification passed: focused backend WebSocket tests `27 passed`, backend ruff, focused frontend component/workflow tests `42 passed`, frontend build, `npm.cmd run smoke:deep-links`, frontend lint, full frontend tests `14 files / 84 tests`, and full backend tests `124 passed, 3 skipped`.
- Next recommended slice: add parser/context tests for continuation prompts and connect dataset candidates to durable dataset-version registry records.

## 2026-06-06 Dataset Version Context Propagation Update

- Completed a follow-up M3 contract slice so train context no longer drops dataset version information.
- Direct train commands and selected-dataset continuations now include a stable CSV `dataset_version_id` in the `agent_command`, resolved context, and `training_config` props.
- Ambiguous train candidate datasets now include version ids, and the cockpit dataset-selection card displays the version and carries it in the selection action payload.
- This is a propagation hardening step, not a full dataset registry: the current id is computed from the CSV filename, while source hash, schema snapshot, sample strategy, and provenance edges remain future registry work.
- Verification passed: focused backend train/dataset-selection WebSocket tests `2 passed`, focused backend WebSocket suite `27 passed`, backend ruff, focused frontend component/workflow tests `42 passed`, frontend build, `npm.cmd run smoke:deep-links`, frontend lint, full frontend tests `14 files / 84 tests`, and full backend tests `124 passed, 3 skipped`.
- Next recommended slice: replace computed CSV ids with durable dataset registry records and add parser/context tests for user correction prompts.

## 2026-06-13 Pre-Commit Progress Snapshot

- Prepared the accumulated MLAgent Data/ML Agent IDE worktree for a consolidated commit on `codex/foundation-kernel-mvp`.
- Implemented capabilities now span kernel/resource hardening, GPU scheduling controls, graph/file provenance navigation, settings/preferences, log observability, deterministic deep-link smoke, data quality profiling, executable preprocessing plans, sklearn/baseline ML artifacts, evaluation reports, diagnostics, export/learn retry state, durable task-state inspection, intent-aware orchestration, and structured agent commands.
- Recent M3 command/context resolver work includes ambiguous run selection, evaluate/diagnose/export selected-run continuation, ambiguous training-dataset selection, and stable CSV dataset-version propagation into train commands and cockpit cards.
- `.codex-skill-build/` is now ignored as local skill-build cache output.
- Commit verification gate run: backend pytest, backend ruff, frontend lint/test/build. `npm.cmd run smoke:deep-links` remains blocked in this sandboxed Windows session.
- Smoke verification note: the first deep-link smoke run failed because no frontend server was listening at `127.0.0.1:5174`; a Vite Job retry hit the known Windows parent-directory access error while loading `vite.config.ts`; a built-asset static-server retry reached the page and API but the headless browser/CDP phase returned `TypeError: fetch failed`. The smoke script now prints stack/fallback details instead of an empty `FAIL` for the next diagnostic pass.
- Next recommended slice after commit: replace computed CSV dataset ids with durable source-hash/schema dataset registry records and add parser/context tests for user correction prompts.

## 2026-05-28 Executable Preprocessing Plan Update

- 已完成“可执行预处理计划”切片：`preprocessing_plan.json` 现在可以通过 `/analysis/execute-preprocess-plan` 执行，生成 planned dataset CSV、JSON transformation summary 和 Markdown transformation report。
- 后端新增 `execute_preprocessing_plan` 工具，支持计划内字段丢弃、数值列中位数填充/标准化、类别列众数填充/one-hot 编码和目标列保留。
- 前端预处理计划预览中新增 `Execute Plan` 操作；执行成功后会刷新文件树、打开转换后的 CSV，并把该 planned dataset 设为后续训练数据集。
- Golden path 覆盖范围已扩展到：生成预处理计划、执行计划、检查 planned dataset、检查 transformation report。
- 验证通过：backend ruff、backend pytest `92 passed, 3 skipped`、focused golden-path/data-analysis tests `18 passed`、frontend lint、frontend tests `10 files / 30 tests`、frontend build。
- 浏览器 deep-link smoke 脚本已扩展 planned dataset 和执行按钮断言；本次未完成实际浏览器 smoke，因为当前用户检查服务仍占用 `127.0.0.1:8000/5174`，而当前 Codex 进程的重复 `PATH`/`Path` 环境导致并行备用端口服务启动不可靠。
- 下一步建议：定义单 Agent 工作台的 workflow event/state contract，并围绕可执行预处理流改造中间 `AgentWorkspace`，加入计划时间线、审批节点和组件调用。
