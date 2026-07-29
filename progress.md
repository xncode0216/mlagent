# MLAgent Follow-up Progress

## 2026-05-23

- Started follow-up implementation after reviewing project plan/progress documents.
- Created lightweight planning files to track this implementation slice.
- Ran backend baseline: `backend\.venv\Scripts\python.exe -m pytest -q` returned `73 passed, 3 skipped`.
- Ran Kernel baseline: `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_kernel_service.py -q` returned `5 passed, 2 skipped`.
- Observed a Windows pytest temp cleanup `PermissionError` after test completion; command exit code remained 0.
- Added failing Kernel hardening tests for Docker resource limits, read-only workspace mounts, timeout results, and mount mode validation.
- Implemented Kernel hardening and config passthrough; Kernel tests now return `8 passed, 2 skipped`.
- Cleaned existing backend ruff E402 issues in file API and sklearn tests; `ruff check backend` now passes.
- Added local Kernel timeout handling for interface consistency; Kernel tests now return `9 passed, 2 skipped`.
- Final backend verification: `backend\.venv\Scripts\python.exe -m pytest -q` returned `77 passed, 3 skipped`.
- Final backend lint: `backend\.venv\Scripts\python.exe -m ruff check backend` returned `All checks passed!`.
- Frontend verification with `npm.cmd`: test returned `1 passed`, lint passed, build succeeded. Plain `npm` in PowerShell is blocked by execution policy; sandboxed Vite/esbuild test/build also hit a denied parent path probe.
- Added `backend/tests/test_golden_path_api.py` to cover the backend golden path from upload through graph insight.
- Red test exposed that graph surprise insights did not include baseline `candidate_runs` parsed feature names.
- Patched graph insight feature extraction and reran focused tests: `12 passed`.
- Final backend verification after golden path: `backend\.venv\Scripts\python.exe -m pytest -q` returned `78 passed, 3 skipped`.
- Added GPU scheduler tests for explicit acquire status, queued cancellation, queued timeout removal, active cancellation promotion, and cancel API.
- Implemented GPU scheduler cancel/timeout semantics and train-sklearn HTTP responses for GPU timeout/cancel.
- Focused GPU/ML verification: `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_gpu_scheduling.py backend\tests\test_machine_learning_api.py -q` returned `12 passed`.
- Final backend lint after GPU work: `backend\.venv\Scripts\python.exe -m ruff check backend` returned `All checks passed!`.
- Final backend verification after GPU work: `backend\.venv\Scripts\python.exe -m pytest -q` returned `83 passed, 3 skipped`.
- Added frontend API helpers and types for GPU status and task cancellation.
- Connected AppShell to poll GPU status, refresh on training transitions, and cancel GPU tasks.
- Added GPU resource panel to the training tab with active task, queue rows, refresh, and cancel controls.
- Frontend verification: `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/`: page identity was MLAgent, machine-learning tab rendered the training panel, GPU scheduling state and empty active-task state were visible, refresh interaction worked, and console warnings/errors were empty. Browser screenshot capture timed out twice.
- Added `?mode=machine-learning` as a stable initial-mode deep link for frontend QA and direct navigation to the training panel.
- Re-ran frontend verification after the deep-link change: `npm.cmd run lint` passed, `npm.cmd test` passed outside the sandbox, and `npm.cmd run build` passed outside the sandbox.
- Playwright CLI was not locally installed; `npm.cmd exec -- playwright --version` attempted npm cache/registry access and hit Windows permission/network constraints. Used Chrome CLI as the screenshot fallback instead.
- Chrome CLI could capture simple `data:` and local HTTP pages, but Vite dev-server pages did not produce a screenshot. Serving the production `dist` through a temporary local static/API proxy and using `--timeout=10000` produced `.codex-runs/gpu-panel-chrome-timeout.png`.
- Continuing with Phase 10 graph evidence positioning: backend graph nodes should expose stable provenance metadata, and the frontend graph sidebar should make node source/evidence visible.
- Added backend graph provenance metadata for dataset column, experiment run, and lesson/rule nodes; extended the golden-path API test to assert those provenance contracts.
- Added `graphEvidence.ts` plus unit coverage for formatting provenance and evidence fields in the frontend.
- Updated the evolution graph sidebar to show a "来源与证据" panel for selected nodes.
- Verification after graph evidence work: backend ruff passed, backend pytest returned `83 passed, 3 skipped`, frontend lint passed, frontend test returned `2 passed files / 3 passed tests`, and frontend build succeeded.
- Browser QA at `http://127.0.0.1:5174/?mode=evolution`: graph tab rendered, column and rule nodes showed provenance/evidence details, rule node retained the "查看经验详情" action, and console warnings/errors were empty.
- Cleaned the temporary graph-evidence QA run, lesson, model, and metrics artifacts from the local dev project after browser validation; restored `data/customer_churn.csv` to the frontend default sample CSV.
- Continuing Phase 10 graph evidence positioning: adding clickable graph provenance paths that synchronize with the active project file in the existing file explorer.
- Added file navigation actions to graph evidence items for dataset, metrics, and model artifact paths.
- Updated the evolution graph sidebar so navigable evidence rows show "定位文件" and call back into AppShell's existing active-file/file-explorer state.
- Covered single-path and multi-path graph provenance navigation in `graphEvidence.test.ts`.
- Verification after graph-to-file positioning: frontend lint passed, frontend tests returned `2 passed files / 5 passed tests`, and frontend build succeeded.
- Browser QA on the IBM churn project: graph evidence showed multiple "定位文件" buttons; clicking the first one set the status bar to `Active file: data/telecom_customer_churn.csv`; console warnings/errors were empty.
- Continuing with activity-bar completion: left rail icons should open real side panels instead of acting as visual placeholders, starting with settings and account/data/experiment/knowledge views.
- Added `activityRail.ts` configuration and tests to keep every visible activity-bar icon tied to a real panel.
- Added `ActivityPanel.tsx` and connected the left rail icons for data sources, experiments, version/audit, knowledge base, account, and settings.
- Settings panel now shows frontend/backend/API-doc URLs, GPU status, active file, and quick buttons to switch major work modes.
- Verification after activity-bar work: `npm.cmd run lint` passed, `npm.cmd test` returned `3 passed files / 8 passed tests`, and `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/`: data, experiment, version, knowledge, account, and settings icons each opened a real panel; settings rendered runtime URLs and mode buttons; console warnings/errors were empty; in-app screenshot capture succeeded.
- Continuing Phase 10 graph evidence positioning: experiment provenance now adds a "实验 ID" action that can jump from a graph experiment node into the machine-learning training detail.
- Wired `EvolutionWorkspace` -> `AppShell` -> `RightPanel` so "定位实验" switches to machine-learning mode, opens the experiments activity panel, selects the matching run, and shows a "来自知识图谱定位" note.
- Reused the same experiment focusing path from the left activity-bar experiments panel; clicking a historical experiment there now focuses the matching run instead of only switching modes.
- Verification after experiment deep-link work: `npm.cmd run lint` passed, `npm.cmd test` returned `3 passed files / 8 passed tests`, and `npm.cmd run build` passed.
- Browser QA on the IBM churn project: clicking graph experiment `exp_telecom_gb_001` -> "定位实验" opened the machine-learning tab, selected/highlighted the sklearn run, showed the provenance note, and console warnings/errors were empty. The experiments activity panel also focused the same run. Full-page CDP screenshot still timed out in the in-app browser.

## 2026-05-24

- Researched mainstream frontend product UI/UX practices from Material Design, Apple HIG, Nielsen Norman Group, WCAG, Fluent, Carbon, Atlassian, and web.dev.
- Created `docs/frontend-ui-research-notes.md` to summarize the research and MLAgent-specific conclusions.
- Created the project-specific skill `docs/skills/mlagent-frontend-product-designer/SKILL.md` with a detailed reference file at `docs/skills/mlagent-frontend-product-designer/references/product-ui-principles.md`.
- Added `docs/skills/mlagent-frontend-product-designer/agents/openai.yaml` metadata for the dedicated frontend product design agent.
- Added `AGENTS.md` with the rule that future frontend UI/UX work should first use the MLAgent frontend optimization agent.
- Validated the new skill with `quick_validate.py`; result: `Skill is valid!`.
- Continued with the settings/preferences slice using the project frontend optimization skill.
- Added `appPreferences.ts` and focused unit coverage for local preference normalization, persistence, and invalid-value fallback.
- Settings panel now exposes actionable controls for default startup mode, default ML target column, and GPU refresh interval.
- AppShell now reads preferences at startup, applies the default mode when no `?mode=` deep link is present, applies the default target column to the training panel, and uses the preferred GPU polling interval.
- Added an in-memory preferences fallback for browser environments where `localStorage` is unavailable.
- Verification after settings preferences: `npm.cmd run lint` passed, `npm.cmd test` returned `4 passed files / 11 tests`, and `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/`: changed default mode to machine-learning, default target column to `Churn`, GPU refresh interval to `10000`; settings summary updated, machine-learning training panel showed target column `Churn`, and console warnings/errors were empty.
- Continued with the logs/observability slice using the project frontend optimization skill.
- Added `logViewModel.ts` and focused unit tests for event formatting, trace summaries, task summaries, rules-matched events, and filtering by level/error/trace/task/query.
- Upgraded the right-side log panel with operational overview chips, clickable trace/task filters, error focus, clear filters, selected-event inspector, and JSON/detail rendering for tool/rule/error events.
- Verification after log observability: focused log tests passed, `npm.cmd run lint` passed, `npm.cmd test` returned `5 passed files / 15 tests`, and `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/?mode=evolution`: the historical data-analysis session showed 28 log events, 2 traces, 1 task, clickable trace/task filters reduced the list to the selected chain, clear filters restored all rows, the inspector showed task/trace JSON details, and console warnings/errors were empty.
- In-app browser text entry/fill still depends on a missing virtual clipboard capability, so browser QA used existing persisted session logs and DOM/locator clicks rather than creating a fresh chat prompt through the textbox.
- Continued with the golden-path hardening slice.
- Extended `backend/tests/test_golden_path_api.py` so the product-critical chain now verifies uploaded CSV preview, persisted session messages, persisted session events, JSONL log download, single trace-id continuity, analysis artifact paths, training run list/detail, readable metrics/model artifacts, graph provenance, and injection log availability.
- Focused backend verification after golden-path expansion: `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_golden_path_api.py -q` returned `1 passed`.
- Full backend verification after golden-path expansion: `backend\.venv\Scripts\python.exe -m ruff check backend` passed, and `backend\.venv\Scripts\python.exe -m pytest -q` returned `83 passed, 3 skipped`.
- Windows pytest still prints a post-exit temp cleanup `PermissionError` for `pytest-current`; the pytest command exit code remained 0.
- Continued with the lightweight frontend/browser E2E preparation slice.
- Added `appDeepLink.ts` and unit tests for stable smoke-test query parameters: `mode`, `activity`, `rightTab`, `file`, `projectId`, `sessionId`, and `experimentId`.
- Wired deep links into `AppShell` and `RightPanel` so QA can open a target mode, activity panel, right-side tab, active file, project, session, or experiment focus without manual setup clicks.
- Frontend verification after deep-link work: focused `appDeepLink` tests passed, `npm.cmd run lint` passed, `npm.cmd test` returned `6 passed files / 18 tests`, and `npm.cmd run build` passed.
- Browser DOM QA at `http://127.0.0.1:5174/?mode=machine-learning&activity=experiments&rightTab=training&file=data/customer_churn.csv`: the app opened machine-learning mode, the experiments activity panel was active, the right training tab was active, the training panel rendered, the status bar showed `Active file: data/customer_churn.csv`, and console warnings/errors were empty.
- Added `frontend/scripts/deep-link-smoke.mjs` and the `npm.cmd run smoke:deep-links` script.
- The smoke runner starts a local Chrome/Edge instance through CDP, opens stable deep links, and asserts DOM state instead of taking full-page screenshots.
- Smoke coverage now includes analysis data panel, machine-learning experiments/training panel, and evolution knowledge/logs panel.
- Deep-link smoke verification passed with all three cases: analysis data panel, machine-learning training panel, and evolution logs panel.
- Final frontend verification after the smoke runner: `npm.cmd run lint` passed, `npm.cmd test` returned `6 passed files / 18 tests`, `npm.cmd run build` passed, and `npm.cmd run smoke:deep-links` passed.
- Continued expanding the browser smoke coverage using the project frontend optimization skill.
- Added `evolutionTab=graph` to `appDeepLink.ts` and wired it into `EvolutionWorkspace` so QA can open the graph tab directly.
- Updated the smoke runner to seed/reuse a deterministic `smoke_deep_links` project, write `data/smoke_churn.csv`, and ensure a completed baseline training run before browser assertions.
- Expanded `npm.cmd run smoke:deep-links` from three static panel checks to five real workflow checks: analysis data panel, ML training panel, experiment-focus detail, evolution logs, and direct evolution graph tab.
- Verification after smoke expansion: `npm.cmd run lint` passed, `npm.cmd test` returned `6 passed files / 18 tests`, `npm.cmd run build` passed, and `npm.cmd run smoke:deep-links` passed all five cases.
- Continued the browser/API golden-path work using the same deterministic smoke fixture.
- Extended `frontend/scripts/deep-link-smoke.mjs` so setup now generates the analysis report, ML handoff artifact, cleaned dataset, adopted high-confidence lesson, rule-injection audit entry, and graph surprise insight.
- Expanded browser smoke assertions to cover 10 user-visible entry points: raw data preview, analysis report preview, ML handoff JSON preview, cleaned dataset preview, training panel, experiment focus, knowledge activity summary, evolution logs, adopted-rule injection audit, and evolution graph insight.
- Verification after golden-path smoke expansion: `npm.cmd run lint` passed, `npm.cmd test` returned `6 passed files / 18 tests`, `npm.cmd run build` passed, and `npm.cmd run smoke:deep-links` passed all 10 cases.
- Continued with the data-analysis/ML tool-library expansion slice.
- Added backend `data_quality_profile` tooling plus `/api/projects/{project_id}/analysis/profile`; the profile captures row/column counts, missing cells, duplicate rows, column kind, missing/unique counts, quality flags, numeric summaries/top values, sample rows, and target candidates.
- Added focused backend coverage for the new tool and API; `backend\.venv\Scripts\python.exe -m pytest tests\test_data_analysis_tools.py tests\test_data_analysis_api.py -q` returned `12 passed`.
- Added frontend API types/call wiring, a "生成画像" action in the chart/action panel, and a data-quality profile table preview in the right data panel.
- Extended `npm.cmd run smoke:deep-links` with the quality profile artifact and DOM assertions for Target `churn`, quality-profile headers, and all smoke dataset columns.
- Verification after quality-profile work: backend ruff passed, focused backend tests passed, `npm.cmd run lint` passed, `npm.cmd test` returned `6 passed files / 18 tests`, `npm.cmd run build` passed, and `npm.cmd run smoke:deep-links` passed all 11 cases.
- Continued with the ML tool-library expansion slice.
- Enhanced sklearn training output with evaluation strategy, train/eval row counts, class distribution, eval class distribution, per-class precision/recall/F1/support, and richer candidate-run metrics.
- Updated training API tests and sklearn tool tests to preserve and assert the richer metrics contract.
- Added frontend training metric types plus a product-facing training detail surface for candidate model comparison, evaluation summary, and per-class quality tables.
- Extended the deep-link smoke runner so experiment focus also asserts that the candidate model comparison table renders in the browser.
- Verification after sklearn evaluation work: focused backend ML tests returned `8 passed, 1 skipped`, backend ruff passed, frontend lint passed, frontend tests returned `6 passed files / 18 tests`, frontend build passed, and `npm.cmd run smoke:deep-links` passed all 11 cases including the model comparison assertion.
- Continued with the model-explanation slice.
- Added sklearn permutation importance generation for supported feature counts and logistic-regression coefficient summaries to the training output.
- Extended backend tests so the sklearn tool/API contract preserves permutation importance and linear coefficients.
- Added frontend model explanation types and training-detail tables for Permutation Importance and Linear Coefficients, while preserving the existing random-forest feature-importance table.
- Extended the deep-link smoke fixture with a deterministic sklearn explanation run, metrics artifact, model artifact, and experiment record so browser QA can validate the explanation tables without requiring Docker/Jupyter during smoke setup.
- Verification after model-explanation work: focused backend ML tests returned `8 passed, 1 skipped`, backend ruff passed, frontend lint passed, frontend tests returned `6 passed files / 18 tests`, frontend build passed, and `npm.cmd run smoke:deep-links` passed all 11 cases with `candidateRows=2`, `explanationRows=3`, and `coefficientRows=3`.
- Used the MLAgent frontend product design skill to investigate the evolution knowledge page overlap reported from browser screenshots.
- Fixed the evolution workspace layout so header/tabs/stats/layout sections cannot collapse into each other, added container-width responsive fallbacks for the rules and graph views when the right panel is open, and hardened top/status bars plus long IDs/paths against horizontal overflow.
- Verification after the layout fix: `npm.cmd run lint` passed, sandboxed Vite/Vitest remained blocked by the known Windows parent-directory access issue, sandbox-external `npm.cmd test -- --run` returned `6 passed files / 18 tests`, and sandbox-external `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/?mode=evolution&activity=knowledge&rightTab=logs`: 1366x900, 1554x1117, and 515x788 DOM scans showed no horizontal overflow, no framework overlay, no console warnings/errors, stats before layout, no lesson/knowledge overlap, and no knowledge/right-panel overlap. The graph empty-state deep link also rendered without overflow or console issues.
- Ran a second frontend optimization pass for the left sidebar settings and project-file explorer surfaces.
- Fixed settings form control overflow by normalizing app-wide box sizing, and fixed the project file tree so expanded folder children render directly under their parent instead of after all root folders.
- Added `fileTree.ts` with focused tests for expanded folder ordering, nested folder ordering, and collapsed-folder hiding.
- Additional polish: file-row names now truncate cleanly before the action buttons, preventing download/rename/delete controls from covering long filenames.
- Verification after the second UI pass: `npm.cmd run lint` passed, sandbox-external `npm.cmd test -- fileTree --run` returned `1 passed file / 3 tests`, sandbox-external `npm.cmd test -- --run` returned `7 passed files / 21 tests`, sandbox-external `npm.cmd run build` passed, and `npm.cmd run smoke:deep-links` passed.
- Browser QA at `http://127.0.0.1:5174/`: settings form controls stayed inside the panel at 1366x900, `data/customer_churn.csv` rendered immediately under the expanded `data` folder, file-row actions no longer overlapped filenames, all activity sidebars had no horizontal overflow, no framework overlay, and no console warnings/errors.
- Ran a third frontend optimization pass focused on machine-learning page interaction feedback.
- Fixed repeated quick-command tool chips by aggregating tool events by tool name/status; repeated `profile_dataset` calls now render as one status chip with a count instead of continuously appending green tags.
- Added local action feedback for Agent quick commands, including empty input, missing project, disconnected WebSocket, successful send, and rapid duplicate-click prevention.
- Added training-panel feedback for target validation, training submission/completion/failure, GPU toggle semantics, GPU refresh, and GPU cancellation; switching to baseline now clears GPU request state and explains why.
- Wired the right-panel footer "export current panel" button to download a JSON summary of the active panel instead of acting as a silent no-op.
- Added `toolActivity.ts` and focused tests covering fallback tool chips, repeated event collapsing, and finished-event tool label preservation.
- Continued with the ML handoff/report artifact slice.
- Added backend-curated `model_evaluation_report.md` generation for baseline and sklearn training runs, including experiment metadata, metric summary, candidate model comparison, per-class quality, confusion matrix, feature importance, permutation importance, linear coefficients, and artifact paths.
- Persisted the evaluation report artifact in experiment run records and training API responses; backend coverage now asserts report creation, run detail persistence, and file API readability.
- Updated frontend training API types, local artifact events, lesson evidence, and the training detail panel so `Evaluation Report` is visible alongside model and metrics paths.
- Extended the deep-link smoke fixture with a deterministic sklearn evaluation report artifact plus browser assertions for training detail visibility and report preview.
- Continued with the feature-engineering/preprocessing plan slice.
- Added a backend `preprocessing_plan` tool and `/analysis/preprocess-plan` API that generate a JSON preprocessing plan plus a reproducible sklearn `ColumnTransformer` pipeline script.
- The preprocessing plan identifies a target column, drops likely identifiers/constants/high-missing columns, splits numeric and categorical features, and records median/standard-scaling plus most-frequent/one-hot strategies.
- Connected the frontend analysis panel with a "Preprocess Plan" action, local artifact events for the JSON plan and Python script, and a structured preprocessing-plan preview.
- Extended the deep-link smoke fixture to seed and assert the preprocessing plan preview.
- Verification after the third UI interaction pass: `npm.cmd run lint` passed, sandboxed Vite/Vitest and build remained blocked by the known Windows parent-directory access issue, sandbox-external `npm.cmd test -- toolActivity --run` returned `1 passed file / 3 tests`, sandbox-external `npm.cmd test -- --run` returned `8 passed files / 24 tests`, and sandbox-external `npm.cmd run build` passed.
- Browser QA at `http://127.0.0.1:5174/?mode=machine-learning&rightTab=training`: rapid double-click on "启动训练计划" showed duplicate-click feedback and collapsed tool chips to `profile_dataset x2 · 完成`; desktop GPU interactions showed baseline clearing the GPU checkbox, GPU refresh showed success feedback, export showed an "已导出 训练 面板摘要" status, there was no horizontal overflow, no framework overlay, and no console warnings/errors. Narrow viewport correctly hides the right panel, so hidden GPU controls are not interactable.
## 2026-05-26 Preprocessing-Aware Training Update

- Continued with the preprocessing-aware sklearn training slice.
- Added optional `preprocessing_plan_path` support to `/ml/train-sklearn` and `train_sklearn_classifier`; the generated training code now loads the plan, applies target validation, drops planned columns, respects numeric/categorical feature selections, and records plan metadata in the sklearn result.
- Persisted preprocessing plan provenance through training metrics, evaluation reports, experiment run records, and run-detail API responses.
- Updated the training panel so a generated or selected `preprocessing_plan.json` can be toggled into sklearn training, while the training dataset path remains stable even when the active file is a plan/report artifact preview.
- Extended the browser smoke fixture and experiment-focus assertion so deterministic sklearn runs show the linked Preprocessing Plan in the training detail panel.
- Continued with artifact-to-file navigation from training detail.
- Training run detail now renders metrics, evaluation reports, and preprocessing plans as openable path controls that switch the right panel to the canonical file preview.
- Browser smoke now clicks the Preprocessing Plan path from a focused sklearn run and verifies that the right panel opens the structured preprocessing-plan preview.
- Continued with post-training diagnostics for preprocessing-aware runs.
- Added confusion-derived Error Slices to the focused training run detail, showing per-class support, error counts, error rate, and the main confusion direction.
- Added focused unit coverage for error-slice derivation and extended browser smoke assertions so the experiment-focus surface verifies the new diagnostics table.
- Continued with row-level post-training diagnostics.
- Baseline and sklearn training now produce a `prediction_samples.json` artifact with actual label, predicted label, error flag, row index, and a compact feature snapshot.
- Training API responses and experiment records now preserve `prediction_samples_artifact`; evaluation reports include the prediction sample artifact path.
- The training detail panel previews prediction samples with errors first and provides an Open action for the full JSON artifact. The data preview panel also renders prediction sample artifacts as a structured table.
- Verification passed: backend ruff, focused backend ML/API tests, frontend lint, frontend tests, and frontend build. Browser smoke was updated for prediction samples but could not be rerun because the local backend/frontend dev servers were stopped and this Windows shell currently has a duplicated `Path/PATH` environment issue that breaks background service startup.

## 2026-05-28 Codex Windows Environment Update

- Investigated the Windows process-environment issue that made PowerShell `Env:` enumeration and `Start-Process` fail with duplicate `Path`/`PATH` keys.
- Confirmed the user-level and machine-level Windows environment configuration is normal; the duplication exists in the already-running Codex process environment, where `PATH` and `Path` contain identical values.
- Created a stable clean-environment launcher inside the workspace at `C:\Users\Administrator\mlagent\.codex-tools\Launch-Codex-CleanEnv.cmd` with the PowerShell implementation in `Launch-Codex-CleanEnv.ps1`.
- Updated the real desktop shortcut `C:\Users\Administrator\Desktop\Codex Clean Env.lnk` to point at the workspace launcher.
- Verified the launcher with `-VerifyOnly`: it resolves the Codex executable, produces exactly one `Path` variable, and `Start-Process` exits with code 0.
- Current already-open Codex sessions still inherit the duplicated environment; future Codex sessions should be started through `Codex Clean Env` before running local dev servers or browser smoke.

## 2026-05-28 Training Diagnostics Interaction Update

- Continued along the recommended execution order by first restoring the verification baseline.
- Backend verification passed: `backend\.venv\Scripts\python.exe -m ruff check backend` returned `All checks passed!`, and `backend\.venv\Scripts\python.exe -m pytest -q` returned `89 passed, 3 skipped`. The known Windows pytest temp cleanup `PermissionError` still appears after successful completion.
- Frontend verification passed: `npm.cmd run lint`, sandbox-external `npm.cmd test` returned `10 passed files / 30 tests`, and sandbox-external `npm.cmd run build` succeeded. Sandboxed Vite/Vitest/build still hit the known Windows parent-directory access issue.
- Added `trainingDiagnostics.ts` with focused unit coverage for experiment filtering/sorting, candidate-model sorting/best-only view, prediction-sample filtering, label options, and compact diagnostic summaries.
- The training run history now supports filtering by all/sklearn/baseline/GPU/focused and sorting by newest, accuracy, F1, or eval rows.
- Candidate model comparison now supports all-candidate vs best-only views and sorting by accuracy, F1, eval rows, or model name.
- Focused training details now show a compact diagnostic summary for worst class, main confusion direction, total error rows, and a next-step recommendation.
- Error-slice rows now act as direct filters for prediction samples, so users can jump from class-level errors to concrete row-level examples.
- Prediction samples now support status, actual label, predicted label, and text/feature search filters while preserving the Open artifact action.
- Extended `npm.cmd run smoke:deep-links` to assert the new diagnostic summary and prediction-sample filter controls in the machine-learning experiment-focus surface.
- Fixed the smoke knowledge-summary assertion to accept the current normal Chinese UI labels as well as the older mojibake labels.
- Browser/API smoke passed end to end after starting temporary local backend/frontend services: analysis previews, preprocessing plan, ML training panel, focused experiment diagnostics, evaluation report, knowledge summary, evolution logs/rules, and graph tab all passed.
- Temporary local services for ports 8000 and 5174 were stopped after smoke; only TIME_WAIT connections remained.

## 2026-05-28 Codex-Style Data/ML Agent Direction Update

- Reframed the product direction around a vertical Codex-style IDE for data analysis and machine learning.
- The target experience is a persistent center conversation where users use natural language to drive the full workflow: data ingestion, profiling, cleaning, transformation, training, evaluation, diagnosis, iteration, export, and learning.
- Current project strengths already support this direction: the three-column workbench shell, project/file APIs, WebSocket session stream, data quality profiling, preprocessing plans, sklearn training, evaluation reports, prediction samples, logs, and graph/evolution provenance surfaces.
- Identified the main product gap: the center `AgentWorkspace` is still closer to chat plus static cards, while the desired product needs a true agent cockpit with a durable plan timeline, current step state, approval checkpoints, and stage-specific data/ML components.
- Identified the main backend gap: `backend/app/api/ws.py` still follows a mostly hardcoded analysis flow; the next architecture step is an intent-aware orchestrator with typed task events, tool routing, approvals, retries, resumable tasks, and artifact provenance.
- Recorded the desired typed event direction: `stage_started`, `tool_started`, `artifact_created`, `approval_required`, `component_requested`, `step_failed`, `step_completed`, and `task_resumed`.
- Recorded the desired component direction: data quality review, preprocessing plan editor, feature/target selector, training configuration, model comparison, error-slice diagnostics, prediction sample inspection, report preview, and provenance links should be invoked by agent state rather than only fixed panels.
- Updated `task_plan.md` with a new Product North Star and follow-up checklist for the single-agent workbench model, center cockpit, component registry, agent orchestrator, executable preprocessing artifacts, and the first natural-language golden path.
- Recommended next vertical slice remains aligned with the existing plan: make preprocessing plans executable as first-class artifacts, but implement it as an agent-controlled flow that can generate a plan, request user approval, execute the transform, produce a transformed dataset/report, and hand that artifact to training.

## 2026-05-28 Executable Preprocessing Plan Update

- Continued the recommended implementation order by making preprocessing plans executable as first-class artifacts.
- Added a backend `execute_preprocessing_plan` data-analysis tool that reads a saved `preprocessing_plan.json`, applies planned drops, median numeric imputation, optional standard scaling, most-frequent categorical imputation, one-hot encoding, and target passthrough, then writes a transformed dataset CSV.
- Added `/api/projects/{project_id}/analysis/execute-preprocess-plan`; the endpoint can infer `dataset_path` from the plan artifact, rejects path escapes, and emits three artifacts: transformed dataset, JSON transformation summary, and Markdown transformation report.
- Extended backend data-analysis tests and the backend golden path so the verified chain now covers profile/report/handoff, preprocessing-plan generation, preprocessing-plan execution, planned dataset creation, and report artifact readability.
- Added frontend API typing for executable plans and `VITE_API_BASE_URL` support, allowing browser/smoke runs to target a non-default backend when an older inspection service occupies `127.0.0.1:8000`.
- Added an `Execute Plan` action directly inside the preprocessing-plan preview; successful execution refreshes the file tree, selects the transformed CSV, sets it as the current training dataset, and keeps the plan path selected for sklearn training provenance.
- Extended the deep-link smoke fixture and assertions to seed and validate planned datasets and the preprocessing-plan execution button path. The current session could not complete browser smoke because existing user-inspection services were already bound to ports 8000/5174 while the duplicated `PATH`/`Path` environment prevented reliable parallel service startup on alternate ports.
- Verification passed: backend ruff passed, backend pytest returned `92 passed, 3 skipped`, focused golden-path/data-analysis tests returned `18 passed`, frontend lint passed, sandbox-external frontend tests returned `10 passed files / 30 tests`, and sandbox-external frontend build succeeded. The known Windows pytest temp cleanup `PermissionError` and PowerShell profile execution-policy warning still appear after successful commands.
- Next recommended slice: define the single-agent workbench event/state contract and start upgrading the center Agent workspace into an agent cockpit around the executable preprocessing flow.

## 2026-05-28 Agent Cockpit Workflow Update

- Continued the Codex-style Data/ML IDE direction by formalizing the first single-agent workbench event/state contract on the frontend.
- Extended `AgentStreamEvent` with future orchestrator events: `stage_started`, `stage_completed`, `tool_started`, `approval_required`, `component_requested`, `step_failed`, `step_completed`, and `task_resumed`.
- Added `workflowState.ts`, a pure state derivation layer that maps both existing artifact/progress/tool events and future typed events onto the workflow phases: ingest, profile, clean, transform, train, evaluate, diagnose, export, and learn.
- Upgraded the center `AgentWorkspace` with a first-pass workflow cockpit showing the phase timeline, current step, next action, pending approval checkpoint, requested component, and latest artifact context.
- Connected the executable preprocessing flow to the new contract: plan generation now emits component and approval events, while plan execution emits transform completion plus a planned-dataset component request for training handoff.
- Updated log and tool-activity helpers so new typed events remain visible and searchable without breaking the current legacy WebSocket event stream.
- Added focused workflow-state tests for default state, preprocessing approval, planned-dataset training handoff, explicit orchestrator events, and failure visibility.
- Browser DOM QA passed at `http://127.0.0.1:5174/?mode=analysis`: the cockpit rendered 9 stages, the active ingest state was visible, page-level horizontal overflow was absent, and console warnings/errors were empty. The phase strip intentionally keeps local horizontal scroll for readability in the narrow center column.
- Verification passed: `npm.cmd run lint`, sandbox-external `npm.cmd test -- --run` returned `11 passed files / 35 tests`, and sandbox-external `npm.cmd run build` succeeded. Sandboxed Vitest/build still hit the known Windows parent-directory access issue; sandbox-external commands still print the known PowerShell profile execution-policy warning after success.
- Temporary local services were started for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.
- Next recommended slice: add the frontend component registry and render the first real inline cockpit cards for data quality, preprocessing approval/execution, planned dataset handoff, and training configuration; after that, replace the hardcoded WebSocket analysis flow with the intent-aware agent orchestrator.

## 2026-05-30 Cockpit Component Registry Update

- Continued the Codex-style Data/ML IDE direction with the project frontend optimization skill.
- Added a typed frontend cockpit component registry that maps existing artifacts and future `component_requested` events into inline data/ML cards.
- Wired the registry into the center `AgentWorkspace`; the cockpit now renders real cards for Data Quality, Preprocessing Plan, Planned Dataset, and Training Configuration instead of only textual requested-component summaries.
- Connected cockpit card actions to AppShell workflow callbacks: Generate Profile, Generate Plan, Open Plan, Execute/Re-run Plan, Open Dataset, Open Training, and Start sklearn now call the same real APIs and state transitions as the right-panel tools.
- Updated file-tree and search selection to use the canonical project-file selection handler, keeping dataset path and selected preprocessing-plan path synchronized across the left rail, center cockpit, and right inspector.
- Browser QA found that the default three-row churn sample produced an empty preprocessing plan because unique numeric columns (`age`, `income`) were treated as identifier-like drops.
- Hardened preprocessing-plan drop heuristics: explicit ID-like names such as `customer_id` still drop, but tiny-sample numeric features are no longer dropped only because every value is unique.
- Added backend coverage for the default sample plan/execution path; the generated plan now keeps `age` and `income`, and execution writes a planned dataset with both feature columns plus `churn`.
- Verification passed: backend ruff, backend pytest `94 passed, 3 skipped`, focused data-analysis tests `19 passed`, frontend lint, sandbox-external frontend tests `12 files / 39 tests`, sandbox-external frontend build, and browser DOM QA on `http://127.0.0.1:5174/?mode=analysis&file=data/customer_churn.csv`.
- Browser QA confirmed Generate Profile -> Generate Plan -> Execute Plan works from the center cockpit, creates `customer_churn_planned.csv`, renders Planned Dataset and Training Configuration cards, has no console warnings/errors, and has no page-level horizontal overflow.
- Temporary local services are running for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.
- Next recommended slice: replace the hardcoded WebSocket analysis flow with an intent-aware backend orchestrator and implement the first natural-language golden path for "analyze this dataset and prepare it for modeling" using typed stage/tool/artifact/approval/component events.

## 2026-05-30 Agent Orchestrator Golden Path Update

- Replaced the hardcoded WebSocket analysis implementation with a thin transport layer backed by `AgentOrchestrator`.
- The orchestrator now classifies two first intents: legacy analysis overview and natural-language modeling preparation.
- The legacy analysis path still emits and persists the existing profile/missing/correlation/distribution artifacts, rule matches, extracted lessons, assistant message, and task progress events.
- Added the first natural-language golden path for `Analyze this dataset and prepare it for modeling`: the agent profiles data quality, generates `preprocessing_plan.json`, emits an approval checkpoint, creates the reproducible pipeline script, executes the transform, writes `customer_churn_planned.csv`, writes JSON/Markdown transformation reports, and requests cockpit components for data quality, preprocessing plan, planned dataset, and training configuration.
- Added backend WebSocket coverage proving the typed event sequence, persisted trace continuity, generated artifacts, component requests, and transformed dataset contents.
- Tightened the frontend cockpit component registry so transformation reports no longer overwrite the canonical `preprocessing_plan.json` path used by the plan and training cards.
- Browser QA passed on `http://127.0.0.1:5174/?mode=analysis&file=data/customer_churn.csv`: sending `Analyze this dataset and prepare it for modeling` produced four cockpit cards, a planned dataset handoff, a training configuration card with the correct preprocessing plan path, and no visible error alerts.
- Verification passed: backend ruff, full backend pytest `95 passed, 3 skipped`, focused WebSocket/session tests `8 passed`, focused golden/data-analysis tests `12 passed`, frontend lint, frontend tests `12 files / 39 tests`, focused component-registry tests `4 passed`, frontend build, and browser DOM QA.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, and sandboxed Vite/Vitest/build still need sandbox-external execution because esbuild probes a denied parent path.
- Temporary local services are running for inspection on `http://127.0.0.1:8000` and `http://127.0.0.1:5174`.
- Follow-up target from this slice: true pause/resume approval is addressed in the Approval Resume Update below; the remaining orchestrator work is retry/failure recovery and durable task-state persistence.

## 2026-05-30 Approval Resume Update

- Converted the modeling-prep approval checkpoint from a rendered event into a true paused workflow.
- The first natural-language modeling-prep pass now profiles the dataset, generates `preprocessing_plan.json`, writes the reproducible preprocessing script, emits `approval_required`, renders the preprocessing-plan cockpit card, and stops before writing the planned dataset.
- Added pending approval persistence under the project session state so the orchestrator can resume with the original dataset path even if the UI is currently previewing `preprocessing_plan.json`.
- Added WebSocket `approval_response` handling; approving the cockpit card emits `approval_resolved` and `task_resumed`, executes the stored preprocessing plan, writes the planned CSV plus JSON/Markdown transformation reports, and requests Planned Dataset and Training Configuration cards.
- Added frontend approval response wiring from the center cockpit: the preprocessing-plan card now shows `Approve & Execute` while paused and sends the approval decision over the same session WebSocket instead of calling the REST execution endpoint directly.
- Updated workflow-state, component-registry, and log formatting support for `approval_resolved` so the cockpit clears the pending approval and logs the decision.
- Focused browser QA passed on a fresh session at `http://127.0.0.1:5174/?mode=analysis&file=data/customer_churn.csv&projectId=f6250690f25744229887f3c3cc0bc369&sessionId=985cd5e4e9d04ab4952568cb257f7131`: before approval the UI showed the pause state and `Approve & Execute` with no planned dataset/training config; after approval it showed `customer_churn_planned.csv` and Training Configuration with no visible errors.
- Verification passed: backend `py_compile`, backend ruff, focused WebSocket/session tests `5 passed`, focused backend golden/data-analysis/session tests `15 passed`, frontend lint, focused frontend tests `3 files / 15 tests`, frontend build, and browser DOM QA. The known Windows pytest temp cleanup warning and sandboxed Vite/Vitest/build limitation still apply.
- Next recommended slice: add retry/failure recovery and richer durable task-state persistence, including stale approval detection, decline/revise handling in the cockpit, and user-visible retry/resume controls for failed transform or training steps.

## 2026-05-30 Approval Revision and Failure Recovery Update

- Continued the orchestrator reliability work by making the non-execute approval branch product-usable instead of a dead end.
- Added explicit `Revise Plan` cockpit action for pending preprocessing approvals; selecting it sends `approval_response(decision=revise)` over the session WebSocket.
- Backend revision handling now deletes the pending approval, emits persisted `approval_resolved(decision=revise)` and `step_failed(stage=transform)` events, and prevents the same approval id from being executed later by returning `approval_not_found`.
- Added first-pass stale approval handling before active-file CSV resolution, so handled approval ids return the correct stale-approval error even when the UI is currently previewing `preprocessing_plan.json`.
- Wrapped approved preprocessing execution failures into structured events: `tool_call_finished(status=error)`, `step_failed`, and `task_progress("Preprocessing execution failed")`, keeping the WebSocket stream alive for recovery UI.
- Updated workflow-state derivation so failed stages take precedence over later active/learn events and declined approvals do not recreate synthetic approval checkpoints from existing plan artifacts.
- Updated the preprocessing-plan cockpit card so a revised/failed transform shows `Preprocessing plan needs revision` with `Refresh Plan`, instead of leaving a stale `Approve & Execute` path visible.
- Browser QA passed on a fresh session at `http://127.0.0.1:5174/?mode=analysis&file=data/customer_churn.csv&projectId=f6250690f25744229887f3c3cc0bc369&sessionId=d26ce06f76b84251ace219c861dd7552`: before revision the cockpit showed `Approve & Execute` and `Revise Plan`; after `Revise Plan`, it showed revision state plus `Refresh Plan`, no synthetic approval, no planned dataset, no training config, and no traceback.
- Verification passed: backend `py_compile`, backend ruff, focused WebSocket/session tests `6 passed`, focused backend WebSocket/session/golden/data-analysis tests `21 passed`, frontend lint, focused frontend tests `3 files / 18 tests`, frontend build, and browser DOM QA. Known Windows pytest temp cleanup and PowerShell profile warnings still appear after successful commands.
- Next recommended slice: add explicit retry/resume controls and richer durable task-state persistence for failed transform/training steps, then extend the same recovery model beyond preprocessing approvals.

## 2026-05-30 Transform Retry Resume Update

- Completed the first durable retry/resume slice for failed approved preprocessing execution.
- Backend approved-transform failures now write `sessions/<session_id>/task_state/transform.json` with the original dataset path, preprocessing plan path, project id, mode, retry count, status, timestamps, and last error.
- Added WebSocket `resume_step(stage="transform")`; the orchestrator restores the original dataset context from task state, emits `task_resumed("Retrying transform step")`, reruns the saved preprocessing plan, and clears the task-state file after successful recovery.
- `step_failed` events now carry retry metadata (`retryable`, `resume_stage`, `retry_count`) so the frontend can distinguish a recoverable execution failure from a user-requested revision.
- The cockpit preprocessing-plan card now shows `Transform execution failed` with `Retry Transform` plus `Refresh Plan` for retryable failures, while revised/declined approvals still show `Preprocessing plan needs revision` with only the safer refresh path.
- Fixed workflow-state edge cases found during browser QA: failed transform progress no longer clears failure state, planned datasets are classified by filename/path before metadata references to `preprocessing_plan.json`, and learning side-effect events no longer steal the main workflow stage after transform hands off to training.
- Browser QA passed on fresh session `dd4d143571a74842ad907216f94d68cf`: generated preprocessing approval, intentionally corrupted the plan artifact to force execution failure, confirmed the cockpit showed `Transform execution failed` and `Retry Transform`, repaired the plan, clicked Retry, produced `customer_churn_planned.csv`, rendered Planned Dataset and Training Configuration cards, and confirmed the durable transform task-state file was removed after success.
- Verification passed: backend `py_compile`, backend ruff, full backend pytest `97 passed, 3 skipped`, focused WebSocket/session tests `7 passed`, frontend lint, frontend tests `12 files / 47 tests`, frontend build, and browser DOM QA. Known Windows pytest temp cleanup and PowerShell profile execution-policy warnings still appear after successful commands.
- Next recommended slice: extend this recovery model to training/evaluation steps, add user-visible task-state/log inspection for failed steps, and define retry policies for when to rerun from saved state versus regenerate the upstream plan.

## 2026-06-01 Training Retry State and Data/ML Agent Roadmap Update

- Continued the Codex-style Data/ML IDE direction by extending durable recovery from transform into sklearn training.
- Added a shared backend task-state service for `sessions/<session_id>/task_state/<stage>.json`, preserving created/updated timestamps and giving transform/training recovery the same persistence shape.
- Added `/api/projects/{project_id}/ml/resume-sklearn`; it loads saved `train` task state, validates that the failed run was a sklearn training task, reconstructs the original dataset/target/GPU/preprocessing-plan request, increments retry count, reruns training, and clears state after success.
- Sklearn training failures now persist `task_state/train.json` for recoverable execution failures, including kernel/runtime `RuntimeError`, validation `ValueError`, GPU timeout/cancel, and Windows `OSError`/`PermissionError` process-launch failures.
- The center cockpit now treats failed sklearn training as a retryable train-stage failure: the training card changes to `Training execution failed`, keeps dataset/target/plan context visible, and exposes `Retry Training` instead of silently returning to `Start sklearn`.
- Workflow-state handling now preserves retry metadata even when a generic error event follows a typed `step_failed(train)` event, so the cockpit does not accidentally erase the recoverable state.
- Browser QA passed on `http://127.0.0.1:5174/?projectId=fb31c66115d24d26af355b1d8cba72a7&sessionId=5d8f38f5f4db45358d07ec483b7e3d43&file=data/train_retry.csv&mode=machine-learning`: clicking `Start sklearn` produced a structured train failure, wrote `task_state/train.json`, and rendered the center cockpit card with `Training execution failed` plus `Retry Training`.
- Verification passed: backend `py_compile`, backend ruff, focused backend ML API tests `9 passed`, frontend lint, frontend tests `12 files / 48 tests`, frontend build, and browser DOM QA. Known Windows pytest temp cleanup and sandboxed Vite/esbuild limitations still apply.
- Updated `task_plan.md` with a more detailed Data/ML Code Agent IDE roadmap: durable workflow recovery, richer task-state inspection, orchestrator expansion, contextual components, editable preprocessing/feature workflows, diagnosis actions, provenance, data-source adapters, export bundles, and end-to-end golden-path coverage.
- Next recommended slice: rehydrate durable failed task state into the cockpit after reload/session reopen, add a task-state/log inspector for failed stages, then extend resume/retry to evaluation, report export, and learning-rule extraction.

## 2026-06-01 Task-State Rehydration Update

- Completed the next durable recovery slice: failed task state can now be queried from session state and rehydrated into the center cockpit after a page reload or session reopen.
- Added `GET /api/sessions/{session_id}/task-states`; it returns the persisted `sessions/<session_id>/task_state/*.json` records with injected `session_id` and newest-first ordering.
- Added frontend task-state mapping so failed durable states become typed workflow failure events. A saved sklearn train failure now restores the `Train` failed stage, dataset, target column, preprocessing-plan context, retry count, and `Retry Training` action without rerunning training.
- Updated AppShell training flows so sklearn training and resume calls use the active session id instead of the legacy `manual-training` fallback, then refresh durable task state after training success/failure and retry success/failure.
- Browser QA passed on `http://127.0.0.1:5174/?projectId=fb31c66115d24d26af355b1d8cba72a7&sessionId=5d8f38f5f4db45358d07ec483b7e3d43&file=data/train_retry.csv&mode=machine-learning`: after a backend sklearn process-launch failure wrote `task_state/train.json`, reloading the page restored `Training execution failed` and `Retry Training` from persisted session task state.
- Verification passed: backend `py_compile`, backend ruff, focused backend session/ML tests `20 passed`, frontend lint, frontend tests `13 files / 52 tests`, frontend build, and browser DOM QA. Known Windows pytest temp cleanup and PowerShell profile execution-policy warnings still appear after successful commands.
- Next recommended slice: add a task-state/log inspector for failed stages, expose saved inputs/retry policy/repair hints in the cockpit, and extend the same durable resume model to evaluation, report export, and learning-rule extraction.

## 2026-06-01 Failed Task Inspector Update

- Completed the next cockpit reliability slice: failed durable task state now renders an inline `Train failure inspector` / stage failure inspector card above the retry action.
- Added a frontend task-state inspection model that turns persisted failed state plus related session events into saved inputs, stage, dataset, target, plan, engine, GPU flag, retry count, last error, related-log count, latest log, and a concrete next recovery recommendation.
- Wired the inspector through the center cockpit component registry. Failed training still shows `Retry Training`, while the new inspector makes the saved retry state and recovery rationale visible before the user retries.
- Added `Inspect Logs` from the inspector card. It opens the right-side log panel and filters it to the failed task id, so the user lands directly on the related `step_failed` event instead of hunting through the event stream.
- Browser QA passed on `http://127.0.0.1:5174/?projectId=fb31c66115d24d26af355b1d8cba72a7&sessionId=5d8f38f5f4db45358d07ec483b7e3d43&file=data/train_retry.csv&mode=machine-learning`: the cockpit displayed saved dataset `data/train_retry.csv`, target `churn`, engine `sklearn`, retry count `0`, `[WinError 5] 拒绝访问。`, next recovery guidance, `Inspect Logs`, and `Retry Training`; clicking `Inspect Logs` opened the log panel filtered to the current task.
- Verification passed: focused frontend tests `4 files / 19 tests`, full frontend tests `14 files / 56 tests`, frontend lint, TypeScript `tsc --noEmit`, production build, and browser DOM QA. The first sandboxed build still hit the known Windows Vite/esbuild parent-directory permission issue; sandbox-external build passed.
- Next recommended slice: extend durable retry/resume from training into evaluation, report export, and downstream learning-rule extraction, using the inspector card as the user-facing recovery surface.

## 2026-06-01 Codex-Style Data/ML IDE Planning Update

- Synchronized the user's updated product concept into `task_plan.md`: MLAgent should become a Codex-style IDE panel specialized for data analysis and machine learning.
- Clarified the target interaction model: the center workspace is the natural-language agent cockpit, while data/ML tools appear as stage-specific inline components and contextual inspector views during ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn.
- Added explicit product commitments for agent-owned workflow state, typed tool invocation, durable retry/resume, human approval, reproducible handoff bundles, and provenance across messages, tool calls, artifacts, runs, reports, logs, and learned rules.
- Expanded the Data/ML Code Agent IDE roadmap with new objectives for agent command-language routing, typed/inspectable tool calls, contextual right-panel inspection, and end-to-end golden-path verification.
- Added a phase plan:
  - Phase A: reliability-first agent runtime for evaluate/export/learn retry and "continue from last failure".
  - Phase B: full workflow router for ingest/profile/clean/transform/train/evaluate/diagnose/iterate/export/learn.
  - Phase C: contextual data/ML components for feature selection, preprocessing editing, transform diff, training, evaluation, report export, and learned-rule review.
  - Phase D: IDE context inspector and provenance linking.
  - Phase E: verified browser/API golden path for the full natural-language data/ML workflow.
- Updated near-term implementation targets so the next concrete slice remains evaluation/report retry and resume, followed by export/learn recovery, orchestrator intent expansion, richer cockpit components, contextual inspector work, provenance, and full golden-path QA.
- No code changed in this planning update; no tests were required.

## 2026-06-01 Evaluation Report Retry Update

- Completed the next durable recovery slice for evaluation/report regeneration.
- Added backend evaluation-report APIs for existing experiment runs: `POST /api/projects/{project_id}/ml/runs/{experiment_id}/evaluation-report` regenerates the Markdown evaluation report from persisted run artifacts, and `POST /api/projects/{project_id}/ml/resume-evaluation` resumes from saved `task_state/evaluate.json`.
- Recoverable evaluation/report failures now persist `sessions/<session_id>/task_state/evaluate.json` with experiment id, dataset, target, engine, metrics path, model path, retry count, and last error. Successful regeneration clears the evaluate task state and updates the experiment run with the new report artifact.
- Added frontend API helpers, durable task-state mapping, and inspector facts for evaluation failures. The center cockpit now shows `Evaluate failure inspector`, saved experiment/metrics context, `Retry Evaluation`, `Inspect Logs`, and artifact navigation.
- Added a right-panel training-detail action for `Regenerate Report`, so users can refresh a model evaluation report directly from the selected experiment run, not only after a failure.
- Browser QA confirmed a real session-level `task_state/evaluate.json` rehydrates into the machine-learning cockpit with `Evaluate failure inspector`, `Retry Evaluation`, the missing metrics path, the saved error, and the `Regenerate Report` action in training detail.
- Verification passed: backend focused ML/session tests `14 passed`, backend ruff on touched ML files, focused frontend cockpit/task-state tests `3 files / 18 tests`, full frontend tests `14 files / 59 tests`, frontend lint, TypeScript `tsc --noEmit`, production build, and `npm.cmd run smoke:deep-links`.
- The first sandboxed frontend build still hit the known Windows Vite/esbuild parent-directory permission issue; sandbox-external build passed. The bundled in-app Browser skill path is missing its `browser-client.mjs`, so browser QA used the same browser client from the bundled Chrome plugin plus the project's CDP smoke runner.
- Next recommended slice: extend the same durable recovery model to export bundles and downstream learning-rule extraction, then harden retry policy metadata with repair hints, stale artifact checks, and abandon/regenerate choices.

## 2026-06-02 Export and Learning Recovery Update

- Completed the next durable recovery slice for model handoff export bundles and downstream learning-rule extraction.
- Added backend export bundle APIs: `POST /api/projects/{project_id}/ml/runs/{experiment_id}/export-bundle` writes a zip handoff bundle with `manifest.json`, model, metrics, evaluation report, and optional prediction/preprocessing artifacts; `POST /api/projects/{project_id}/ml/resume-export` resumes from saved `task_state/export.json`.
- Recoverable export failures now persist experiment id, dataset, target, engine, metrics/model/report paths, retry count, and last error. Successful export clears the export task state and updates the experiment run with an `archive` artifact.
- Added durable learning recovery around session lesson extraction. Failed extraction writes `task_state/learn.json`; `POST /api/projects/{project_id}/evolution/lessons/resume-extraction` retries from the saved session source and clears state after successful lesson creation.
- Frontend API/types now include export bundles and learning resume. The center cockpit inspector supports `Retry Export` and `Retry Learning`, including report/source context, while the Evolution Knowledge workspace shows a dedicated learn recovery strip with `Retry Learning` and `Inspect Logs`.
- The training detail panel now includes `Export Bundle`; completed bundles appear as downloadable artifact rows instead of trying to preview the zip as text.
- Deep-link browser smoke now seeds export/learn retry states and asserts the visible recovery controls: export failure inspector, `Retry Export`, `Open Report`, `Export Bundle`, `Extract Lessons`, and `Retry Learning`.
- Verification passed: backend focused ML/evolution API tests `18 passed`, backend ruff on touched files, focused frontend task-state/cockpit tests `3 files / 23 tests`, full frontend tests `14 files / 64 tests`, frontend lint, TypeScript `tsc --noEmit`, and deep-link browser smoke.
- Next recommended slice: add explicit retry policy metadata and branch controls across retryable stages: repair hints, stale artifact detection, abandon, regenerate upstream, and "continue from last failure" intent routing.

## 2026-06-02 Codex-Style Data/ML IDE Plan Sync

- Synchronized the user's refined product concept into the project planning documents: MLAgent's target is a Codex-style IDE panel specialized for data analysis and machine learning, with the center conversation acting as the primary natural-language agent cockpit.
- Updated `task_plan.md` with detailed implementation milestones from M1 to M12:
  - M1 recovery policy hardening for repair hints, stale checks, abandon/regenerate choices, and "continue from last failure".
  - M2 full workflow intent router for ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, learn, retry, and continuation.
  - M3 structured agent command language for intent, context, missing information, risk, and planned tool chains.
  - M4 contextual cockpit components for stage-specific data/ML tools.
  - M5 interactive preprocessing and feature workflow.
  - M6 ML run cockpit for training, evaluation, diagnosis, export, and rerun operations.
  - M7 actionable diagnosis and iteration from model errors to concrete next steps.
  - M8 contextual inspector and provenance across artifacts, runs, reports, logs, graph nodes, and rules.
  - M9 safe project memory and learning loop.
  - M10 reproducible workflow handoff/export.
  - M11 richer data-source and tool-library expansion.
  - M12 end-to-end product QA.
- Added a stage component backlog to `task_plan.md` mapping ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn to expected UI components, triggers, required state, primary actions, and provenance outputs.
- Refined the near-term target list so the immediate implementation sequence is now: retry policy metadata, inspector branch controls, orchestrator intent expansion, structured context resolver, contextual cockpit components, ML iteration loop, contextual inspector, provenance foundation, workflow export, full golden path, and product QA loop.
- Updated `docs/project-progress.md` with the same high-level planning sync so the project progress archive reflects the new north-star direction and next execution order.
- This was a planning/documentation update only; no product code changed and no test run was required.

## 2026-06-03 Retry Policy Hardening Update

- Completed the M1 recovery policy hardening slice for the Codex-style Data/ML IDE plan.
- Added a shared backend recovery policy shape for durable task state. Failed transform, train, evaluate, export, and learn states now persist repair hints, stale input/artifact checks, resume action, regenerate-upstream action, abandon action, and stale artifact paths.
- Added `DELETE /api/sessions/{session_id}/task-states/{stage}` so the UI can abandon a saved retry state without deleting historical logs or generated artifacts.
- The center cockpit failed-stage inspector now prefers backend recovery policy over hardcoded guidance and shows `Repair`, `Stale check`, `Resume`, `Regenerate`, `Abandon`, and `Stale artifacts` facts.
- The inspector now exposes a real `Abandon State` action in addition to retry, inspect logs, and open artifact actions.
- The Evolution Knowledge learn recovery strip now mirrors the same recovery policy facts and includes `Abandon State`, so learning recovery remains usable when the center cockpit is not visible.
- Updated the deep-link smoke fixture to seed export/learn retry states with policy metadata and assert `Repair`, `Resume`, and `Abandon State` in the browser.
- Verification passed:
  - backend ruff on touched backend files,
  - backend focused tests `30 passed`,
  - frontend focused tests `2 files / 18 tests`,
  - full frontend tests `14 files / 64 tests`,
  - frontend lint,
  - TypeScript `tsc --noEmit`,
  - frontend production build,
  - `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError`, PowerShell prints the profile execution-policy warning after successful frontend commands, and the Vite dev server still needs sandbox-external execution when browser smoke requires local services.
- Next recommended slice: expand the backend orchestrator with natural-language intents for train, evaluate, diagnose, retry last failed step, export report, explain model behavior, and propose learned rules; include "continue from last failure" routing that reads the new recovery policy metadata.

## 2026-06-03 Continue From Last Failure Intent Update

- Completed the first M2 intent-router slice for the Codex-style Data/ML IDE plan.
- `AgentOrchestrator` now recognizes continuation prompts such as `continue from last failure`, `retry last failed step`, and the Chinese equivalents for continuing/retrying the last failed workflow step.
- The continuation path resolves project/session context without requiring the currently active file to be a CSV, reads persisted failed task state for transform, train, evaluate, export, or learn, and selects the newest recoverable failed stage.
- When a saved failed state exists, the WebSocket stream now emits typed recovery events: `tool_call_started`, `step_failed`, `component_requested(component="task_state_inspector")`, assistant message deltas, `tool_call_finished`, and `task_progress`.
- When no saved failed task state exists, the orchestrator returns a no-state assistant response and a `No saved failed task state` progress event instead of trying to run an unsafe default action.
- The frontend AppShell now refreshes durable task states when the backend requests the task-state inspector, so the center cockpit can render the persisted inspector with saved inputs, retry count, last error, and recovery policy actions after a natural-language continuation prompt.
- Added WebSocket tests for both the saved-failure path and the no-saved-state fallback, plus a component-registry test for the requested task-state inspector card.
- Verification passed: backend WebSocket tests `9 passed`, backend ruff on touched backend files, focused frontend component-registry tests `13 passed`, full frontend tests `14 files / 65 tests`, frontend lint, TypeScript `tsc --noEmit`, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, PowerShell still prints the profile execution-policy warning, and Vite dev-server startup still needs sandbox-external execution for browser smoke in this Windows session.
- Next recommended slice: add train/evaluate/diagnose/export/learn natural-language intent handlers and then upgrade continuation from "surface safest recovery choice" to "execute safe resume/regenerate/abandon branch after confirmation".

## 2026-06-03 Train Intent Router Update

- Completed the next M2 intent-router slice: natural-language training prompts now route to a typed train-stage configuration flow.
- `AgentOrchestrator` now distinguishes explicit training requests such as `train sklearn`, `start sklearn training`, baseline/classifier/regressor prompts, and Chinese training variants from broader modeling-prep prompts.
- The training intent resolves project/session context, training dataset path, target column, and optional preprocessing-plan path. It can infer `churn`/target-like columns from CSV headers and can recover dataset/target context when the active file is `preprocessing_plan.json`.
- The WebSocket stream now emits `tool_call_started`, `stage_started(train)`, `component_requested(component="training_config")`, assistant message deltas, `tool_call_finished`, and `task_progress("Training configuration ready")` instead of immediately running a model.
- The frontend message context now sends training dataset, target column, and preprocessing-plan path to the backend, so natural-language prompts keep the same selected context as visible training controls.
- The cockpit component registry now reads `training_config.props` for dataset, target, and plan. The `Start sklearn` card action carries those values through to the real training API, preventing stale AppShell state from training the wrong file.
- Added browser smoke coverage for the natural-language flow: open a machine-learning session on a preprocessing plan, submit `start sklearn training from this plan`, and assert the center cockpit renders a real Training Configuration card with dataset, target, plan, `Start sklearn`, and progress state.
- Verification passed: backend WebSocket tests `11 passed`, backend ruff on touched backend files, focused frontend component-registry tests `14 passed`, full frontend tests `14 files / 66 tests`, frontend lint, TypeScript `tsc --noEmit`, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, PowerShell still prints the profile execution-policy warning, and Vite dev-server startup still needs sandbox-external execution for browser smoke in this Windows session.
- Next recommended slice: add natural-language evaluate/report intent routing for selected experiment runs, then extend diagnose/export/learn intents and confirmation-based branch execution.

## 2026-06-04 Evaluate Report Intent Router Update

- Completed the next M2 intent-router slice: natural-language evaluation/report prompts now route to a typed evaluate-stage cockpit flow.
- `AgentOrchestrator` now recognizes evaluation/report prompts such as `evaluate this model`, `evaluation report`, `compare models`, model-report prompts, and Chinese evaluation/report variants without treating broad modeling prompts as evaluation.
- The evaluation intent resolves project/session context plus the selected `experiment_id` from the cockpit message context. If no run is selected, it falls back to the latest completed experiment run.
- The WebSocket stream now emits `tool_call_started`, `stage_started(evaluate)`, `component_requested(component="model_comparison")`, `component_requested(component="evaluation_report")`, assistant message deltas, `tool_call_finished`, and `task_progress("Evaluation context ready")`.
- The frontend message context now sends the focused experiment id to the backend. The center cockpit reads evaluation/report props for experiment id, dataset, target, best model, metrics path, model path, report path, prediction samples, and preprocessing plan.
- The cockpit now renders real `Model comparison` and `Evaluation report` cards with `Open Training`, `Open Metrics`, `Open Report`, and `Regenerate Report` actions. `Regenerate Report` calls the existing evaluation-report API from the center cockpit.
- Browser smoke now includes a natural-language evaluate-intent check: deep-link to a focused ML experiment/report, submit `evaluate this model and show the report`, and assert the model-comparison and evaluation-report cards render with the selected experiment, report, dataset, regenerate action, and progress state.
- Verification passed: backend WebSocket tests `13 passed`, backend ruff, focused component-registry tests `15 passed`, full frontend tests `67 passed`, frontend lint, TypeScript `tsc --noEmit`, production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, PowerShell still prints the profile execution-policy warning, and Vite dev-server startup still needs sandbox-external execution for browser smoke in this Windows session.
- Next recommended slice: add diagnose/export/learn natural-language intent handlers, then connect confirmation-based continuation branches to real resume, regenerate, export, abandon, and learned-rule proposal flows.

## 2026-06-04 Diagnose Intent Router Update

- Completed the next M2 intent-router slice: natural-language diagnosis, error-slice, confusion-matrix, recall/precision, and prediction-sample prompts now route to a typed diagnose-stage cockpit flow.
- `AgentOrchestrator` resolves the selected `experiment_id` from cockpit message context, or falls back to the latest completed experiment run when no run is selected.
- Diagnosis intent derives class-level error slices from the saved confusion matrix, including worst class, main confusion direction, total error rows, and a recommendation that points the user toward prediction samples and feature/preprocessing review.
- The WebSocket stream now emits `tool_call_started`, `stage_started(diagnose)`, `component_requested(component="error_analysis")`, `component_requested(component="prediction_samples")`, assistant message deltas, `tool_call_finished`, and `task_progress("Diagnosis context ready")`.
- The center cockpit now renders real `Error analysis` and `Prediction samples` cards from backend props, including experiment id, dataset, worst class, main confusion, error rows, slice count, metrics path, report path, and prediction samples path.
- Card actions are wired to existing product surfaces: `Open Metrics`, `Open Report`, `Open Samples`, and `Open Diagnostics` / training detail.
- Browser smoke now includes a natural-language diagnose-intent check: deep-link to a focused ML experiment/report, submit `diagnose why recall is poor and show prediction samples`, and assert the error-analysis and prediction-sample cards render with the selected experiment, samples, confusion direction, action, and progress state.
- Verification passed: backend WebSocket tests `15 passed`, backend ruff, focused component-registry tests `16 passed`, full frontend tests `68 passed`, frontend lint, TypeScript `tsc --noEmit`, production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, PowerShell still prints the profile execution-policy warning, and Vite dev-server startup still needs sandbox-external execution for browser smoke in this Windows session.
- Next recommended slice: add export/report-bundle and learned-rule proposal natural-language intents, then connect confirmation-based continuation branches to real resume, regenerate, export, abandon, and learned-rule proposal flows.

## 2026-06-04 Data/ML Code Agent IDE Plan Table Update

- Wrote the user's latest concept into the project planning table: MLAgent should become a Codex-like IDE panel for end-to-end data analysis and machine learning.
- Clarified that the center conversation is the primary agent cockpit, while dedicated components appear as the workflow reaches ingest, profile, clean, transform, train, evaluate, diagnose, iterate, export, and learn phases.
- Added `Latest User Concept Goal Table` to `task_plan.md` with 13 follow-up goals:
  - complete the natural-language workflow router,
  - define the structured agent command language,
  - make the center cockpit the main IDE work surface,
  - expand stage-specific data/ML components,
  - turn preprocessing into an interactive feature workflow,
  - make ML experiments feel like IDE runs,
  - make diagnosis actionable,
  - convert the right panel into a contextual inspector,
  - build artifact provenance as the product spine,
  - produce reproducible workflow handoffs,
  - keep learning safe and reviewable,
  - expand sources and the tool library,
  - verify the full code-agent experience with deterministic browser/API golden paths.
- Updated the current phase checklist in `task_plan.md` so this planning synchronization is recorded as completed.
- This was a documentation/planning update only; no product code changed and no tests were required.

## 2026-06-04 Export and Learn Intent Router Update

- Completed the next M2 intent-router slice: natural-language export/handoff prompts and learned-rule proposal prompts now route to typed cockpit flows.
- `AgentOrchestrator` now recognizes export prompts such as `export bundle`, `export report`, `handoff bundle`, Chinese export/package variants, and learned-rule prompts such as `extract lessons`, `propose learned rules`, project-memory variants, and Chinese experience/rule extraction variants.
- Export intent resolves the selected or latest completed experiment run, checks model/metrics/report artifact readiness, and emits `stage_started(export)`, `component_requested(component="evaluation_report")`, and `component_requested(component="export_bundle")` with experiment, dataset, target, metrics, model, report, prediction-sample, preprocessing-plan, existing-bundle, readiness, and missing-artifact context.
- Learn intent resolves the current project/session, reads persisted session events, runs the existing `LessonExtractor` as a non-mutating preview, and emits `stage_started(learn)` plus `component_requested(component="lesson_review")` with source-session id, evidence-event count, candidate count, high-confidence count, latest event type, source artifacts, and extractability status.
- The center cockpit now renders real export and learned-rule review cards. Export cards expose `Open Bundle` / `Open Report`, `Export Bundle`, `Open Training`, and artifact checklist actions. Learn cards expose `Extract Lessons` and `Open Evidence` actions while preserving human review before rule adoption.
- `AgentWorkspace` now wires `Export Bundle` to the existing run export API and `Extract Lessons` to the existing session lesson extraction API. Duplicate card action React keys were hardened by including the action index.
- Browser smoke now includes natural-language export and learn intent checks, and the smoke fixture seeds a source-session `missing.json` evidence artifact for the learn card.
- Verification passed: backend WebSocket tests `17 passed`, backend ruff on touched backend files, focused component-registry tests `18 passed`, full frontend tests `70 passed`, frontend lint, TypeScript/build via `npm.cmd run build`, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest still prints the post-success temp cleanup `PermissionError`, PowerShell still prints the profile execution-policy warning, and Vite dev-server startup still needs sandbox-external execution for browser smoke in this Windows session.
- Next recommended slice: add remaining ingest/profile/clean/transform/iterate natural-language intents, then connect confirmation-based continuation branches to real resume, regenerate, export, abandon, and learned-rule proposal flows after user confirmation.

## 2026-06-06 Profile Clean Transform Iterate Intent Router Update

- Completed the next M2 intent-router slice for profile, clean, transform, and iterate natural-language prompts.
- `AgentOrchestrator` now routes profile/data-quality prompts to a typed `profile` flow that generates `data_quality_profile.json` and requests the `data_quality` cockpit component with dataset, profile path, row/column counts, and target candidates.
- Clean/safe-fix prompts now route to a non-mutating `clean` flow: it profiles the dataset, requests the data-quality review, and requests a safe preprocessing-plan handoff with planned actions and required confirmation before any dataset is changed.
- Transform/preprocessing-plan prompts now route directly to a `transform` flow that generates `preprocessing_plan.json` plus its pipeline script, persists a pending approval, emits `approval_required`, and requests the `preprocessing_plan` cockpit component without executing the transform.
- Iterate/improve-recall prompts now resolve the selected or latest experiment run, summarize diagnostics from the confusion matrix, and request an `iteration_proposal` cockpit card with metrics/report/samples paths, worst class, main confusion, recommendation, and review-before-retrain actions.
- The frontend workflow model now includes the `iterate` stage, and the cockpit component registry renders a real `iteration_proposal` card using existing `Open Metrics`, `Open Report`, `Open Samples`, `Open Plan`, and `Open Training` actions.
- Verification passed: focused backend intent tests `4 passed`, full backend WebSocket tests `21 passed`, backend ruff on touched backend files, focused frontend component/workflow tests `31 passed`, full frontend tests `72 passed`, frontend lint, production build, and `npm.cmd run smoke:deep-links` after starting local backend/frontend services outside the sandbox.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError`, PowerShell prints the profile execution-policy warning, and local Vite startup requires sandbox-external execution in this Windows session.
- Next recommended slice: add the remaining ingest intent and then connect confirmation-based continuation branches to real resume/regenerate/abandon execution where the backend contract is complete.

## 2026-06-06 Confirmed Abandon Branch Update

- Rechecked the current backend WebSocket baseline and found ingest intent already implemented and covered: `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_websocket_session.py -q` initially returned `22 passed`.
- Completed the next P0 recovery-control slice: natural-language prompts such as `abandon last failure`, `clear last failure`, and Chinese clear/abandon failure variants now route to `abandon_last_failure`.
- `AgentOrchestrator` now resolves project/session context without requiring the active file to be a CSV, selects the newest durable failed task state, deletes that saved retry state, emits `step_completed`, `tool_call_finished`, assistant message deltas, and `task_progress`, and preserves historical messages, events, logs, artifacts, and previous `step_failed` records.
- Added a WebSocket contract test that seeds a failed training task state, sends `abandon last failure`, verifies the `task_state/train` deletion, checks persisted event history, and confirms the user message metadata records `intent=abandon_last_failure`.
- Updated `task_plan.md` so the full workflow router reflects implemented ingest/profile/clean/transform/train/evaluate/diagnose/iterate/export/learn routing, and so the next recovery work points to structured command output plus direct resume/regenerate branches.
- Verification passed: focused WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff on touched backend files, frontend tests `14 files / 73 tests`, frontend lint, and frontend production build. The known Windows pytest post-success temp cleanup `PermissionError` still appears, with command exit code 0; PowerShell still prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: add structured command/context resolver output for router decisions, then implement confirmed regenerate-upstream and additional direct resume branches where the saved backend contracts are complete.

## 2026-06-06 Structured Train Command Update

- Completed the first M3 structured Agent Command / Context Resolver slice for natural-language training requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before the train-stage `training_config` component request. The command records intent, dataset path, optional dataset version, target column, selected artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, and component requests.
- Plan-backed training prompts now include the selected preprocessing plan in both `selected_artifacts` and `resolved_context`, keeping the command contract aligned with the card props that launch sklearn.
- Frontend stream types now include `agent_command`; workflow state uses it to show the interpreted train step, and the log view formats/searches the command and resolved context.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow/log tests `18 passed`, full frontend tests `14 files / 75 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: extend `agent_command` to evaluate/diagnose/export/learn and then add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Evaluate Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language evaluation/report requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before evaluate-stage `model_comparison` and `evaluation_report` component requests.
- The evaluate command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, and component requests.
- The resolved context records project id, mode, experiment id, dataset, target, metrics path, model path, evaluation report path, prediction samples path, and preprocessing plan path so report cards and logs share the same provenance context.
- Frontend workflow-state coverage now asserts that evaluate commands activate the report-review step before cards arrive; existing log formatting/search handles the generic command payload.
- Updated `task_plan.md` so M3 tracks train plus evaluate command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, full frontend tests `14 files / 76 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: extend `agent_command` to diagnose/export/learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Diagnose Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language diagnosis/error-sample requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before diagnose-stage `error_analysis` and `prediction_samples` component requests.
- The diagnose command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, component requests, and a compact diagnosis summary.
- The resolved context records project id, mode, experiment id, dataset, target, metrics path, model path, evaluation report path, prediction samples path, preprocessing plan path, worst class, main confusion, error count, and recommendation so diagnosis cards can be audited back to the selected run.
- Frontend command typing now allows an optional `diagnosis_summary`, and workflow-state coverage asserts that diagnose commands activate the error-analysis step before diagnostic cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, and diagnose command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `15 passed`, full frontend tests `14 files / 77 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`. After adding model artifact provenance to the diagnose command, focused backend WebSocket tests, backend ruff, focused workflow-state tests, and frontend production build were rerun successfully.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: extend `agent_command` to export/learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Export Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language export/handoff requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before export-stage `evaluation_report` and `export_bundle` component requests.
- The export command records intent, dataset path, optional dataset version, target column, selected experiment run, selected metrics/model/report/prediction-sample/preprocessing/export-bundle artifacts, missing context, risk level, planned steps, proposed tools, approval requirement, component requests, bundle readiness, and missing required artifacts.
- The resolved context records project id, mode, experiment id, dataset, target, metrics path, model path, evaluation report path, prediction samples path, preprocessing plan path, export bundle path, bundle readiness, and missing artifact list so the handoff cards can be audited back to the selected run and export prerequisites.
- Frontend command typing now allows optional export readiness fields, and workflow-state coverage asserts that export commands activate the reproducible handoff step before report/bundle cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, diagnose, and export command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `16 passed`, full frontend tests `14 files / 78 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: extend `agent_command` to learn and add missing-context prompts for ambiguous dataset/run selection.

## 2026-06-06 Structured Learn Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for natural-language learned-rule review requests.
- `AgentOrchestrator` now emits and persists an `agent_command` event before the learn-stage `lesson_review` component request.
- The learn command records intent, selected source artifacts, missing context, high risk level, planned learn step, proposed `lesson_review` tool, approval requirement, component request, source session id, source event count, candidate count, high-confidence count, and extractability state.
- The resolved context records project id, mode, source session id, source event count, candidate count, high-confidence count, latest event type, source artifacts, and extractability state so learned-rule proposals can be audited back to session evidence before any rule adoption.
- The command is explicitly non-mutating and `approval_required: true`; actual lesson extraction/adoption remains reviewable through the existing `lesson_review` and Evolution flows.
- Frontend command typing now allows optional learn/source-evidence fields, and workflow-state coverage asserts that learn commands activate the rule-review step before cards arrive.
- Updated `task_plan.md` so M3 tracks train, evaluate, diagnose, export, and learn command coverage.
- Verification passed: focused backend WebSocket tests `23 passed`, full backend tests `120 passed, 3 skipped`, backend ruff, focused frontend workflow-state tests `17 passed`, full frontend tests `14 files / 79 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: add missing-context prompts for ambiguous dataset/run selection and structured continuation commands.

## 2026-06-06 Ambiguous Run Selection Command Update

- Completed the next M3 structured Agent Command / Context Resolver slice for ambiguous experiment-run selection.
- `_resolve_evaluation_context` now distinguishes explicit `experiment_id`, unique active-file matches, explicit latest/recent/newest prompts, and ambiguous multi-run contexts. Clear selected-report or latest-run prompts still route deterministically.
- Ambiguous evaluate/diagnose/export prompts with multiple completed runs now emit and persist an `agent_command` with `missing_context: ["experiment_id"]`, `approval_required: true`, `candidate_runs`, planned component requests, and resolved project/mode/active-file context instead of silently choosing an arbitrary run.
- The ambiguous evaluate path now stops before `model_comparison` and `evaluation_report` cards, streams an assistant prompt asking the user to select an experiment run, and reports `Waiting for experiment run selection`.
- Frontend stream typing now includes `candidate_runs`, and workflow state marks command stages as `blocked` when `missing_context` is present so the cockpit can represent the missing run selection before cards arrive.
- Verification passed: backend WebSocket tests `24 passed`, full backend tests `121 passed, 3 skipped`, backend ruff on touched backend files, focused frontend workflow-state tests `20 passed`, full frontend tests `14 files / 82 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands. An initial frontend command was run from the repository root and failed because `package.json` lives under `frontend`; the same commands were rerun successfully from `frontend`.
- Next recommended slice: add the selectable run-response path from the cockpit into evaluate/diagnose/export continuation, then extend missing-context prompts to ambiguous dataset/train contexts and structured continuation commands.

## 2026-06-06 Run Selection Continuation Update

- Completed the next M3 vertical slice: ambiguous run selection is now actionable from the center cockpit instead of only being a blocked workflow state.
- The cockpit component registry now turns a missing-`experiment_id` `agent_command` with `candidate_runs` into a blocked `experiment_run_selection` card. The card lists candidate run id, dataset, target, and best model, and exposes one `select_experiment_run` action per candidate.
- Selecting a candidate run updates the focused experiment id and sends the original intent back over the existing WebSocket `user_message` contract with the chosen `experiment_id`, keeping the continuation auditable through ordinary session messages/events.
- Backend WebSocket coverage now proves the full two-step flow: first ambiguous evaluate asks for run selection with no report cards, then selecting `candidate-b` emits a normal evaluate `agent_command`, requests `model_comparison` and `evaluation_report`, and reports `Evaluation context ready`.
- Frontend component-registry coverage now proves ambiguous commands render only the run-selection card, suppress premature model/report cards, and carry the correct action payload for the selected run.
- Verification passed: focused backend WebSocket tests `24 passed`, full backend tests `121 passed, 3 skipped`, backend ruff on touched backend files, focused component-registry tests `21 passed`, full frontend tests `14 files / 83 tests`, frontend lint, frontend production build, and `npm.cmd run smoke:deep-links`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands. The current deep-link smoke suite passed, but it does not yet include a dedicated browser DOM path for the new run-selection card.
- Next recommended slice: add browser/API golden-path coverage for ambiguous run selection, then extend the same missing-context pattern to ambiguous dataset/train contexts and structured continuation commands.

## 2026-06-06 Ambiguous Run Selection Smoke Update

- Completed the QA hardening slice for the ambiguous run-selection cockpit flow.
- `frontend/scripts/deep-link-smoke.mjs` now seeds a deterministic ambiguous-run fixture with two completed experiment runs, neutral active file context, metrics/model/report/sample artifacts, and a dedicated `smoke-ambiguous-run-selection` session.
- The deep-link smoke suite now opens the machine-learning cockpit without an `experimentId`, sends `evaluate this model and show the report`, verifies the blocked `experiment_run_selection` card, checks both candidate runs, confirms model/report cards do not appear prematurely, clicks the selected run action, and verifies the selected run continues into `model_comparison` plus `evaluation_report` cards.
- The smoke runner now supports a second staged interaction pair (`afterSelection` / `afterSelectionAssertion`) so future browser golden paths can verify multi-step cockpit actions without adding a new test harness.
- Verification passed: `npm.cmd run smoke:deep-links`, frontend lint, frontend production build, full frontend tests `14 files / 83 tests`, focused backend WebSocket tests `24 passed`, backend ruff on the WebSocket test file, and full backend tests `121 passed, 3 skipped`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and PowerShell prints the profile execution-policy warning after successful frontend commands.
- Next recommended slice: add diagnose/export variants for selected-run continuation, then extend missing-context prompts to ambiguous dataset/train contexts.

## 2026-06-06 Diagnose Export Run Selection Coverage Update

- Completed the next M3 verification slice for selected-run continuation beyond evaluation.
- Backend WebSocket coverage now proves ambiguous diagnose/export prompts stop on a persisted missing-`experiment_id` `agent_command`, emit no premature cards, and continue correctly after the selected `experiment_id` is supplied.
- `export experiment <id>` is now routed as an export intent, matching the cockpit's run-selection action payload instead of falling through to a weaker generic route.
- The deep-link smoke fixture now uses separate ambiguous sessions for evaluate, diagnose, and export; browser smoke verifies each blocked run-selection card, clicks the selected run, and confirms the selected run opens the expected evaluation, diagnosis, or export cards with real artifact paths.
- Updated `task_plan.md` so M3's verification target records evaluate/diagnose/export selected-run browser/API coverage.
- Verification passed: focused backend WebSocket tests `26 passed`, backend ruff on touched backend files, `npm.cmd run smoke:deep-links`, frontend lint, frontend production build, full frontend tests `14 files / 83 tests`, and full backend tests `123 passed, 3 skipped`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and successful frontend build/test commands print the PowerShell profile execution-policy warning. An initial `npm.cmd run smoke:deep-links` from the repository root failed because `package.json` is under `frontend`; the same command passed from `frontend`.
- Next recommended slice: extend missing-context prompts to ambiguous dataset/train contexts and add parser/context tests for continuation prompts.

## 2026-06-06 Ambiguous Dataset Train Selection Update

- Completed the next M3 structured Agent Command / Context Resolver slice for ambiguous training dataset selection.
- TDD red checks first proved the current gap: a train prompt from a neutral non-CSV active file returned an error instead of a structured missing-context command, and the cockpit had no `dataset_selection` card.
- `AgentOrchestrator` now scans project CSV files when a train intent lacks a usable active/training dataset, summarizes candidate dataset path, row count, column count, and target candidates, and emits a persisted `agent_command` with `missing_context: ["dataset_path"]`, `candidate_datasets`, planned train step, proposed `train_sklearn` tool, and `approval_required: true`.
- The missing-dataset train path now stops before `training_config`, streams a user-facing dataset selection prompt, and reports `Waiting for dataset selection`. Supplying `training_dataset_path` resumes through the normal training configuration path.
- The cockpit component registry now renders `dataset_selection` blocked cards with candidate facts and `select_training_dataset` actions; clicking a dataset resends the train intent over the existing WebSocket user-message contract with `trainingDatasetPath`.
- Deep-link smoke now includes `smoke-ambiguous-dataset-selection`: neutral note -> train prompt -> blocked dataset-selection card -> no premature training card -> click `data/smoke_churn.csv` -> real `training_config` card.
- Updated `task_plan.md` so M3 tracks both ambiguous run selection and ambiguous train dataset selection as covered.
- Verification passed: focused backend WebSocket tests `27 passed`, backend ruff on touched backend files, focused frontend component/workflow tests `42 passed`, frontend production build, `npm.cmd run smoke:deep-links`, frontend lint, full frontend tests `14 files / 84 tests`, and full backend tests `124 passed, 3 skipped`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and successful frontend build/test commands print the PowerShell profile execution-policy warning.
- Next recommended slice: add parser/context tests for selected-context continuation prompts and connect dataset candidates to durable dataset-version registry records rather than temporary CSV summaries.

## 2026-06-06 Dataset Version Context Propagation Update

- Completed a small dataset-version contract hardening slice for M3 after the ambiguous train dataset selector.
- TDD red checks first proved that train commands and dataset-selection cards still used `dataset_version_id: None` or omitted version facts even after the dataset path was selected.
- `TrainingConfigurationContext` now carries a stable CSV dataset version id, and train `agent_command` events, resolved context, and `training_config` component props preserve that version for both direct CSV training prompts and selected-dataset continuations.
- Ambiguous train `candidate_datasets` now include `dataset_version_id`, and cockpit `dataset_selection` cards show the version beside each candidate and keep it in the `select_training_dataset` action payload for future selected-context/provenance work.
- Updated `task_plan.md` so M3 records candidate dataset selection with stable CSV dataset version context, while still calling out the remaining need for full source-hash/schema registry integration.
- Verification passed: focused backend train/dataset-selection WebSocket tests `2 passed`, focused backend WebSocket suite `27 passed`, backend ruff on touched backend files, focused frontend component/workflow tests `42 passed`, frontend production build, `npm.cmd run smoke:deep-links`, frontend lint, full frontend tests `14 files / 84 tests`, and full backend tests `124 passed, 3 skipped`.
- Known environment notes remain: Windows pytest prints the post-success temp cleanup `PermissionError` with exit code 0, and successful frontend build/test commands print the PowerShell profile execution-policy warning.
- Next recommended slice: replace the computed `csv-{stem}` version with durable registry records that include source hash, schema snapshot, sample strategy, and provenance edges; then add parser/context tests for user correction prompts.

## 2026-06-13 Pre-Commit Progress Snapshot

- Prepared the current MLAgent Data/ML Agent IDE worktree for its first consolidated project commit on branch `codex/foundation-kernel-mvp`.
- Current implemented surface includes: hardened kernel/resource controls, GPU queue/cancel semantics, graph evidence navigation, persisted app preferences, log/trace filtering, scripted deep-link smoke coverage, data quality profiling, preprocessing plan generation and execution, sklearn/baseline training artifacts, evaluation reports, diagnostics, export/learn retry state, durable task-state inspector, intent-aware `AgentOrchestrator`, and structured `agent_command` coverage for train/evaluate/diagnose/export/learn.
- Recent M3 cockpit context work is represented in docs and tests: ambiguous run selection, evaluate/diagnose/export selected-run continuation, ambiguous train dataset selection, and stable CSV dataset-version propagation into train commands/cards.
- Repository hygiene update: added `.codex-skill-build/` to `.gitignore` because it is local skill-build cache output, not product source.
- Commit gate run before staging: backend pytest, backend ruff, frontend lint, frontend test/build. `npm.cmd run smoke:deep-links` remains blocked in this sandboxed Windows session.
- Known environment notes remain: Windows pytest may print the post-success temp cleanup `PermissionError`, successful frontend commands may print the PowerShell profile execution-policy warning, and `git status` may warn about `C:\Users\Administrator/.config/git/ignore` permission access.
- Smoke verification note: the first deep-link smoke run failed because no frontend server was listening at `127.0.0.1:5174`; a Vite Job retry hit the known Windows parent-directory access error while loading `vite.config.ts`; a built-asset static-server retry reached the page and API but the headless browser/CDP phase returned `TypeError: fetch failed`. The smoke script now prints stack/fallback details instead of an empty `FAIL` for the next diagnostic pass.
- Next recommended slice after commit: replace computed CSV dataset ids with durable source-hash/schema dataset registry records and add parser/context tests for user correction prompts.

## 2026-06-13 Production-Readiness P0 Hardening (Observability + Config)

- Started executing the production-readiness backlog (`task_plan.md` -> "Production-Readiness Remediation Backlog", derived from `docs/production-readiness-review.md`) on branch `feat/p0-backend-hardening`, beginning with the small, high-value, fully-autonomous P0 items.
- P0-3 backend observability: added `app/core/logging.py` (request-id `ContextVar` + logging filter so every record carries `[req=...]`) and `app/core/observability.py` exposing `install_observability(app)`, which adds (1) an `X-Request-ID` middleware that assigns or echoes a request id, sets it on `request.state`, and access-logs `METHOD path -> status (ms)` per request, and (2) a global `Exception` handler returning structured JSON `{"error": {"type", "message"}, "request_id"}` with a generic message that never leaks internal stack/exception text. Wired into `main.py` via `install_observability(app)` before CORS.
- P0-4 config/secrets governance: added `cors_origins` (comma-separated env supported via a `field_validator`) and `log_level` to `Settings`; `main.py` now reads `settings.cors_origins`/`settings.app_name` instead of hardcoded values; added `backend/.env.example` documenting all `MLAGENT_` keys.
- Faithfulness correction: the original review claimed `backend/.env` was committed; it is not — `.env` is already in `.gitignore` and untracked. Corrected the relevant rows in `docs/production-readiness-review.md` and the P0-4 backlog entry accordingly.
- Tests added: `tests/test_observability.py` (request-id header present, echoed when supplied, structured non-leaking 500) and `tests/test_config.py` (CORS default + comma-separated/list parsing). Existing `test_cors_allows_vite_dev_port_5173` still passes against the settings-driven CORS.
- Verification: `backend\.venv\Scripts\python.exe -m pytest -q` -> `130 passed, 3 skipped`; `... -m ruff check app tests` -> `All checks passed!`.
- Decision/handoff: P0-1 (real LLM router) and P0-2 (auth/multi-tenancy) need product decisions before implementation (LLM provider + key source; auth strategy/user store), so they are flagged for the user rather than started blind. Autonomous next slices available: P1-4 (CI workflow) and P1-7 (remove hardcoded frontend demo data).

## 2026-06-13 LLM Adapter Layer (P0-1, multi-provider)

- User chose P0-1 next with a multi-provider adapter approach; branch kept local for now. Implemented the provider-agnostic LLM layer first (the foundation the keyword-routed `AgentOrchestrator` needs before it can reason via an LLM), decoupled from the orchestrator so it lands safely and fully tested.
- Added `app/services/llm/`:
  - `base.py`: `LLMClient` ABC + normalized `ChatMessage` / `ToolSpec` / `ToolCall` / `ChatResult` dataclasses + typed errors (`LLMError`, `LLMNotConfiguredError`, `LLMResponseError`).
  - `openai_compat.py`: `OpenAICompatibleClient` covering OpenAI, DeepSeek, and self-hosted vLLM (same `POST {base_url}/chat/completions` + `tools` function-calling shape); pure `_build_payload`/`_parse_response` for easy unit testing.
  - `anthropic.py`: `AnthropicClient` for the Messages API (top-level `system`, `input_schema` tools, `tool_use`/`tool_result` blocks).
  - `factory.py`: `get_llm_client(settings)` provider selection (+ default base URLs, vLLM-without-key) and `llm_is_configured(settings)`.
- Config: added `MLAGENT_LLM_*` settings (provider/model/api_key/base_url/temperature/max_tokens/timeout) to `Settings`; documented in `backend/.env.example`; keys are env-only. Promoted `httpx` to a runtime dependency in `pyproject.toml`.
- Tests: `tests/test_llm.py` (13) cover payload shaping, content + tool-call parsing for both provider shapes, `complete()` over `httpx.MockTransport` (no network, driven by `asyncio.run` like `test_gpu_scheduling.py`), factory provider selection, vLLM-without-key, and unconfigured/unknown-provider errors.
- Verification: `backend\.venv\Scripts\python.exe -m pytest -q` -> `143 passed, 3 skipped`; `... -m ruff check app tests` -> `All checks passed!`.
- Next slice: wire `get_llm_client()` into `AgentOrchestrator.run()` (line ~321) as an LLM intent/planning + tool-selection step, behind config, falling back to the existing deterministic keyword routing when `llm_is_configured()` is False — so the app keeps working with or without an LLM key. Then add streaming and make the frontend model selector real.

## 2026-06-13 LLM Intent Routing Integrated (P0-1, option A)

- User picked option A (LLM intent layer in front of the keyword router, keyword fallback). Implemented it end to end.
- Added `app/services/llm_intent.py`: `classify_intent_with_llm(client, content, fallback)` exposes a single `route_intent` function-call tool whose `intent` enum is the 14 canonical orchestrator intents (kept in sync with `_classify_intent`), with a system prompt; `extract_intent()` reads the tool call (or a bare content intent) and returns a known intent or None. Any `LLMError`, unknown answer, or missing tool call yields the caller's fallback.
- Wired into `app/services/agent_orchestrator_service.py`: added module helper `_default_llm_client()` (returns a client when `llm_is_configured()`, else None, swallowing `LLMError`); `AgentOrchestrator.__init__` now accepts an optional `llm_client` (defaults to `_default_llm_client()`); `run()` now calls `await self._resolve_intent(content)` which computes the keyword intent first and uses the LLM only as an override when configured, falling back to keyword on any failure. The WS-constructed orchestrator (`api/ws.py`) auto-builds the client from `MLAGENT_LLM_*`.
- Behavior is unchanged when no LLM is configured: `_resolve_intent` returns the keyword result, so all existing run()-driven tests (golden path, websocket) pass untouched.
- Tests: `tests/test_llm_intent.py` (7) cover tool-call intent selection, unknown-intent fallback, `LLMError` fallback, bare-content intent, and orchestrator `_resolve_intent` for the no-LLM, LLM-override, and LLM-error cases (injecting a `_FakeClient`).
- Verification: `backend\.venv\Scripts\python.exe -m pytest -q` -> `150 passed, 3 skipped`; `... -m ruff check app tests` -> `All checks passed!`.
- To exercise end to end, set `MLAGENT_LLM_PROVIDER`/`MLAGENT_LLM_MODEL`/`MLAGENT_LLM_API_KEY` (and optionally `MLAGENT_LLM_BASE_URL`) in `backend/.env`; the chat WebSocket will then route free-form messages via the LLM. Optional follow-ups: full tool-calling/ReAct loop (option B), streaming output, real frontend model selector.

## 2026-06-13 Streaming LLM Replies in the Conversational Path (P0-1, deepen)

- User chose to deepen P0-1. Delivered two of the three sub-items in one slice: token streaming + a real (grounded) LLM conversational reply.
- Adapter streaming: added `LLMClient.stream(...) -> AsyncIterator[str]` with a default one-shot implementation (yields `complete()` content) so existing fakes keep working; `OpenAICompatibleClient` and `AnthropicClient` override it with true SSE streaming (`sse_payload` helper parses `data:` lines; OpenAI reads `choices[].delta.content`, Anthropic reads `content_block_delta.delta.text`). `stream=true` is added to the payload and the body is read via `client.stream(...).aiter_lines()`.
- Orchestrator: added `_emit_llm_message(messages, fallback_text)` which streams LLM chunks as `message_delta` events (reusing the existing event shape the frontend renders as the live `streamingMessage`), persists the assembled text to the session, and falls back to the templated `_emit_assistant_message` when no LLM is configured or the stream fails before producing text. `_run_analysis_overview` now captures the computed `profile`/`missing` results and asks the LLM to summarize them concretely (grounded, "do not invent values"), with the previous template as the fallback string (so no-LLM behavior, and the golden-path assertion on that text, are unchanged).
- Tests: `tests/test_llm_streaming.py` (7) cover `sse_payload`, OpenAI/Anthropic SSE streaming over `httpx.MockTransport`, the default one-shot stream, and `_emit_llm_message` streaming + both fallback paths (no client / stream error).
- Verification: `backend\.venv\Scripts\python.exe -m pytest -q` -> `157 passed, 3 skipped`; `... -m ruff check app tests` -> `All checks passed!`.
- Remaining in the deepen-P0-1 track: option B (full LLM tool-calling/ReAct loop where the model selects tools) and a real frontend model selector (`AppShell.tsx:1655`).

## 2026-06-13 LLM Tool-Calling / ReAct Loop (P0-1, option B)

- User chose option B: let the LLM autonomously select and call tools, with the existing deterministic functions as the implementation layer. Delivered as a low-risk slice — the agentic path only activates when an LLM client is configured (false in CI/dev/tests by default), so all previously-green deterministic paths are untouched.
- New engine `app/services/llm_agent.py`: provider-agnostic `run_tool_phase(client, *, conversation, tools, execute, max_iterations=4)`. Each round it calls `client.complete(conversation, tools=...)`; if the model requests no tools the phase ends (conversation left ready for the caller to stream the final answer); otherwise it appends the assistant tool-call turn, runs every requested call through the caller's `execute` coroutine, appends each result as a `tool` message, and yields a typed `ToolCallStarted`/`ToolCallFinished` pair. A failing executor is caught and its error is fed back to the model as the tool result (so the model can recover) instead of crashing the turn. The `max_iterations` bound guarantees termination. The engine knows only `LLMClient`/`ToolSpec`/`ChatMessage`/`ToolCall`, so it is fully unit-testable with a fake client.
- Orchestrator wiring (`agent_orchestrator_service.py`): module-level `_ANALYSIS_AGENT_PROMPT`, `_AGENT_TOOL_FUNCS` (maps `profile_dataset`/`detect_missing`/`correlation_matrix` to the existing deterministic functions), `_AGENT_TOOL_SPECS`, and `_build_analysis_tools(csv_path) -> (specs, executor)` (the executor dispatches on tool name, JSON-encodes the result, truncates to 1500 chars, and reports unknown tools as `ERROR: unknown tool`). New method `_run_agentic_answer(...)` builds the system+user conversation, runs `run_tool_phase`, translates each loop event into the existing `tool_call_started` / `tool_call_finished` UI events (reusing `_tool_finished` + `perf_counter` timing), then streams the grounded final answer over the tool-augmented conversation via `_emit_llm_message`. On no client or `LLMError` it falls back to the deterministic text. `_run_analysis_overview` now delegates its LLM reply to `_run_agentic_answer`; the deterministic 4-artifact block (profile/missing/correlation/distribution) still always runs so the inspector stays populated.
- Tests: `tests/test_llm_agent.py` (7) over a scripted fake `LLMClient` — engine execute-then-stop (asserts events + mutated conversation), no-tool early return, executor error surfaced to the model, `max_iterations` bound; `_build_analysis_tools` known/unknown dispatch on a tiny CSV; and orchestrator `_run_agentic_answer` emitting tool events then streaming the reply, plus the no-LLM fallback path.
- Verification: `backend\.venv\Scripts\python.exe -m pytest -q` -> `164 passed, 3 skipped` (157 prior + 7 new); `... -m ruff check app tests` -> `All checks passed!`.
- Remaining in the deepen-P0-1 track: a real frontend model selector (`AppShell.tsx:1655`), which needs the dedicated frontend designer skill (per AGENTS.md) plus a small backend LLM-status endpoint.

## 2026-06-13 Real Model Status Indicator (P0-1, frontend)

- Closed the last deepen-P0-1 item: the top bar's static `Claude / DeepSeek / Local vLLM` text is now a live, honest model indicator. Per AGENTS.md the work followed the `mlagent-frontend-product-designer` skill (wire controls to real contracts; no inert/fake controls).
- Scope decision (user-approved): the backend configures a single provider + single credential set via env (`MLAGENT_LLM_PROVIDER`), and the orchestrator rebuilds the client from env per message, so a real runtime *switcher* isn't backed by anything yet. We shipped a real **status indicator** instead of a fake switch; true per-session switching is deferred until multi-provider credential config + a ws→orchestrator override path exist.
- Backend: new read-only `GET /api/llm/status` (`app/api/llm.py`, registered in `main.py`). Returns `configured` (from `llm_is_configured`), the active `provider`/`provider_label`/`model`, and a `providers[]` catalog (anthropic/openai/deepseek/vllm) with an `active` flag. `openai-compatible` is presented under the OpenAI label. The API key is never returned. Settings come via `Depends(get_settings)` so tests inject them. Tests: `tests/test_llm_status.py` (5) — not-configured default, vllm configured without a key, provider-set-but-uncredentialed stays unconfigured, openai-compatible→openai mapping, and an explicit no-key-leak assertion.
- Frontend: `lib/api.ts` gains `LlmStatus`/`LlmProviderInfo` + `getLlmStatus()`. `features/llm/llmStatus.ts` holds the pure logic — `describeLlmStatus` maps {status, loading, error} to a `{tone, label, detail}` view (tones: loading/error/live/offline), and `buildProviderRows` derives per-provider state (configured / active-unconfigured / available). `features/llm/ModelStatusIndicator.tsx` fetches status on mount (injectable loader, cancellation-guarded), renders a tone-colored dot + provider label + caret, and opens a click-outside/Escape-dismissable popover listing the providers with a refresh control. Replaced the static div in `AppShell.tsx`. New CSS `.model-status*` reuses the existing palette and stays right-aligned via `margin-left:auto`.
- Helper tests: `features/llm/llmStatus.test.ts` (8) cover every tone branch and the three provider-row states.
- Verification: backend `pytest -q` -> `169 passed, 3 skipped` (+5), `ruff` clean; frontend `npm run lint` clean, `npm test` -> `92 passed` (15 files, +8), `npm run build` (tsc + vite) OK. Headless browser DOM QA against live backend (vllm) + dev server confirmed: trigger renders tone `live` with text "Local vLLM" and the model in its aria-label, the old `.model-selector` is gone, and the popover opens (`aria-expanded=true`) with vLLM marked Active/configured and the other three Available.
- P0-1 status: the original blocker fix (multi-provider adapters + LLM intent routing + streaming replies + tool-calling/ReAct loop + a real model control) is now fully delivered. Further orchestrator-size hardening continues under P1-6.

## 2026-06-13 拆分后端编排器（P1-6，切片 1–3）

- 目标：把 4263 行的 `agent_orchestrator_service.py`（占后端 app ~43%）按关注点拆成模块，**增量、行为保持**——不改公共 API，每个切片后整套测试 + ruff 都保持绿色。
- 做法：新建包 `app/services/agent_orchestrator/`，原文件保留为 **facade**（维持公共 import 路径 `app.services.agent_orchestrator_service`，并通过 re-import 自动 re-export `AgentContext`/`_build_analysis_tools`），所以 `ws.py` 与 `test_llm_agent`/`test_llm_intent`/`test_llm_streaming` 三个测试一行不动。两条关键安全机制：① 把模块级 helper 移到子模块后在 facade 顶部 re-import，类内方法体对这些名字的引用仍解析，**方法体零改动**；② 对 `self` 耦合的方法保留薄方法委托给外移的自由函数（command builder 把 `self` 当 `meta` 传入），调用点不变。`ruff`（F401/F821）+ 169 个测试是即时安全网。
- 切片 1（commit）：外移**纯模块级**代码——`contexts.py`（7 个 frozen dataclass）、`support.py`（`_utc_now`/`_relative_path`/`_dataset_version_id_from_path`/`_resolve_active_file` + `RECOVERABLE_STAGES` 等常量）、`artifacts.py`（pending-approval 持久化 + artifact 写入器 + `_render_transformation_report`）、`tools.py`（`_default_llm_client` + 只读分析工具注册表 `_build_analysis_tools`）、`intent.py`（`classify_intent`，即原 276 行纯函数 `_classify_intent` 的函数体，方法改为委托）。facade −576 行（4263→3687）。
- 切片 2（commit）：`commands.py`——9 个 `agent_command`/props 事件构建器（train/evaluate/diagnose/export/learn/missing-dataset/missing-run + `profile_props`/`dataset_registry_props`）。7 个有状态的只读 `self.trace_id`/`self.session_id`，故以 orchestrator 作 `meta` 首参，facade `return f(self, ...)` 委托；两个 props 为纯函数。facade −355 行（3687→3332）。
- 切片 3（commit）：`runs.py`——8 个纯 run/dataset/context 查询 helper（`_artifact_path_from_run`/`_match_run_by_active_file`/`_run_candidate_summary`/`_target_candidates_for_columns`/`_candidate_dataset_summaries`/`_diagnosis_summary`/`_infer_target_column`/`_requests_latest_run`）。两个内部互调改为同模块自由函数调用，方法委托。facade −103 行（3332→3229）。
- 工程过程注记：两次用 bash heredoc 跑生成脚本时出现“输出显示成功但文件系统实际未变更”的异常（`git status` 干净、目标文件不存在）。靠 `git status`/`ls`/`grep` 事实核查识别后，改用“先 Write 脚本落盘再 `python file.py` 执行”的可靠方式完成切片 3，避免在虚假成功状态上继续。
- 成果：facade 由 4263 → 3229 行（累计 −1034，约 −24%），逻辑分布到 8 个内聚子模块（`contexts/support/artifacts/tools/intent/commands/runs` + `__init__`，共 ~1248 行）。每个切片均 `pytest -q` → `169 passed, 3 skipped`、`ruff check app tests` → clean。三个切片分别本地提交（`refactor(backend):`）。
- 剩余（后续，已在 plan 中）：切片 4 把 15 个 `_run_*` stage runner 经 `StageRunnersMixin` 外移、切片 5 把流式/消息 + 事件 helper 经 `MessagingMixin` 外移，使 `AgentOrchestrator` 收敛为薄分发器（`__init__`/`run`/`respond_to_approval`/`resume_step`/`_resolve_intent`/`_resolve_*context`）。

## 2026-06-14 拆分后端编排器（P1-6，切片 4–5，拆到底）

- 目标：用 **mixin** 模式把剩下两大块高度 `self` 耦合的方法外移，完成 P1-6——orchestrator 收敛为薄分发器。
- mixin 安全机制：方法在类里是 4 空格缩进；移到另一个 mixin 类里仍保持 4 空格缩进 → **方法体零改动**。`self` 经 MRO（`AgentOrchestrator` → `StageRunnersMixin` → `MessagingMixin` → `object`）解析，方法间互调（`self._stage_event`/`self._record` 等跨 mixin 调用）不受影响。
- 切片 4（commit）：`stages.py`——`StageRunnersMixin`，15 个 `_run_*` stage runner（`_run_configure_ingest` … `_run_configure_learning`、`_run_prepare_for_modeling`、`_run_approved_preprocessing_execution`、`_run_analysis_overview`、`_run_continue_from_failure`、`_run_abandon_last_failure`）。
- 切片 5（commit `b4f39c3`）：`messaging.py`——`MessagingMixin`，15 个流式/消息 + 事件 + artifact 构建 helper（`_append_user_message`/`_emit_assistant_message`/`_emit_llm_message`/`_run_agentic_answer`/`_emit_resolution_error`/`_record`/`_stage_event`/`_rules_event`/`_lesson_events`/`_tool_started`/`_tool_finished` + 四个 `_build_*_artifact`）。facade 改为 `class AgentOrchestrator(StageRunnersMixin, MessagingMixin)`，并保留对 `_build_analysis_tools` 的显式 re-export（冗余别名，供 `test_llm_agent` import）。
- 子模块 import 用 **ast 最小化**：解析 facade 的 import 成 `{绑定名: 来源}` 注册表，对每个 mixin 取「类体里实际被 `Load` 的 `Name`」∩ 注册表，只 emit 用到的 import → 无 F401、无 F821。顺手清掉了切片 4 误留在 `stages.py` 的 4 个未用 stdlib import（`asyncio`/`csv`/`hashlib`/`json`）和一个被局部变量遮蔽的 `profile_props` import（切片 5 提交里一并修正）。
- 成果：facade **4263 → 703 行**（累计 −3560，约 **−83%**），逻辑分布到 9 个内聚子模块（`contexts/support/artifacts/tools/intent/commands/runs/stages/messaging`）。最终验证 `ruff check app tests` → All checks passed、`pytest -q` → **169 passed, 3 skipped**，MRO 与公共 API 不变。P1-6 完成，本地提交（`refactor(backend):`），分支先留本地未推。
- 工程过程注记（沿用前一阶段经验）：本机 shell 输出层间歇性「伪造成功并注入文本」，故全程以 **Read 工具 + python 子进程把结果写文件再读** 作为地面真相，提交用 `git commit -F <消息文件>`（不用 heredoc），import 清理用 ast 自算（不依赖被污染欺骗的 `ruff --fix`）。

## 2026-06-14 接入 CI/CD（P1-4）

- 目标：补上 P1-4——仓库此前无 `.github/workflows`，PR 无任何自动闸门。新增 `.github/workflows/ci.yml`，对 `pull_request` 与 `push: master` 触发。
- 设计：两个**并行** job，均 `ubuntu-latest`（Windows 本地那条 vite/esbuild 沙箱限制只针对本机，不影响 Linux runner）。
  - **backend**（`working-directory: backend`）：`actions/setup-python@v5`（Python 3.12，`cache: pip` 指向 `backend/pyproject.toml`）→ `pip install -e ".[dev]"` → `ruff check app tests` → `pytest -q`。
  - **frontend**（`working-directory: frontend`）：`actions/setup-node@v4`（Node 20，`cache: npm` 指向 `frontend/package-lock.json`）→ `npm ci` → `npm run lint`（eslint）→ `npm run test`（vitest）→ `npm run build`（`tsc -b` 即类型检查 + vite build）。
- 加固项：`concurrency`（同 ref 新推送取消旧运行，省额度）、`permissions: contents: read`（最小权限）。两 job 每次都跑、不加 `paths` 过滤——避免将来设了「必需检查」时 skip 的 job 卡住合并。
- 落地前先把关键不确定性核实为地面真相（用 `git ls-files`，即 runner `checkout` 后能看到的内容；注意 Glob 默认遵守 `.gitignore`，会漏掉被忽略的 lockfile/egg-info）：
  - pyproject 无 `[build-system]`/`[tool.setuptools]`，曾担心 `pip install -e` 触发 setuptools「多个 top-level 包」失败；但 `backend/mlagent_backend.egg-info/top_level.txt` 内容就是单行 `app`，证明自动发现把 `tests` 排除、稳定解析为单一 `app` 包——`pip install -e ".[dev]"` 可行，**无需**改 pyproject。
  - `frontend/package-lock.json` 已被 git 跟踪 → `npm ci`（要求 lockfile 在场）成立。
  - 前端有 15 个 `.test.ts` 已跟踪 → `vitest run` 不会因「No test files found」非零退出。
  - 项目无自定义 conftest、本机 `pytest -q` 基线为 169 passed/3 skipped → CI 同命令无需起 Postgres/Redis service 容器。
- 验证：`ci.yml` 经 pyyaml `safe_load` 解析通过（两 job、各 step 名称齐全；`on` 被 pyyaml 当布尔键属其已知怪癖，不影响 GitHub Actions 解析）。改动为纯新增 + 文档，未触碰任何应用代码/测试，169 passed/3 skipped 基线不变。
- 本地提交（`feat(ci):`），分支按既定「先留本地」未 push——workflow 文件先随分支落库，待真正推送/开 PR 时才会在 GitHub 上运行。

## 2026-06-14 前端状态架构（P1-1，地基 + 首迁，增量行为保持）

- 背景：`AppShell.tsx` 1845 行上帝组件，~35 个顶层 `useState` + 6 个数据加载 `useEffect`，海量 props 钻取（AgentWorkspace ~35 / RightPanel ~30 / FileExplorer ~22 / ActivityPanel ~20 / EvolutionWorkspace ~15）；`zustand` 与 `@tanstack/react-query` 是依赖但 `src/` 零使用。P1-1 是 L 级，本会话只推「地基 + 1 个低风险切片」，并先补安全网。
- **切片 0（安全网，commit `6676b28`）**：前端 15 个测试全是纯 `.ts` 逻辑，AppShell 无任何 render 兜底。补 `src/test/websocketStub.ts`（jsdom 无 WebSocket，而 `useAgentStream` 挂载即 `new WebSocket`）+ `src/test/renderWithProviders.tsx` + `src/app/AppShell.smoke.test.tsx`（`// @vitest-environment jsdom` docblock 单文件切环境、不动全局 node）。devDep 加 `@testing-library/react@16` + `jsdom@25`。
  - 踩坑：mock api 层时先用 catch-all Proxy，`get` 对任意 key（含 `then`）都返回 `vi.fn(async()=>undefined)`——module namespace 被当 thenable 探测，`then` 返回忽略 resolve 的函数导致 `await import(...)` 永久挂起（5s 超时、无报错）。改用 vitest 官方 `importOriginal` 模式：枚举真实导出名（真实模块无顶层副作用），逐个把函数换成 async 桩，vitest 才能建静态绑定。
- **切片 1（地基，commit `9564dd7`）**：`src/lib/queryClient.ts` 工厂（保守默认 `refetchOnWindowFocus:false`/`retry:1`/`staleTime:30s`，迁移期对齐原「取一次数」语义）；`App.tsx` 包 `QueryClientProvider`（应用级单例）；`renderWithProviders` 升级为每用例新建隔离 client。无 query 接入，行为不变。
- **切片 2（首迁，commit `937bc5e`）**：选 evolution `protocols` 作示范——它只在 `activateProject` 设置一次、零 mutation 纠缠，是最隔离的只读列表。新增 `features/evolution/useEvolutionProtocolsQuery.ts`（`useQuery` 随 projectId 取数）；AppShell 删 `protocols` 的 useState 改 `protocolsQuery.data ?? []`，从 `activateProject` 的 `Promise.all` 移除抓取与 set，清理失效 import。
  - 纠缠度核查（决定为何只迁 protocols）：`setGpuStatus` 9 处 / `setLessons`·`setInjectionLogs` 各 ~7 处 / `setTrainingRuns` 5 处——都与训练/清洗/导出/课程等 handler 命令式纠缠，迁移要逐点改 `invalidateQueries`，不属低风险；`setProtocols` 仅 1 处 → 唯一真正隔离者。
- 每切片三道闸门全绿：`vitest`（16 文件 / 93 passed，含 AppShell 冒烟）、`eslint` 0 error、`npm run build`（`tsc -b` 严格类型 + `vite build`，本机此次未触发 esbuild 沙箱限制）。分支按既定「先留本地」未 push。
- 剩余（后续会话）：GPU 轮询 + `lessons`/`injectionLogs`/`trainingRuns` 改 `invalidateQueries` → sessions/messages/events/task-states + bootstrap/文件树（`useMutation`）→ 落地 `app/uiStore.ts`（zustand）逐字段消除 props drilling → 拆 `AppShell` 为薄容器。
- 工程过程注记：沿用本机 shell 间歇性「伪造成功」的应对——命令输出写文件再 Read、`git commit -F <消息文件>`；另注意 `npm`/`vitest` 必须在 `frontend/` cwd 下跑（一次因 cwd 残留在仓库根导致 `ENOENT package.json`、vitest 从根扫描漏文件）。

## 2026-06-14 前端状态架构（P1-1，GPU + 纠缠列表迁移，分 3 提交）

- 承接上一片（地基 + protocols），把之前判定为「非低风险」的纠缠服务端态迁到 react-query。为守住每片绿、可回滚，拆成 3 个聚焦提交。
- **GPU（commit `4c1dbce`）**：`features/right-panel/useGpuStatusQuery.ts`（`useQuery` + `refetchInterval=preferences.gpuRefreshIntervalMs` 接管轮询，导出 `gpuStatusQueryKey`）。AppShell 删 `gpuStatus` useState 改 `gpuStatusQuery.data ?? null`；引入 `useQueryClient`；6 处命令式 `setGpuStatus(await getGPUStatus(...))` 机械替换为 `queryClient.setQueryData(key, await getGPUStatus(...))`（时序/错误语义不变）；原 setInterval 轮询 effect 换成桥接 effect，把查询的成功/失败（含后台重取，用 `error ?? failureReason`）映射回 `gpuActionError`，保留「成功清错、失败显错」行为。
- **lessons + injectionLogs（commit `b0ac25c`）**：`features/evolution/useEvolutionQueries.ts`（`useLessonsQuery`/`useInjectionLogsQuery` + key 助手）。这两个列表此前以「`listLessons`+`listEvolutionInjectionLog` → `setLessons`/`setInjectionLogs`」成对 idiom 重复 **7 处**；新增 AppShell 内 `invalidateEvolutionLists(projectId)` 助手，5 个独立块直接 invalidate，`activateProject` 去掉抓取（靠 `project.id` 变更自动触发查询），`refreshSessionState` 保留 sessions/messages 抓取后追加 invalidate。
- **trainingRuns（commit `92bf8ff`）**：`features/right-panel/useTrainingRunsQuery.ts`。删 useState 改查询派生；4 处命令式 `setTrainingRuns(await listTrainingRuns(...))` 改 `invalidateQueries`（训练/重试/评估/导出后），`activateProject` 去掉抓取。
- 关键手法：凡 `setX(await listX(id))`（命令式刷新）→ `invalidateQueries`（或 GPU 的 `setQueryData`）；凡 `activateProject`/`useState` 里的初始抓取 → 删除，靠 query 随 `project.id` 自动加载；清理因此失效的 api 函数与类型 import（`listEvolutionProtocols`/`listLessons`/`listEvolutionInjectionLog`/`listTrainingRuns` 及 `EvolutionProtocol`/`EvolutionInjectionLog`/`GPUStatus`/`ExperimentRun`）。
- 每子片三道闸门全绿：`vitest` 16 文件 / 93 passed（含 AppShell 冒烟，证明各次迁移后仍正常渲染）、`eslint` 0 error、`npm run build`（`tsc -b` + `vite build`）成功。分支按既定「先留本地」未 push。
- 现状：服务端只读/轮询态（protocols/gpu/lessons/injectionLogs/trainingRuns）已全部由 react-query 托管。剩余（后续会话）：sessions/messages/events/task-states + bootstrap/文件树（`useMutation`）→ 落地 `app/uiStore.ts`（zustand）消除 props drilling → 拆 `AppShell` 为薄容器。

## 2026-06-14 前端状态架构（P1-1，sessions/messages/events/task-states + projects，分 3 提交）

- 承接上两片，迁这一片纠缠最深的会话相关服务端态。难点：`durableTaskStates`/`taskStateEvents` 是单次 `listSessionTaskStates` 经 `taskStateSnapshot` 派生出的**两份**状态；`activeSession` 又驱动 `useAgentStream` 的 WebSocket；写路径多（13+ 处训练/预处理/导出后刷新）。拆 3 个聚焦提交，每片守绿。
- **核心竞态规避**：引入 query hook 后，bootstrap 的命令式 `listProjects` / `ensureModeSession` 的 `listProjectSessions` 会与 hook 抢同一缓存键——若 hook 的并发请求在「创建项/会话 + setQueryData」之后才返回空列表，会把刚建的项覆盖掉。解法：命令式**首读改 `queryClient.fetchQuery({queryKey, queryFn})`**，与 hook 同键去重（只发一次请求、settle 一次），建好后再 `setQueryData` 即最后一次写、无竞态。
- **A·projects（commit `01d0f1c`）**：`features/projects/useProjectsQuery.ts`（key 无 projectId，全局列表）。AppShell 删 `projects` useState 改查询派生；bootstrap 首读改 `fetchQuery`、`setProjects(initialProjects)` 改 `setQueryData`；`handleCreateProject`/`handleOpenLocalProject` 已 `await listProjects()` 拿到新列表 → 改 `setQueryData`。
- **B·sessions（commit `b3ba7cb`）**：`features/sessions/useSessionQueries.ts`（`useSessionsQuery` keyed on projectId）。`ensureModeSession` 首读改 `fetchQuery`、新建会话后 `setQueryData`、去掉未新建时的冗余二次取数；`refreshSessionState` 的 sessions 刷新改 invalidate；`activateProject` 删 `setSessions`（query 随 `project.id` 自动加载）。`activeSession` 仍为本地选择态。
- **C·会话级 messages/events/task-states（commit `266759c`）**：同文件加 `useSessionMessagesQuery`/`useSessionEventsQuery`/`useSessionTaskStatesQuery`（keyed on activeSession.id）。`sessionEvents` 用 `isAgentStreamEvent` 在 `select`/memo 过滤；`durableTaskStates`/`taskStateEvents` 由 `taskStateSnapshot` 的 useMemo 从同一份 data 派生，替代 `applyDurableTaskStates` 的两份 setState。删 `loadSessionMessages` effect（无会话时 query disabled → data undefined → `?? []` 自然清空）；`handleSelectSession` 从三连命令式取数收敛为单行 `setActiveSession`；新增 `invalidateSessionTaskStates` 助手，13 处训练/预处理/导出后刷新 + inspector effect + abandon 统一改 invalidate；`refreshSessionState` messages 改 invalidate；`activateProject` 删 4 个会话级 reset。清理失效 import：`listSessionMessages`/`listSessionEvents`/`listSessionTaskStates` + `type AgentMessage`。
- **本次刻意不迁文件树**（`files`/`expandedFolders`）：~20 处命令式 `setFiles`，含展开/折叠的 functional update（`setFiles(current => ...)`）与重命名时的路径字符串替换——这是本地乐观更新，不是缓存友好的读，react-query 不是合适工具，强迁是高风险低收益，留作独立的 `useMutation` 子任务。bootstrap 迁移因此限定在干净的服务端数据 `projects`。
- 行为保持要点：`activeSession` 选择态、`useAgentStream` 接线、`visibleEvents = [...sessionEvents, ...taskStateEvents, ...events, ...localEvents]` 合并逻辑均不变；会话切换时 query 走 undefined→[]→data（与既定保守 QueryClient 默认一致，未引入 `keepPreviousData`，与前几片同口径）。
- 每片三道闸门全绿：`vitest` 16 文件 / 93 passed（含 AppShell 冒烟）、`eslint` 0 error、`npm run build`（`tsc -b` + `vite build`）。分支按既定「先留本地」未 push。
- **更新后剩余（后续会话）**：文件树迁 `useMutation` → 落地 `app/uiStore.ts`（zustand）逐字段消除 props drilling → 拆 `AppShell` 为薄容器。

## 2026-06-14 前端状态架构（P1-1，文件树迁 react-query，分 2 提交）

- 迁最后一块、也是判定为「最不适合 react-query」的文件树。坦诚定位：这是 P1-1 里风险最高、收益最低的一片——文件树本以本地命令式 + 乐观更新工作良好，缓存收益有限；但它兑现「把取数移出组件」的目标，用户明确要求推进，故做扎实、分 2 聚焦提交、每步守绿。
- **关键设计：query key 含已展开文件夹集合**。文件树显示内容同时取决于 projectId 与「哪些文件夹被展开」。把 `expandedFolders`（排序后）放进 key 是**正确且惯用**的：展开/折叠改 key 即自动重取对应集合。曾考虑把 expandedFolders 留在闭包/ref 而非 key 以保留单文件夹增量取数，但「展开新文件夹 + 刷新」类 handler 会因 ref 在下次渲染才更新而**漏取新展开的文件夹**（invalidate 用旧 ref 立即重取）——keying 把这个依赖显式化，从根上避免该竞态。代价：folder 切换从单文件夹增量取数变为重取整个展开集（`staleTime:30s` 内复用缓存）。
- **F1·读模型（commit `7e203de`）**：`features/files/useProjectFilesQuery.ts`（`useProjectFilesQuery` + `filesQueryKey`/`filesQueryKeyRoot`，并把原内联 `listExpandedProjectFiles` 移入以避免循环依赖）。删 `files` useState 改查询派生；转换全部 ~13 处 `setFiles`——写后及 10 处训练/清洗/预处理/评估/导出后的刷新改 `invalidate(filesQueryKeyRoot)`；`activateProject` 与 `handleDeleteFile` 用 `setQueryData` 以**同键**预置缓存（前者避免激活闪空树，后者保留 `.find` 回退所需的新列表）；`handleToggleFolder` 折叠/展开只改 `expandedFolders`，去掉本地 prune 与增量 `listFiles+merge`。tsc 确认无 `setFiles` 残留。
- **F2·写操作（commit `2fa3e41`）**：`features/files/useProjectFileMutations.ts`（create/rename/delete/upload 四个 `useMutation`，`onSuccess` 统一 `invalidate(filesQueryKeyRoot)`）。四个写 handler 改 `mutateAsync` 并移除 F1 里手写的显式 invalidate（onSuccess 接管）；`handleCreateFile` 内联并删除仅它使用的 `refreshExpandedFiles`；`handleDeleteFile` 仍保留删除后取新列表 + `setQueryData` 以支持 activeFile/dataset 的 `.find` 回退（onSuccess 的后台重取与之冗余但结果一致，可接受）。清理失效 import：`createProjectFile`/`deleteProjectFile`/`renameProjectFile`（`uploadProjectFile` 仍由 bootstrap 上传样例 CSV 使用，保留）。
- 行为保持：`expandedFolders` 仍为本地 UI 态；handler 仍负责展开集与 activeFile/dataset/plan 的连带处理。安全网注记：文件树**行为**无组件测试覆盖，本片靠 `tsc`（删 useState 后每个 `setFiles` 即编译错误，等于完整清单）+ 冒烟渲染兜底；逐站点人工核对。每片三道闸门绿（lint 0、vitest 16 文件/93 passed 含冒烟、tsc + build），分支先留本地未 push。
- **现状：服务端态已全部由 react-query 托管**（projects/sessions/messages/events/task-states/files/protocols/gpu/lessons/injectionLogs/trainingRuns）。剩余（后续会话，纯 UI/选择态重构，不再涉及取数）：落地 `app/uiStore.ts`（zustand）逐字段消除 props drilling → 拆 `AppShell` 为薄容器。

## 2026-06-19 前端状态架构（P1-1，zustand uiStore 消除 props 钻取，分 6 提交）

- 承接「服务端态已全部由 react-query 托管」，本片落地 `app/uiStore.ts`（zustand 单例 store），把 AppShell 的全局 UI/选择态逐字段搬入、子组件改 `useUiStore(selector)` 直读，消除上帝组件的 props 钻取。纯结构性、行为保持、增量推进，每片三道闸门（eslint 0 / vitest 16 文件 93 passed 含冒烟 / `tsc -b` + `vite build`）全绿，分别本地提交。
- **store 初始化**：`readAppDeepLink()`（读 `window.location.search`）与 `readAppPreferences()`（读 localStorage）在**模块加载时各调一次**作为 store 初值——纯浏览器读、jsdom 下同样安全，与原 useState 首渲染初值等价。
- **U1·纯写字段（`2fe82d9`）**：`workspaceStatus`/`trainingResult`/`trainingError`/`gpuActionError`/`focusedLogTaskId`/`rightPanelTab` 这 6 个在 AppShell 侧**只写不读**（不参与渲染/handler 逻辑/effect 依赖/query key）。迁后 AppShell 只取 setter 动作（最安全起手）；RightPanel 主组件去 5 个 props（含 `initialTab→rightPanelTab`，tab 切换 effect 依赖语义不变），FileExplorer 去 `status`。`openLogs` 复合动作替代成对 `setFocusedLogTaskId+setRightPanelTab`。
- **U2·导航态（`65270d6`）**：`activeMode`/`activeActivity`（深链/偏好初始化随之移入 store，AppShell 不再调 `resolveInitialMode`）。RightPanel 去 `mode`、ActivityPanel 去 `activity`+`onSelectMode`。**AgentWorkspace 保留 `mode` prop**：其类型是收窄的 `"analysis"|"machine-learning"`（仅非 evolution 渲染），AppShell 三元分支里 `activeMode` 被 TS 收窄后传入，直读 store 全量 `MainMode` 会丢收窄——保留这一个携带类型不变量的 prop。
- **U3a·无覆盖选择态（`9674e6c`）**：`activeFile`/`focusedExperimentId`。四个消费方（FileExplorer/ActivityPanel/AgentWorkspace/RightPanel）改读 store 去 prop；AppShell 仍读 `activeFile`（footer + analysis/training handlers），保留 `setFocusedExperimentId`（继续作 AgentWorkspace 的 `onSelectExperimentRun` 传入）。
- **U3b·带覆盖选择态（`299186c`）**：`trainingDatasetPath`/`suggestedTargetColumn`/`selectedPreprocessingPlanPath`。**关键不对称**：AgentWorkspace 拿的是 `durableTrainingContext?.X ?? storeValue`（覆盖依赖服务端 task-states，必须留 AppShell 计算），RightPanel 拿未覆盖原始值——两者取值本就不同，故 RightPanel 改读 store 去 3 props，**AgentWorkspace 保留 3 props**（AppShell 算覆盖后传入）。
- **U4·文件树展开集（`5299df3`）**：`expandedFolders`（filesQuery 的 query key 依赖，被十余 handler 读写）。`setExpandedFolders` **保留 React setState 式签名**（接受数组或 `(current)=>下一个`），store 内 `typeof value==="function" ? value(state.x) : value` 分发，使所有调用点含 updater 形式零改；FileExplorer 去 `expandedFolders` prop（`onToggleFolder` 仍为行为回调 prop）。
- **U5·表单态局部化（`9d49169`）**：`newProjectName`/`localProjectPath` 是组件级瞬时表单态，**不入全局 store**——下沉进 FileExplorer 自管（它本就自管 `newEntryPath` 等同类态）。`onCreateProject`/`onOpenLocalProject` 签名改收 `name`/`path` 参数，AppShell handler 据此读参数、删 2 个 useState。踩坑：两处清空回调缩进不同（onKeyDown 内层 vs onClick），首次 replace_all 只命中一组，靠 `tsc` 抓出残留的 `onNewProjectNameChange`/`onLocalProjectPathChange` 两处后补修——再次印证「删 prop 后 tsc 即完整清单」的安全网。
- **刻意未迁**（附理由）：① `localEvents` 只被折叠进 `visibleEvents`（非 props），迁入无消除钻取收益（YAGNI），留待 handler 抽 hook 时再处理；② `preferences` 由 `appPreferences` localStorage 模块（带测试）托管，特殊；③ `project`/`activeSession` 驱动 query key 与 `useAgentStream` 的 WebSocket，耦合最深，单独评估。
- **现状**：全局 UI/选择态已由 uiStore 托管，RightPanel/ActivityPanel/AgentWorkspace/FileExplorer 的 props 钻取大幅收敛（AppShell 顶层 `useState` 从迁移前的近 20 个降到个位数：仅剩 `preferences`/`project`/`activeSession`/`localEvents`）。**剩余（后续会话）**：把命令式 handler（训练/预处理/导出/课程等 ~40 个，连同 `localEvents`）抽成 feature hooks → 拆 `AppShell` JSX 为容器 + 各区子组件薄分发；按需评估 `project`/`activeSession` 是否入 store。

## 2026-06-26 设计参考资产与 CLAUDE.md 项目配置

- 补充 `CLAUDE.md`（项目级 Claude Code 配置）：记录技术约束（纯 CSS / Catppuccin / lucide-react / Inter+JetBrains Mono）、设计质量护栏（品牌参考资产索引 + 反模式禁止 + 动画约束）和关键文件索引，作为所有 AI 辅助工作的约束基线。
- 新增品牌设计参考文档（`docs/design-references/`）：
  - `linear-design.md` — 紧凑操作 UI、命令面板、键盘驱动工作流参考
  - `cursor-design.md` — AI IDE 编辑器风格、暖色调深色主题、代码优先视觉参考
  - `supabase-design.md` — 数据仪表板模式、技术向保守配色、产品截图叙事参考
  - `impeccable-antipatterns.md` — AI-slop 设计反模式规则（字体/色彩/布局/动效/图标/内容六大类禁止项）
- 新增 `docs/tech-evaluation/shadcn-ui-assessment.md`：评估 shadcn/ui 与 MLAgent 纯 CSS 路线的兼容性，结论为 **暂不引入**（已有 Catppuccin token 体系与 Zustand/React Query 地基，shadcn 价值主张是 Tailwind + Radix，与项目路线不兼容）。
- 新增 `docs/ui-patterns/animation-patterns.md`：为 MLAgent 工作台量身定制的动效规范，包含状态过渡（150-300ms 缓出）、微交互（骨架屏/加载反馈/hover 操作显露）和 `prefers-reduced-motion` 回退要求。
- 更新 `AGENTS.md`：增加「项目设计约束」速查表（纯 CSS 架构 / Catppuccin / lucide-react / 锁定字体），并在前端优化 Agent 工作流步骤中补充具体参考文件指引。
- 更新 `docs/skills/mlagent-frontend-product-designer/SKILL.md`：扩充参考资产索引表（P0/P1/P2 优先级），在设计规则各节插入 Catppuccin 色彩约束、动画约束（引用 `animation-patterns.md`）、设计反模式摘要（引用 `impeccable-antipatterns.md`）和品牌哲学摘要（Linear / Cursor / Supabase），并在实现技术规范末尾加入「绝对禁止引入第三方 UI 框架」与「新 CSS 必须使用 Catppuccin token」两条强约束。
- 以上均为**文档类变更**，不涉及应用代码；未执行新的测试运行，功能基线保持 `eslint 0 / vitest 93 passed / tsc + build` 全绿。

## 2026-07-18 前端状态架构（P1-1，U6 领域 action hooks 收口）

- 已执行 `git fetch --all --prune` 并复核提交历史：当前 `feat/p0-backend-hardening` 与 `origin/feat/p0-backend-hardening` 同步，远端最新提交仍为 `74af40e`；已提交基线完整覆盖 P1-1 的 React Query 服务端状态迁移与 Zustand U1-U5。
- 接续工作区中尚未跟踪的 4 个领域 hook 半成品，先修复 `useFileActions` 的 mutation 类型契约（由 `useProjectFileMutations` 导出稳定的 `ProjectFileMutations` 返回类型），再接入 `AppShell`。
- **U6·领域命令拆分**：文件域（上传/创建/重命名/删除/选择）、分析域（报告/画像/预处理/清洗/ML 移交）、训练域（训练/重试/评估/导出/GPU）、进化域（提取/重试/采用/拒绝/冲突）分别由 `useFileActions`、`useAnalysisActions`、`useTrainingActions`、`useEvolutionActions` 承担；缓存刷新、任务事件、错误态与导航副作用仍在各自领域内闭环。
- 行为保持要点：文件选择仍同步数据集/预处理计划上下文；实验选择仍同时聚焦 run、切换 Experiments 活动面板并进入 Machine Learning；训练/评估/导出/学习仍刷新对应 React Query 缓存并写入既有 typed local events；WebSocket approval/resume 继续走 `useAgentStream` 原协议。
- `AppShell.tsx` 从 HEAD 基线 1,758 行降至 698 行（删除 1,026 行领域 handler 和失效 helper/import），现在仅负责 bootstrap、项目/会话生命周期、query/hook 装配、durable context 派生与已有工作台区域分发。保留 `project`/`activeSession`、`preferences`、`localEvents` 在容器中是刻意边界，不再为了行数引入大 props JSX 包装组件。
- 验证通过：`npm.cmd run lint`；`npm.cmd test`（16 files / 93 passed，含 `AppShell.smoke.test.tsx`）；`npm.cmd run build`（TypeScript project build + Vite production build）。本片不改变可见 UI，故无需新增浏览器视觉 QA。
- **P1-1 Frontend state architecture 已完成**。下一优先级回到生产就绪 backlog：P0-2 AuthN/Z + multi-tenancy，或按产品体验路线推进 P1-2 Rich chat + real charts；两者都应另开独立垂直切片，避免与本次结构收口混杂。

## 2026-07-18 认证与多租户（P0-2，JWT 身份 + 资源隔离地基）

- 按生产就绪优先级启动 P0-2。威胁模型聚焦三条边界：伪造 Bearer 身份（Spoofing）、用已知 `project_id`/`session_id` 横向读取另一租户文件/模型/日志（Information Disclosure / Elevation of Privilege）、JWT 模式下利用 `open-local` 注册任意服务器目录（Tampering / Disclosure）。因此没有只给 `/api/projects` 做表面认证，而是把同一身份上下文绑定到全部项目域 HTTP 和 WebSocket 路由。
- 新增 `backend/app/core/auth.py`：`AuthenticatedUser` + 请求级 `ContextVar`，认证模式显式分为 `development`（兼容本地 `dev-user`）和 `jwt`。JWT 使用 PyJWT 2.13，算法固定 allowlist `HS256`，要求签名、`exp`、`sub`，支持 issuer/audience/leeway；缺失、篡改、过期统一 401 + `WWW-Authenticate: Bearer`，密钥不足 32 bytes 时 503 失败关闭。JWT secret 以 Pydantic `SecretStr` 保存，避免配置 repr 泄漏。
- `main.py` 对 projects/files/data-analysis/machine-learning/evolution/resources/sessions/WebSocket 集中挂载 `bind_current_user`；health 与只读 LLM status 保持公开。内部 `get_registered_project`/`list_registered_projects` 自动读取同一请求身份，既覆盖 API helper，也覆盖 WebSocket 内 orchestrator 的项目解析。
- 项目注册表改为真正按租户分区：内存 key 为 `(workspace_key, project_id)`；磁盘目录使用 `usr_<sha256(subject)>`，避免 subject 中路径字符或 PII 直接进入文件系统；`owner_id` 保留真实 subject。registry 加 owner 一致性校验，拒绝把别人的项目写入当前注册表，并忽略 owner 不匹配的磁盘记录。
- JWT 模式禁用 `/api/projects/open-local`；GPU status/cancel 也补上项目所有权校验，不再只相信 URL 中的 `project_id`。跨租户测试覆盖 project list/detail、file tree、session message、GPU resource，均返回 404；WebSocket 无 token 在握手阶段返回 401，合法 token 可正常建立连接。
- 依赖与安装：新增 `PyJWT>=2.13.0,<3.0.0`；`.env.example` 增加 auth 配置说明；`pyproject.toml` 显式只发现 `app*` 包、排除 runtime `workspaces*`，修复存在本地工作区数据时 `pip install -e ".[dev]"` 误报多个顶层包。标准 editable install 已实测成功，`python -m pip check` 无 broken requirements。
- 测试遵循红→绿：新增 JWT 缺失/篡改/过期/短密钥、租户隔离、JWT 禁用 open-local、WebSocket 握手测试；既有 GPU API 测试改为先创建真实项目，以匹配新的所有权前置条件。最终完整后端回归 `177 passed, 3 skipped`；Ruff 全量通过，`python -m pip check` 与 `git diff --check` 通过。
- **P0-2 仍为进行中**：当前是受信外部 HS256 token 的资源服务器地基，还没有浏览器登录/登出、token issuer、OIDC/JWKS、组织/角色 claims 或 auth audit event。下一切片建议接 OIDC Authorization Code + PKCE / JWKS，并通过 httpOnly + secure + SameSite cookie 或 BFF 会话把身份安全带到前端，禁止把 bearer token 存入 localStorage。

## 2026-07-18 认证与多租户（P0-2，OIDC/JWKS RS256 验签）

- 承接 HS256 资源服务器地基，新增 `auth_mode=oidc`。本片只负责验证由受信 OIDC Provider 签发的 bearer token，不虚构登录页或把 token 暴露给浏览器存储；浏览器授权码流程留给下一独立切片。
- 信任边界按 RFC 8725 / OIDC Discovery / PyJWT 2.13 行为收紧：OIDC 固定 `RS256`，不与 `HS256` 共用算法集合；token header 必须在取钥前满足 `alg == RS256`、存在非空 `kid`（≤128 字符、无控制字符），因此算法混淆和无 key-id token 不会触发 JWKS 网络访问。应用只读取 operator 配置的 JWKS URL，忽略 token 自带的 `jku`/`x5u`。
- OIDC 配置必须同时提供 issuer、audience、JWKS URL。issuer 与 JWKS URL 都要求 HTTPS、禁止嵌入用户名/密码与 fragment；issuer 额外禁止 query，JWKS URL保留规范允许的 query。非法 URL、非正缓存 TTL、0/过大 timeout 均以 503 失败关闭。
- 使用 PyJWT `PyJWKClient` 的 JWK Set cache + signing-key LRU cache，缓存 TTL 默认 300 秒、限制 1–86400 秒；网络 timeout 默认 5 秒、限制 `(0, 30]`，避免 IdP/JWKS 故障无限拖长 API 请求。依赖改为 `PyJWT[crypto]>=2.13.0,<3.0.0`，显式获得 RSA 验签所需 cryptography 支持。
- token claims 强制 `exp/sub/iss/aud` 并绑定配置 issuer/audience；未知 `kid`、JWKS 获取/解析失败、签名失败、过期或 claims 不匹配统一返回 401 + `WWW-Authenticate: Bearer`，不向调用方暴露 JWKS 地址、key id 查找细节或异常文本。
- TDD 逐条完成：① 合法 RS256 token（500→200）；② 缺失 `kid` 在 JWKS 前拒绝（500→401）；③ 非 HTTPS issuer 配置失败关闭（401→503）；④ 非法 JWKS timeout（200→503）；随后补齐 HS/RS 混淆、未知 key、issuer/audience 绑定回归。`tests/test_auth.py` 当前 13 passed，认证/注册表/文件/会话聚焦回归 43 passed。
- 最终门禁：标准 `pip install -e ".[dev]"` 成功；`python -m pip check` 无 broken requirements；ruff 全量通过；完整 backend `184 passed, 3 skipped`；`git diff --check` 通过。
- **P0-2 仍为进行中**：下一切片实现 OIDC Authorization Code + PKCE 与 BFF/httpOnly cookie 会话，补 state/nonce、回调一次性消费、Secure/SameSite、登出与会话撤销；仍明确禁止把 access/id token 写入 localStorage。

## 2026-07-18 认证与多租户（P0-2，Authorization Code + PKCE / BFF 会话）

- 新增公开认证路由 `backend/app/api/auth.py`：`GET /api/auth/login` 创建 Authorization Code 请求，`GET /api/auth/callback` 换取并验证 ID Token，`GET /api/auth/session` 返回稳定的浏览器登录状态契约，`POST /api/auth/logout` 幂等撤销会话。OIDC authorization/token/callback/return URL 均为 operator 固定配置，要求 HTTPS，不接受请求参数控制回跳地址，避免 SSRF 与 open redirect。
- PKCE 固定 `S256`：每次登录生成高熵 `code_verifier`、`state`、`nonce`；浏览器只得到 callback path 限定的 `HttpOnly; Secure; SameSite=Lax` 不透明事务 cookie。`AuthSessionService.consume_login_transaction` 在锁内校验并弹出事务，因此同一合法 state/cookie 也只能消费一次；错误 state 不触发 token exchange，错误 nonce 与重放均不能建立会话。
- token endpoint 只接收 `authorization_code`、固定 redirect URI 与 PKCE verifier。公开客户端在 form 中发送 client id；配置 client secret 时改用 HTTP Basic（OIDC 默认 `client_secret_basic`），secret 不进入 URL、表单、响应或浏览器。第三方响应以大小上限 + Pydantic allow-schema 视为不可信输入，网络错误、非成功响应、畸形/超大 JSON 统一映射为无 provider 内部细节的 502。
- ID Token 复用既有 RS256/JWKS 固定算法与取钥路径，额外绑定 browser client id audience 和一次性 nonce；当 `aud` 含多个值时强制匹配 `azp`，存在 `azp` 时也必须等于目标 client。成功后只创建服务端随机会话 ID，cookie 为 `HttpOnly; Secure; SameSite=Strict; Path=/`；不保存、不下发 access token 或 ID Token，注销会立即从服务端移除会话。
- cookie 认证已接入既有 `get_current_user`，因此 projects/files/sessions/resources 和 WebSocket 自动复用原租户隔离。所有 cookie 认证的非安全 HTTP 方法与 WebSocket 握手必须提供匹配 `cors_origins` 或前端 return origin 的 `Origin`；无来源/伪造来源返回 403，Bearer API 客户端不受该浏览器 CSRF 规则影响。登录/回调响应加入 `Cache-Control: no-store`，回调跳转加入 `Referrer-Policy: no-referrer`。
- TDD 覆盖 10 个浏览器认证用例：PKCE 跳转与 cookie 属性、完整回调→session→受保护项目→logout 黄金路径、错误 state、nonce mismatch、多 audience 缺失 azp、一次性回调重放、CSRF Origin、真实 token exchange form/Basic auth、畸形 provider 响应、非 HTTPS authorization endpoint 失败关闭。认证聚焦回归 `23 passed`；完整 backend `194 passed, 3 skipped`（99.29s）；Ruff 全量、`python -m pip check`、`git diff --check` 均通过。
- **当前边界与下一步**：事务和浏览器会话当前是单进程内存存储，已经具备 TTL、原子消费和立即撤销语义，但不适用于多 worker/多实例。P0-2 下一切片应迁到 Redis（共享 TTL + 原子 get/delete），随后用项目专用前端设计 skill 接入登录状态与登出入口；组织/角色 claims 和认证审计仍未完成，因此 P0-2 保持进行中。

## 2026-07-20 Git 收口与进度同步

- 执行 `git fetch --all --prune` 后确认 `feat/p0-backend-hardening` 在收口前与 `origin/feat/p0-backend-hardening` 完全对齐（ahead/behind `0/0`），远端基线为 `74af40e`；未混入远端新增提交。
- P1-1 前端 action hooks 与薄容器收口已提交为 `b5b729a refactor(frontend): complete AppShell action hook decomposition`。提交包含 `useFileActions`、`useAnalysisActions`、`useTrainingActions`、`useEvolutionActions` 以及 `AppShell` 接线，P1-1 保持完成状态。
- P0-2 JWT/OIDC/多租户与浏览器 PKCE/BFF 会话已提交为 `6e1d301 feat(auth): add tenant isolation and OIDC browser sessions`。该提交包含请求身份、租户资源隔离、RS256/JWKS、Authorization Code + PKCE、一次性登录事务、可撤销 httpOnly 会话、CSRF Origin 防护和对应测试。
- 提交前重新执行完整门禁：backend `194 passed, 3 skipped`（101.46s）、Ruff 全量通过、`python -m pip check` 无 broken requirements；frontend ESLint 通过、Vitest `16 files / 93 passed`、TypeScript + Vite production build 通过；`git diff --check` 通过，差异扫描未发现疑似硬编码凭据。
- 本节与 `task_plan.md` 的真实提交号同步作为独立文档提交收口。`b5b729a`、`6e1d301`、`e41627e` 已于 2026-07-20 推送到 `origin/feat/p0-backend-hardening`；P0-2 后续仍按 Redis 共享会话存储 → 前端认证入口 → 组织/角色 claims 与认证审计的顺序推进。

## 2026-07-21 环境同步 + 分支收敛（切回 feat/p0-backend-hardening 主线）

- 会话开始时本地检出的是另一条平行分支 `codex/p0-remediation`（2026-07-17 起，仅 3 提交的纯后端 P0 努力，从未推送），其 JWT/observability 与主线 `feat/p0-backend-hardening`（40+ 提交，全栈，P0-1/P0-3/P0-4/P1-1/P1-4/P1-6 + P0-2 OIDC）重复且更弱。经比对提交时间线（主线最新 `8a1df38` @ 2026-07-20 23:17，晚于平行分支）确认主线为「最新进度」。
- 保全动作：把 `codex/p0-remediation` 工作区里未提交的冗余 LLM 适配草稿（`services/llm/` + config + 两个测试）提交为该分支的 `5bd501f`（durable 留存、不丢失），随后 `git checkout -b feat/p0-backend-hardening origin/feat/p0-backend-hardening` 切回主线，后续工作全部在主线进行。
- 环境修复：本地 venv 缺 `cryptography`（`PyJWT[crypto]` 未同步），认证测试无法收集 → `pip install -e ".[dev]"` 补齐；Windows 下 pytest 默认 basetemp `C:\Users\DELL\AppData\Local\Temp\pytest-of-DELL` 的 `os.scandir` 被拒（WinError 5），改用 `--basetemp="E:/ml_agent/backend/.tmp_pytest"` 非破坏性重定向后基线可跑。

## 2026-07-21 认证与多租户（P0-2，浏览器会话迁移到 Redis 共享存储）

- 承接 P0-2 既定下一步：登录事务与浏览器会话此前是单进程内存字典，无法用于多 worker/多实例。本切片抽出存储适配层并新增 Redis 后端，使同一份认证状态可跨进程共享。
- **绿基线修复（预备提交 `a0773d1`）**：完整套件在主线暴露 `test_experiment_service` 因 `created_at` 在同一 Windows 时钟刻度内碰撞而 flaky（`list_runs` 最新优先契约退化为文件系统 glob 序）。从平行分支 cherry-pick 自己此前的 `d5bdb8d`（`_next_created_at` 让时间戳至少比最近记录晚 1 微秒 + 冻结时钟回归测试），基线恢复 `195 passed, 3 skipped`。
- **存储抽象**：`auth_session_service.py` 新增 `AuthSessionStore` Protocol（`put/consume_login_transaction`、`put/get/revoke_session`、`clear`），把既有内存逻辑收敛为 `InMemoryAuthSessionStore`，`AuthSessionService` 改为薄领域层（只负责生成高熵 token/TTL，持久化下沉到 store）。`api/auth.py` 与 `core/auth.py` 的公开调用面不变，既有 23 个认证/浏览器测试零改动通过。与 `kernel_service.py` 的 Local/Docker 适配器同构，未引入多余抽象。
- **Redis 后端**：`RedisAuthSessionStore` 用原生 `SET ... EX` 得到共享 TTL；一次性消费用 redis-py 的 **WATCH/MULTI 乐观锁**保证并发下仅一个消费者删除成功（防重放），state 校验仍在 Python 侧用 `compare_digest` 常量时间比对，保持「错误 state 不消费未决事务」的原语义（未用 Lua，故不需要 `lupa`）。键命名空间 `mlagent:auth:{login,session}:`，`AuthenticatedUser`（id/workspace_key/auth_mode）JSON 序列化往返。
- **后端选择**：`config.py` 新增 `auth_session_backend: Literal["memory","redis"] = "memory"`（默认内存、保持既有行为与测试），`redis` 时从 `redis_url` 惰性构造客户端（导入期不连接）。模块单例 `auth_session_service` 按 settings 选择后端。
- **测试（TDD 红→绿）**：新增 `tests/test_auth_session_store.py`，`store` fixture 参数化覆盖内存与 `fakeredis` 两后端跑同一契约（一次性消费、错误 state 不消费、缺失返回 None、会话往返保用户身份、revoke、clear），外加内存墙钟过期、Redis 原生 TTL 断言、service 唯一高熵 token、service+Redis 往返、`_build_store_from_settings` 选择后端。`fakeredis>=2.20.0` 加入 dev 依赖。
- **门禁**：完整 backend `212 passed, 3 skipped`（19.17s，新增 17 个存储测试）；`ruff check app tests` 全量通过。分支按既定「先留本地」未 push。
- **follow-up**：`.env.example` 应补一行 `MLAGENT_AUTH_SESSION_BACKEND=memory`（当前工具环境对 `.env*` 路径有安全守卫、无法写入，`config.py` 已是带注释的配置真实来源）。P0-2 仍进行中，后续按 前端认证入口 → 组织/角色 claims 与认证审计 推进。

## 2026-07-21 认证与多租户（P0-2，前端登录/登出入口）

- 承接 P0-2 既定下一步「前端认证入口」。后端 `/api/auth/{login,callback,session,logout}` 已就绪，本切片在顶栏加入账户入口，把浏览器登录/登出接到既有 OIDC + BFF 会话。
- **顶栏 `AuthMenu`**（`features/auth/AuthMenu.tsx`）：镜像相邻 `ModelStatusIndicator` 的模式——mount 取 `/api/auth/session`、可注入 `loadSession`/`signOut`/`onSignIn` 供测试、click-outside + Escape 关闭 popover、lucide 图标、纯 Catppuccin hex（与相邻组件一致，P2-1 令牌化时统一收敛）。三态：`development` 显示固定 dev 身份且无登录/登出动作；OIDC 匿名给「Sign in」（整页跳 `/api/auth/login` 走 Authorization Code + PKCE）；已登录显示 subject + 可撤销「Sign out」（POST `/api/auth/logout` 后重取 session 保持指示器诚实）。
- **纯逻辑分离**：`features/auth/authSession.ts` 的 `describeAuthSession` 把 session/loading/error 映射为 `{tone,label,detail,action}` 视图模型（与 `llmStatus.ts` 同构，可无渲染单测）。
- **API 层**：`lib/api.ts` 的 `request()` 统一加 `credentials: "include"`（dev 模式无 cookie 无副作用，OIDC 模式让 httpOnly 会话 cookie 端到端流转；后端 CORS 已 `allow_credentials=True` + 指定源，安全匹配）；新增 `getAuthSession`/`authLoginUrl`/`logout`（204 不复用 `request` 的 JSON 解析，带 credentials 让后端按 cookie 撤销、浏览器自动带 Origin 满足 CSRF 校验）。
- **测试**：`authSession.test.ts`（6，纯逻辑各态）+ `AuthMenu.test.tsx`（3，jsdom：登出→重取、匿名→登录跳转、dev 模式无动作；vitest 无 `globals` 故显式 `afterEach(cleanup)`）。AppShell 冒烟测试自动经 `importOriginal` 桩掉新 api 函数，AuthMenu 在 session 未就绪时稳定渲染、冒烟仍绿。
- **门禁**：前端 `vitest` 18 文件 / 102 passed、`eslint` 0 error、`tsc -b` + `vite build` 生产构建通过。本机未跑浏览器视觉 QA（沙箱对 dist 静态托管有已知路径探测限制），交互接线由 `AuthMenu.test.tsx` 覆盖。`npm install` 对 `package-lock.json` 的版本规范化 churn 已 `git restore` 还原（原 lockfile 已含 jsdom/testing-library）。
- P0-2 仍进行中，剩余：组织/角色 claims 与认证审计日志；此外 Redis 会话存储的多实例部署验证与 `.env.example` 文档待环境允许时补。

## 2026-07-21 认证与多租户（P0-2，组织/角色 claims + 认证审计日志）

- P0-2 最后一块：从 token 提取组织/角色授权上下文，并为浏览器认证生命周期建审计轨迹。
- **组织/角色 claims**：`AuthenticatedUser` 增 `org_id: str | None` 与 `roles: tuple[str,...]`（tuple 保持 frozen dataclass 可哈希，默认值让 `_development_user`/会话反序列化零改动）。claim 名可配（`config.py` 新增 `auth_roles_claim="roles"`/`auth_org_claim="org_id"`）。`_claim_by_path` **先匹配字面 key 再回退点号路径**——既支持 Auth0 命名空间 claim（键含点号，如 `https://app.example/roles`），又支持 Keycloak 嵌套（`realm_access.roles`）。`_extract_roles` 接受 JSON 数组或单字符串，逐项做长度/控制字符/去重清洗、丢弃非法项；`_extract_org` 同样清洗。JWT 与 OIDC 两条路径的 `_authenticated_user_from_claims` 统一注入，`api/auth.py` 回调同步。
- **暴露与落地**：`GET /api/auth/session` 的 `BrowserSessionResponse` 增 `org_id`/`roles`，Bearer 与 cookie 两种认证都返回；`RedisAuthSessionStore` 会话 JSON 序列化携带 org/roles（`.get` 向后兼容旧会话）。新增 `require_roles(*roles)` 依赖工厂作为 RBAC 落地钩子（持有任一所需角色放行、否则 403；给定空集放行），**不改造现有路由**（哪些端点需要哪些角色属产品决策）。
- **认证审计**：新增 `app/core/audit.py::record_auth_event`，向专用 `mlagent.audit` logger 发结构化 `key=value` 行（经既有 logging filter 自动带 request id，含空格/引号的值转义）。接入点：回调成功 `login.success`（带 subject/auth_mode/org/roles）、回调失败 `login.callback outcome=failure`（区分 `invalid_transaction`/`token_exchange_failed`/`invalid_id_token`）、登出 `logout`（成功带 subject；无效 Origin 记 `outcome=failure reason=invalid_origin`）。刻意只审计离散的浏览器认证动作，不审计高频的逐请求 bearer 结果（那些在 access log 已可见）；绝不记录 token/cookie/PKCE verifier/client secret，但故意记录 subject（审计的本义是身份归属）。
- **测试（红→绿）**：`test_auth.py` 增 6 个——`/api/auth/session` 暴露 JWT claims 的 roles/org、单字符串角色、非法项丢弃去重、缺失默认空、嵌套/自定义 claim 路径、`require_roles` 放行/拦截；`test_browser_auth.py` 增 3 个 caplog 审计断言（登录成功/拒绝/登出）。修一个既有测试：session 响应精确断言补 `org_id`/`roles`（契约扩展的合理后果）。踩坑：命名空间 org claim 键 `https://mlagent.example/org` 含点号被点号分割误拆，靠「字面 key 优先」修正。
- **门禁**：完整 backend `221 passed, 3 skipped`（+9），`ruff check app tests` 全绿。分支按既定「先留本地」未 push。
- **P0-2 至此后端能力齐备**（JWT/OIDC/PKCE + 租户隔离 + Redis 共享会话 + org/role claims + 认证审计）。收尾前的待办：`.env.example` 补新配置项（`.env*` 工具守卫）、Redis 多实例部署实测、前端可选展示角色/组织；这些属部署/文档/UX 层，不阻断 P0-2 后端。

## 2026-07-21 富文本聊天与图表（P1-2，切片 1：Agent 消息 Markdown 渲染）

- P1-2 拆两切片推进。切片 1 处理富文本聊天：agent 消息此前是 `<p>{content}</p>` 纯文本（无 Markdown/代码高亮），流式回复同样。
- **`MarkdownMessage` 组件**（`features/chat/`）：`react-markdown` + `remark-gfm`（GFM 表格/列表/删除线）+ `rehype-highlight`（代码块语法高亮）。**安全**：react-markdown 默认转义原始 HTML，刻意不加 `rehype-raw`，模型输出无法注入标记；链接强制 `target="_blank" rel="noreferrer noopener"`。插件数组提到模块级保持稳定引用，利于流式重渲染时 react-markdown 复用 processor。`memo` 包裹避免历史消息在父组件重渲染时重复解析。
- **接入 `AgentWorkspace`**：仅 agent 消息与流式回复走 Markdown，用户消息保持 `<p>` 纯文本（避免用户输入里的 `*` 等被误解析，符合主流聊天惯例）。空状态 demo 对话不动（属 P1-7）。
- **样式**：`styles.css` 新增 `.markdown-body`（标题/列表/表格/引用/内联码/代码块，全 Catppuccin 原始 hex，与既有组件一致）+ 一套 Catppuccin Mocha 的 `.hljs-*` 语法主题（keyword=mauve/string=green/number=peach/function=blue/type=yellow 等）。
- **bundle 控制**：`react-markdown + rehype-highlight(highlight.js)` 让主包从 471KB 涨到 808KB。试过用 rehype-highlight 的 `languages` 选项限定语言集，**无效**（它模块顶部静态 `import {common} from 'lowlight'`，运行时选项不影响打包）。改用 **`React.lazy` 懒加载** `MarkdownMessage`：markdown+highlight 拆成 335KB 按需 chunk，初始包回到 473KB（≈原始，无回归），>500KB 警告消失；两处用 `<Suspense fallback={<p>{content}</p>}>` 包裹，chunk 加载瞬间先显纯文本再升级 Markdown。彻底的路由级分割仍归 P2-8。
- **测试**：`MarkdownMessage.test.tsx`（jsdom，4 个）——GFM 粗体/表格、Python 代码块 `.hljs`/`.hljs-keyword`、**原始 HTML 不渲染为元素（注入防护）**、链接新标签页 + noreferrer。
- **门禁**：前端 `vitest` 19 文件 / 106 passed、`eslint` 0、`tsc -b` + `vite build`（拆分为 index 473KB + MarkdownMessage 335KB）全绿。未跑浏览器视觉 QA（沙箱限制）。切片 2（真实图表库替换手写 SVG 色块）待续。

## 2026-07-21 富文本聊天与图表（P1-2，切片 2：真实分布直方图 Recharts）

- 切片 2 处理真实图表：数据画像的分布直方图此前在 `RightPanel` 用 `.artifact-histogram span` 定高色块渲染（真实 `bins` 数据但手写 SVG）。引入 **Recharts 3.10** 替换为真正的柱状图。
- **纯逻辑 + 薄组件**：`histogramSeries.ts::buildHistogramSeries` 把 profiling `bins`（start/end/count）整形为图表行（X 轴 label=下界、tooltip range="start – end"、count 缺省 0 不为 NaN，极值用科学计数法），纯函数便于 node 单测（Recharts 在 jsdom 无布局，渲染不可靠）。`HistogramChart.tsx` 是 Recharts `BarChart`（`ResponsiveContainer` 自适应宽、Catppuccin 配色：网格 #313244 / 轴 #45475a / 柱 #89b4fa / tooltip #11111b），`memo` 包裹。
- **bundle**：Recharts + d3 依赖约 381KB。与切片 1 同法用 `React.lazy` 懒加载 `HistogramChart`，Recharts 拆成按需 chunk，初始包保持 473KB（无回归）；直方图卡片用 `<Suspense fallback="加载分布图…">` 包裹。构建产物：index 473KB + MarkdownMessage 335KB + HistogramChart 381KB，均 <500KB 无警告。
- **清理**：删除失效的 `.artifact-histogram`/`span` 色块 CSS 与只服务色块的 `maxCount`，替换为 `.histogram-chart`/`.artifact-histogram-fallback`。
- **测试**：`histogramSeries.test.ts`（4）——空 bins、count/range 映射、缺省字段不为 NaN、大整数保留可读 + 极值科学计数法。踩坑：初版测试期望 `25000→2.5e+4` 错误（整数走可读分支返回 "25000"），已改用非整数验证科学计数法分支。
- **门禁**：前端 `vitest` 20 文件 / 110 passed、`eslint` 0、`tsc -b` + `vite build` 全绿。
- **P1-2 两切片交付**：富文本聊天（Markdown/高亮/流式）+ 真实图表库（Recharts 替换真实数据的直方图色块）。`DemoChartGallery` 的硬编码 demo 柱/热力图/相关性网格是**演示数据**，归 P1-7（清理演示数据、由真实产物驱动）处理，不在此 re-chart 假数据。后续可选增强：特征重要性横向柱状图、混淆矩阵热力图（均为真实 ML 数据）。P1-2 已标记完成（`1926ef0`）。

## 2026-07-21 清理演示数据（P1-7）

- 承接 P1-2：应用里大量"看起来在工作、其实是占位"的硬编码演示内容，误导真实/演示边界。本次删除并由真实状态/产物驱动空状态。
- **AgentWorkspace**：① 删除 `sampleRows`（硬编码 Telco 样本表）+ 始终显示的 `.analysis-grid`（假"数据预览（前 4 行）"表 + `copy.code(activeFile)` 模板 pandas 代码）——真实的数据/代码预览本就在 RightPanel 的数据/代码 tab，中间这块是误导性冗余。② 假空状态对话（写死的"你 · 10:21 请分析…"+ `copy.assistant` + `copy.plan` 执行计划）换成真实空状态 `.conversation-empty`（用真实 `copy.title`/`copy.description` + 通用引导语，无伪造对话）。③ 从 `modeCopy` 两个条目删除只服务演示的 `assistant`/`plan`/`code` 字段（`tools`/`description`/quick 动作等真实配置保留）；清理失效的 `Database`/`FileCode2`/`CheckCircle2` 图标 import。
- **RightPanel**：`DemoChartGallery`（图表 tab 无选中产物时的空状态，含假热力图/假直方图/假相关性网格 + 真实操作按钮）重写为 `ChartsEmptyState`——删除三块假可视化与其 `bars`/`heatCells` 假数据，保留真实的生成画像/报告/预处理/清洗/交接 ML 按钮，加"还没有图表产物"真实空状态提示；清理失效的 `LineChart` import。
- **顺带（测试可靠性）**：`AppShell.smoke.test.tsx` 的 api catch-all 桩由 `async () => undefined` 改为 `async () => null`——react-query v5 拒绝 undefined 查询数据、间歇性抛未处理拒绝扰乱 vitest 计数；消费方都用 `?? []`/null 检查，改 null 行为等价且被 react-query 接受，显著减少 flaky（残留一个更深层的 effect 时序脆弱仍偶发但不导致测试失败，归 P1-5）。
- **门禁**：前端 `eslint` 0、`tsc -b` + `vite build`（index 469.75KB，比清理前更小）、`vitest` 20 文件 / 110 passed 全绿。未跑浏览器视觉 QA（沙箱限制）。
- 遗留（非本次）：`.analysis-grid`/`.visual-card`/`.heatmap-grid` 等失效 CSS 未删（归 P2-1 CSS 令牌化统一清理）；quick 动作 prompt 里的示例 "churn" 是功能性模板文案，保留。

## 2026-07-21 持久化决策（P1-3，文件系统优先 + 删死代码）

- 用户拍板：以文件系统 JSON 为持久化真相，删除无引用的 Postgres/SQLAlchemy/ORM 死代码，让代码库诚实反映"文件系统 + Redis"架构（不做数周的 Postgres 全量迁移）。核实前提：`grep` 确认业务代码与测试均无 `app.db`/`app.models`/`sqlalchemy` 引用，`get_db`/`SessionLocal`/`engine`/`Base.metadata` 零调用；`database_url` 仅在 config 定义 + 已删的 `db/session.py` 使用；无 alembic 目录。
- **删除**：`app/db/{base,session}.py`、`app/models/{artifact,project,session}.py`（`db/`、`models/` 目录随之消失）。
- **依赖**：`pyproject.toml` 移除 `sqlalchemy`/`psycopg[binary]`/`alembic`（保留 `redis`——P0-2 起承载 auth 会话，是真实依赖）。
- **配置/基建**：`config.py` 删 `database_url`；`infra/docker-compose.yml` 移除 `postgres` 服务与 `mlagent_postgres` 卷，保留 `redis`。
- **门禁**：完整 backend `221 passed, 3 skipped`（删死代码零破坏）、`ruff` 全绿、`app.main` 正常导入（15 路由）。
- **follow-up**：`.env.example` 第 51 行 `MLAGENT_DATABASE_URL` 应删（`.env*` 工具守卫无法编辑；pydantic-settings 默认忽略多余 env，故残留无害）；venv 里 sqlalchemy 等已安装包成为孤儿（无害，重装即清）。Redis 保持真实使用。

## 2026-07-21 GitHub 进度入口 + 测试补强（P1-5）

- **GitHub 同步**：确认 `feat/p0-backend-hardening` 工作树干净且与 `origin/feat/p0-backend-hardening` 一致；该分支相对 `master` 领先 50 个提交、103 个文件，但此前没有 PR。创建草稿 PR #2 `feat: production-ready LLM, auth, observability, and frontend foundations`，用完成矩阵同步 P0-1/P0-2/P0-3/P0-4 与 P1-1/P1-2/P1-3/P1-4/P1-6/P1-7，并把 P1-5 标为当前工作。
- **Playwright golden path（TDD 红→绿）**：新增 `@playwright/test`、`frontend/playwright.config.ts` 和 `frontend/e2e/golden-path.e2e.ts`。测试以真实 API 创建隔离项目和 CSV，生成数据画像/预处理计划，执行预处理并训练 baseline；浏览器随后验证画像表、变换后数据预览、机器学习模式、聚焦实验与评估报告路径。Playwright 自动拉起 FastAPI + Vite，本地 Windows 优先复用已安装 Chrome，CI 安装 Chromium；失败时保留 screenshot/video，首重试保留 trace。
- **CI 闸门**：`.github/workflows/ci.yml` 新增独立 `Playwright golden path` job，依赖 backend/frontend 单元闸门；安装后端运行依赖、前端依赖与 Chromium 后执行 `npm run test:e2e`，并上传 7 天 HTML 报告。Vitest 与 E2E 用 `.test.ts(x)` / `.e2e.ts` 命名隔离，避免两个 runner 互相收集。
- **握手竞态修复（TDD 红→绿）**：首次 E2E 虽通过，但快速页面导航暴露 Uvicorn/Starlette WebSocket 握手期间客户端断开时的重复 `websocket.accept` RuntimeError。先在 `test_websocket_session.py` 加失败回归，再让 `session_socket` 只吞掉明确的 accept 断连竞态，其余 RuntimeError 继续抛出；focused 回归与 Ruff 通过，E2E `--repeat-each=3` 连续 3/3 通过且不再出现 ASGI error。
- **GitHub CI 修复**：PR #2 首轮 backend job 在 GitHub-hosted Linux runner 上失败 3 条 Docker Kernel 集成测试。根因不是产品回归：runner 的 Docker daemon 可用，使旧 `is_docker_running()` 门槛放行，但本地镜像 `mlagent-kernel:dev` 不存在，Docker 随后尝试拉取不存在/无权限的仓库。经确认后把两处门槛改为 `docker image inspect $MLAGENT_KERNEL_IMAGE`：仅在 CLI、daemon 与指定镜像全部可用时运行；普通 PR CI 稳定跳过，显式准备好镜像的集成环境仍会执行。聚焦验证 `12 passed, 3 skipped`，跳过原因均为 `Docker kernel image is not available`。
- **门禁**：backend Ruff 全绿、完整 pytest `222 passed, 3 skipped`；frontend Vitest `20 files / 110 tests`、ESLint、TypeScript + Vite build 通过；Playwright golden path 单次及 `repeat-each=3` 通过。P1-5 完成，P0/P1 生产就绪 backlog 至此全部完成，下一主线转入 P2-1 设计令牌系统。

## 2026-07-21 P2-1 设计令牌系统（切片 1：颜色基础）

- **动态审计**：计划文档的旧基线已漂移；当前 `styles.css` 实际约 3757 行、480 个十六进制引用、62 种裸色且没有 CSS 变量。按 P2-1 拆成可验证子切片，先稳定颜色语义，再处理 spacing/radius/z-index 和文件拆分。
- **TDD 红→绿**：新增 `frontend/tests/design-tokens.test.mjs`，先确认缺少语义令牌、令牌块之外存在裸色、存在装饰性渐变三项均失败；实现后 3/3 通过。测试直接读取真实 CSS 文件，避免 Vitest CSS 代理造成假通过。
- **令牌化**：在 `:root` 建立 35 个 Catppuccin 语义与 RGB 通道令牌，覆盖 canvas/surface/raised/overlay、边框、文本、accent、success/warning/danger/ML 等；590 处引用全部改为 `var(...)` 或带透明度的 `rgb(var(--rgb-*) / alpha)`，未定义令牌为 0，令牌块之外的颜色字面量为 0。
- **视觉约束收口**：删除工作台、消息和旧直方图样式中的 4 处装饰性渐变；蓝色实心操作改为 Catppuccin accent + 深色前景，避免彩色背景上的低对比文字。
- **门禁**：frontend Vitest `21 files / 113 tests`、ESLint、TypeScript + Vite build、Playwright 真实 API golden path 均通过；1440×900 截图复核确认四栏层级、选中态、按钮前景无视觉回归。截图再次暴露 workflow 卡片在窄中心区逐字换行，这是已排期的 P2-3 响应式问题，不扩入本切片。
- **P2-1 状态**：整体仍为进行中。下一切片按顺序收敛 spacing/radius/z-index，清除 `.analysis-grid`/`.visual-card`/`.heatmap-grid` 等失效 CSS，再拆分全局 stylesheet 的 foundation/feature 层。

## 2026-07-21 P2-1 设计令牌系统（切片 2：尺寸、层级与基础分层）

- **动态审计**：从提交 `116a790` 的真实 CSS 统计出 338 条 spacing、101 条 `border-radius`、2 条 `z-index` 声明；静态类名交叉检索确认 11 组非 `hljs` 选择器没有任何 React/TypeScript 引用。旧计划中“直接完成 P2-1”因此拆成尺寸令牌、死 CSS、基础分层三个可验证目标。
- **TDD 红→绿**：扩展 `frontend/tests/design-tokens.test.mjs`，先观察 6 项预期失败：缺少 tokens/foundation 文件、缺少 spacing/radius/layer 令牌、实现层仍有裸 spacing/radius/z-index、退役选择器仍存在；实现后契约 7/7 通过。
- **4px spacing 与圆角层级**：新增 `--space-1` 至 `--space-12` 的 4px 基准刻度，将 feature CSS 的 spacing 声明全部迁移为 token；圆角统一为 4/6/8px、pill、round 五档；两个 popover 的 `z-index: 40` 统一为 `--layer-popover`。实现层对应裸值均为 0。
- **样式基础分层**：新增 `frontend/src/styles/tokens.css` 与 `foundation.css`，`styles.css` 只保留 product feature selectors 并显式按 tokens → foundation → feature 顺序加载。三文件合计 54 个定义令牌、48 个已引用令牌、0 个未定义引用。
- **失效 CSS 清理**：删除 `.analysis-grid`、`.visual-card`、`.heatmap-grid`、旧 `.histogram`/`.correlation-grid`、`.plan-card`/`.plan-grid`、`.compact-table`、`.code-preview`、`.code-panel`、`.workbench-card` 等 11 组已确认无引用的演示样式；真实 Recharts `.histogram-chart` 与 `hljs-*` 动态语法类保留。
- **门禁**：frontend Vitest `21 files / 117 tests`、ESLint、TypeScript + Vite build、Playwright 真实 API golden path 均通过；构建 CSS gzip 从约 9.15KB 降至 8.89KB；1440×900 截图确认操作密度、面板层级和按钮状态无回归。
- **动态计划调整**：P2-1 暂不勾选。`styles.css` 仍有 3601 行，下一切片按 shell/sidebar、agent/chat、right-panel、evolution/responsive 等产品领域拆分，并补显式 theme/brand override 契约；截图中的 workflow 阶段卡逐字换行继续归 P2-3，不混入本项。

## 2026-07-21 P2-1 设计令牌系统（切片 3：领域样式与主题覆盖，P2-1 完成）

- **边界审计与 TDD 红→绿**：按真实选择器顺序确认 shell/sidebar、agent/chat、right-panel/training/logs、evolution、responsive 五个连续产品域；将 `design-tokens.test.mjs` 从 7 项扩展到 9 项，先观察 4 项预期失败（缺少 theme 层、纯导入 manifest、领域文件、品牌覆盖），实现后 9/9 通过。契约现在读取全部实现层，避免拆文件后颜色/尺寸检查漏扫。
- **主题/品牌契约**：`tokens.css` 只负责 Catppuccin 原始 palette 与 spacing/radius/layer 基础刻度；新增 `themes.css` 把 palette 映射为 35 个业务语义颜色/RGB 角色，以 `:root, [data-theme="catppuccin-mocha"]` 提供默认主题，并以 `[data-brand-accent="ml"]` 将 accent 从蓝色切换为 ML 紫色。全样式共 89 个自定义属性、83 个被引用、0 个未定义引用；功能层仍为 0 裸颜色/spacing/radius/z-index、0 装饰性渐变。
- **领域拆分且行为保持**：`styles.css` 从 3601 行降为 8 条有序 `@import`；原 3595 行功能规则按 `shell.css`(899)、`agent.css`(897)、`inspector.css`(1243)、`evolution.css`(463)、`responsive.css`(93) 拆分。把 HEAD 原规则与五文件按边界重组后逐字符比较，73,153/73,153 完全一致，证明未改选择器、声明或级联顺序。
- **运行时验证**：新增 `e2e/design-system.e2e.ts`，真实浏览器确认四栏主工作面可见，默认 accent 计算值为 `rgb(137, 180, 250)`，设置 `data-brand-accent="ml"` 后为 `rgb(203, 166, 247)`；与真实 API 数据画像→预处理→训练 golden path 合跑 2/2 通过。
- **门禁与视觉复核**：frontend Vitest `21 files / 119 tests`、ESLint、TypeScript + Vite build 全绿；主 JS 仍 469.75KB，CSS gzip 9.21KB（显式 palette→semantic 映射的可接受增量）；1440×900 截图确认操作密度、面板层级、状态和按钮无拆分回归。截图中的 workflow 阶段逐字换行仍按计划归 P2-3。
- **动态回顾**：P2-1 三个切片的颜色、尺寸/层级、死 CSS、基础层、领域拆分和 theme/brand override 验收项均有直接证据，现勾选完成。重新审计 P2-2：现有 1 个功能性 pulse keyframe、2 处 120/140ms 过渡，但没有 motion token、`prefers-reduced-motion`、skeleton 或 `aria-busy`；下一主线先做动效基础与 reduced-motion 契约，再扩充诚实的异步加载态。

## 2026-07-21 P2-1 设计令牌系统（修正切片 4：跨 CSS/TSX 审计）

- **完成结论复核失败并主动重开**：进入 P2-2 前的跨源动效审计发现 `EvolutionWorkspace.tsx` 仍内嵌约 355 行 `<style>`，同时 Evolution SVG 与 `HistogramChart.tsx` 的 Recharts props 仍有 129 个裸十六进制/数值 RGB 命中和 2 个装饰性渐变。此前 `design-tokens.test.mjs` 只拼接 CSS 文件，因此“全功能层无裸色”的证据范围不足，P2-1 的完成结论暂时撤回并修正。
- **TDD 红→绿与覆盖扩展**：设计令牌契约由 9 项扩展到 11 项，先观察 3 项跨源失败（129 裸色、渐变、React `<style>`），再观察 1 项 responsive 领域职责失败；实现后 11/11。测试现递归读取全部生产 `.ts/.tsx`，并要求所有 viewport/container query 只存在于 `responsive.css`，堵住相同盲区。
- **样式归位与令牌化**：把 11.8k 字符图谱 CSS 从组件迁入 `evolution.css`，将三个图谱断点合并进 `responsive.css`；移除点阵/空状态渐变，使用 Catppuccin 平面语义背景；SVG 边/节点、图谱详情和 Recharts 轴/网格/Tooltip/Bar 全部改用 CSS 变量或领域类。新增 graph-muted 与 sky RGB 语义映射后，共 93 个定义属性、88 个引用、0 未定义。
- **直接审计证据**：生产 CSS/TS/TSX（排除唯一允许裸 palette 的 `tokens.css`）中裸 hex/数值 RGB/HSL、linear/radial gradient、React `<style>` 命中均为 0；shell/agent/inspector/evolution 中 `@media/@container` 命中为 0。
- **门禁与运行时**：frontend Vitest `21 files / 121 tests`、ESLint、TypeScript + Vite build 全绿；主 JS 由 469.75KB 降至 458.77KB，CSS gzip 10.72KB，合计 gzip 净下降约 1.1KB；Playwright 设计系统 + 真实 API golden path 2/2，通过 1440×900 Evolution 真实图谱截图复核，节点、边、详情与容器断点正常。
- **动态计划调整**：P2-1 在补齐原验收范围后重新确认为完成。P2-2 真实基线同步修正为 3 个 keyframe、7 个 transition（含 4 个 `transition: all`）、4 个 animation 使用点，无 reduced-motion/motion token/skeleton/`aria-busy`；下一切片先收口动效基础，不沿用先前不完整统计。

## 2026-07-21 P2-2 动效与加载态（切片 1：可访问动效基础）

- **审计分类与 TDD 红→绿**：按跨 CSS/TSX 真实基线把 3 个 keyframe、7 个 transition、4 个 animation 使用点逐一分类；设计系统契约先新增 4 项并观察全部预期失败（缺 motion token、存在 `transition: all`、动画裸时长、缺 reduced-motion），实现后由 11/11 增至 15/15。契约限制普通过渡只动画 token 化的 opacity/transform，并允许名称明确为 status/loading/skeleton/progress 的令牌化持续反馈，避免阻断后续真实加载态。
- **motion token 与过渡收口**：新增 `--duration-fast/normal/slow`（150/200/300ms）、`--duration-status-cycle`（1200ms）及共享 easing。7 处过渡收敛为 4 处 token 化 opacity/transform，4 处 `transition: all` 清零；文件操作显露、树箭头、洞察卡位移和图谱节点淡化各使用对应档位。
- **去装饰循环、保留状态语义**：删除 Evolution 的 `strokeFlow` 与 `pulseGlow` 持续动画；支持/触发边继续用静态虚线表达方向类别，选中节点使用静态描边与光晕，不再持续争夺注意力。模型与账户加载圆点的 1200ms opacity 脉冲承担真实状态提示，保留并令牌化。最终为 1 个 keyframe、2 个功能性 animation 使用点，Evolution animation 为 0。
- **reduced-motion 运行时证据**：在 `responsive.css` 增加全局 `prefers-reduced-motion: reduce`，把动画/过渡压到 0.01ms 且循环限制为 1。临时 Playwright QA 首次因项目级 Desktop Chrome 配置覆盖 `test.use` 而正确暴露 preference=false；改为页面级 `emulateMedia` 后，浏览器返回 preference=true、150/200/300ms token、animation/transition=1e-05s、iteration=1。临时 QA 文件随后删除。
- **门禁与视觉复核**：frontend Vitest `21 files / 125 tests`、ESLint、TypeScript + Vite build 全绿；主 JS 458.77KB 无回退，正式 Playwright 设计系统/Evolution + 真实 API golden path 2/2；1440×900 图谱截图确认静态虚线、选中节点、边与详情布局正常。当前共 99 个定义 token、94 个引用、0 未定义。
- **动态完成回顾**：加载态盘点发现 `FileExplorer.tsx` 仍用硬编码 `fallbackItems` 在“pending 或真实空目录”时展示 `customer_churn.csv`/`eda.py` 等假条目，直接削弱 P1-7 完成证据。P1-7 因此暂时重开；下一片不单做装饰 skeleton，而是先移除假 fallback，并把 React Query loading/empty/error 与 `aria-busy` 端到端传入文件工作流，再扩展其他高延迟面板。

## 2026-07-22 P1-7 修正 + P2-2 动效与加载态（切片 2：真实 File Explorer 状态）

- **完成边界重审**：沿 P2-2 加载态盘点继续追踪数据来源，确认真实性缺口不只在 `FileExplorer.fallbackItems`：`AppShell` 还会在空账户启动时自动创建 `sales_churn_analysis` 并上传 `data/customer_churn.csv`，`uiStore` 与项目激活流程也把该路径作为默认选择。因而将验收范围扩大为“生产代码无 demo bootstrap/default/fallback”，而不是只删一个数组。
- **TDD 红→绿**：新增 `tests/no-demo-data.test.mjs`，递归扫描生产 TS/TSX 并禁止 `sampleCsv`、`fallbackItems`、退役 demo 路径与自动建项；新增 `FileExplorer.test.tsx` 5 项，覆盖无项目、首次加载骨架、已加载空目录、带旧数据的刷新失败 + 重试、项目/会话独立刷新；AppShell 冒烟新增“空账户不自动创建或上传”回归。先稳定观察 `7 failed / 1 passed` 的预期红灯，实现后聚焦 `8/8`、全量 `23 files / 132 tests`。
- **真实启动语义**：删除自动演示项目和 CSV 写入，空账户保持未选项目；`activeFile`/`trainingDatasetPath` 初始值为空，项目激活只从真实文件中选择活动文件和数据集；展开目录预取复用 `listExpandedProjectFiles`，不再依赖特殊 `data/` 目录。
- **可访问异步状态**：项目、会话、文件区域分别接入 React Query `isFetching`、error、`refetch`，用 `aria-busy` 区分忙态；首次加载显示稳定三行骨架，保有数据时显示“正在刷新”，错误就地展示并提供重试，旧文件/会话列表不因刷新失败消失；无项目时文件新建、建目录、上传操作明确禁用。
- **视觉与动效约束**：新增平面 Catppuccin 骨架，颜色/间距/圆角/动画全部来自 token；仅循环 opacity 状态动画，无渐变、位移动效或布局抖动，并继承全局 `prefers-reduced-motion` 回退。空工作区截图人工复核确认三段引导、禁用态和 `Project: None / Session: None` 状态一致。
- **门禁**：生产 demo-data 直接扫描为 0 命中；frontend `npm.cmd test` 23 文件 / 132 tests、`npm.cmd run lint`、`npm.cmd run build` 全绿（index 460.66KB、CSS gzip 10.91KB）；Playwright 设计系统 + 真实 API 数据画像→训练 golden path `2 passed`。一次 Chrome 启动在页面执行前自行退出，随后完整重跑通过，判定为瞬时浏览器进程问题而非产品回归。
- **动态计划调整**：P1-7 在补齐跨启动/Store/File Explorer 的原验收范围后重新标记完成。P2-2 保持进行中，下一切片优先把同一 async-state 契约扩展到 Artifact Preview、Evolution 图谱和其他高延迟查询面板，再处理阶段/产物完成反馈；不继续给 File Explorer 添加装饰。

## 2026-07-22 P2-2 动效与加载态（切片 3：Artifact Preview 查询状态）

- **真实链路审计**：右侧选中产物内容仍由 `RightPanel` 内部 `useEffect` 命令式读取；每次切换先清空内容，错误只显示普通空态，无法局部重试，也不参与 React Query 缓存/失效，因此不存在后台刷新或失败时保留旧预览的语义。ActiveFilePreview 与 prediction samples 另有独立读取链，本片只处理选中产物，保持垂直切片可验证。
- **TDD 红→绿**：新增 `RightPanel.test.tsx` 3 项真实组件测试，分别要求命名预览区域 + `aria-busy` + 三行骨架、读取错误 `role=alert` + 局部重试、查询失效后刷新失败仍保留上次内容。修正一次 mock 队列隔离后，稳定观察 `3 failed` 均命中功能缺口；实现后聚焦 `3/3`、全量 `24 files / 135 tests`。
- **Query 迁移**：新增 `useProjectFileContentQuery`，query key 使用 project/path/artifact version，避免同一路径在短期重新生成时被 30 秒 `staleTime` 误判为旧产物；RightPanel 删除 `artifactContent`/`artifactError` 命令式 state/effect，直接派生 query data/error/isFetching/refetch。前缀失效仍可刷新同一路径的所有版本。
- **可访问状态与内容保真**：Artifact Preview 现在是 `aria-label="产物预览"` 的 region；首次读取显示平面 Catppuccin 骨架，缓存内容刷新时显示紧凑状态，错误就地提供“重试产物内容”。React Query 在 refetch error 时保留成功 data，因此 JSON/文本预览不被刷新失败清空。
- **样式与开发流程**：骨架只动画 opacity，使用 motion/status token 并继承 reduced-motion；无渐变或装饰循环。完整门禁首次发现 `CI=1` Playwright 失败重试生成的 `playwright-report/trace` 会被 `eslint .` 扫描，导致 3951 条第三方压缩资产误报；目录已在 gitignore 中，本次同步加入 ESLint ignore，使“E2E 后再 lint”也稳定。
- **门禁**：frontend Vitest `24 files / 135 tests`、设计契约 15/15、ESLint、TypeScript + Vite build 全绿（index 461.64KB、CSS gzip 11.09KB）；Playwright 设计系统 + 真实 API 数据画像→训练 golden path `2 passed`。
- **动态计划调整**：P2-2 保持进行中。下一片先统一 Evolution 图谱的 `aria-busy`/刷新/重试语义，再迁 ActiveFilePreview 和 model/auth 等读取链；阶段/产物完成反馈仍排在基础异步状态之后。

## 2026-07-22 P2-2 动效与加载态（切片 4：Evolution 图谱查询状态）

- **真实链路审计**：知识图谱虽然已有加载/错误/空态文案，但仍由 `EvolutionWorkspace` 内部 `useEffect` + 四组本地 state 命令式管理；每次失败会清空最后一次成功图谱，课程数组变化靠隐式 effect 依赖触发重载，规则审核与训练动作没有稳定图谱查询键可失效。无项目时查询被禁用，图谱区域则完全空白。
- **TDD 红→绿**：新增 `EvolutionWorkspace.test.tsx` 与 `useEvolutionQueries.test.ts`，先观察 region/`aria-busy`、局部 alert/retry、刷新控制、统一 query key 全部按预期失败；实现后覆盖无项目空态、有项目无证据空态、首次骨架、首次失败重试、后台刷新失败保留旧图，以及 lessons/injection-log/graph 三类缓存同步失效，共 `6/6` 聚焦测试通过。
- **Query 与数据闭环**：新增 `knowledgeGraphQueryKey`、`useKnowledgeGraphQuery` 和 `invalidateEvolutionKnowledgeQueries`。图谱只在 tab 激活时请求，稳定缓存支持无闪烁刷新；经验提取/重试/采纳/拒绝/冲突与训练结果都会显式失效图谱，替代课程数组引用变化这一隐式耦合。选中节点改为保存 ID 并从最新查询数据派生，刷新后不会持有旧对象。
- **可访问状态与内容保真**：图谱成为 `aria-label="自进化知识图谱"` 的 region；无项目时指向左侧 Explorer，有项目但证据不足时保留三步引导，首次读取显示拓扑骨架。成功后显示节点/关系计数与真实刷新按钮；后台请求期间保留节点并报告“正在更新”，失败就地显示 `role=alert` 和重试，不再清空可用图谱。
- **视觉与响应式**：状态条保持扁平分隔，新增控件最小高度 44px 并有 `:focus-visible`；骨架只使用 Catppuccin token 和 opacity 状态动画，继承 reduced-motion。容器窄于 740px 时骨架与图谱详情按单列降级，窄屏错误提示自动重排。1440×900 真实三栏截图确认图谱工具栏、节点计数、刷新操作和详情降级无溢出。
- **门禁**：frontend Vitest `26 files / 141 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿；Playwright 设计系统/Evolution + 真实 API 数据画像→训练 golden path `2 passed`。
- **动态计划调整**：P2-2 保持进行中。图谱的基础异步闭环已完成，不扩充装饰交互；下一片按顺序迁移 `ActiveFilePreview`，随后处理 model/auth 查询面和克制的阶段/产物完成反馈。

## 2026-07-22 P2-2 动效与加载态（切片 5：ActiveFilePreview 查询与编辑状态）

- **真实链路审计**：活动文件预览仍由 `RightPanel` 内部清空式 `useEffect` 读取，首次加载没有稳定骨架，读取失败不能局部重试，读取与保存错误混在同一状态；刷新会丢失可见内容，保存只更新本地 state，React Query 内容缓存与文件树的大小/修改时间元数据都不会同步。编辑态还要求后台刷新不能覆盖用户未保存草稿，因此不能直接把 query data 绑定到 textarea。
- **TDD 红→绿**：在真实 `RightPanel` 组件测试中新增 5 项，覆盖命名区域 + `aria-busy` + 三行骨架、读取失败重试恢复、后台刷新失败时保留缓存内容与未保存草稿、保存后的精确内容缓存写入 + 文件树失效，以及 415 二进制文件的下载动作。先观察 5 项预期失败，实现后聚焦 `8/8`、全量 `26 files / 146 tests`。
- **Query 与草稿边界**：抽出 current-version `projectFileContentQueryKey`/root helper，ActiveFilePreview 复用 `useProjectFileContentQuery` 托管服务端状态；本地草稿按 project/path 身份保存，只在文件身份改变时重置。后台刷新继续展示缓存内容和本地草稿，失败就地报告，不再清空编辑器或覆盖用户输入。
- **保存与缓存闭环**：保存成功后把响应写入精确的 current-version 内容缓存，重置草稿并失效项目文件树根查询，使 Explorer 的大小和修改时间与内容一起更新。保存错误独立显示并支持重试，不再与读取错误互相覆盖。
- **可访问状态与二进制动作**：预览成为 `aria-label="活动文件预览"` 的 region，覆盖无项目、无活动文件、首次骨架、后台刷新、读取/保存错误与重试；刷新、保存、重试和下载控件均具备 44px 目标与 `:focus-visible`。415 内容不再提供无意义读取重试，而是展示真实“下载二进制文件”链接。新增样式继续只使用 Catppuccin token 与既有 opacity skeleton，无渐变或装饰动画。
- **门禁与浏览器复核**：frontend Vitest `26 files / 146 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿；Playwright 设计系统 + 真实 API golden path `2 passed`。golden path 在真实转换 CSV 上触发 ActiveFilePreview 刷新并确认表格持续可见；1440×900 截图确认路径、刷新控件和横向表格可用。截图中 workflow 阶段逐字换行仍是既有 P2-3 响应式问题，本片不扩张范围。
- **动态计划调整**：P2-2 保持进行中。下一片按计划处理 model/auth 查询面的真实 loading/error/retry 语义，完成基础异步闭环后再添加克制的阶段/产物完成反馈。

## 2026-07-22 P2-2 动效与加载态（切片 6：Model/Auth 服务查询状态）

- **真实链路审计**：`ModelStatusIndicator` 与 `AuthMenu` 仍在组件内以 `useEffect` + 本地 loading/error state 请求。模型手动刷新返回的 cleanup 无调用方，竞态响应可能倒序覆盖；认证首次失败没有重试动作，后台失败会把已知身份降级成离线并移除登出入口，登出失败同样丢失身份动作。两个 popover 还被 `.top-nav { overflow: hidden }` 裁在 48px 顶栏内，刷新按钮只有 24px 且缺 `:focus-visible`。
- **TDD 红→绿**：新增 ModelStatusIndicator 真实组件测试并扩展 AuthMenu/纯 view-model 契约，覆盖首次请求 `aria-busy`、初始失败局部重试、后台刷新保留 provider/身份、登出失败保留身份与重试，以及登出成功但验证失败时仍提交匿名缓存。首次聚焦运行稳定得到 `9 failed / 17 passed`，实现和文案分层后收敛为 `27/27`；全量为 `27 files / 156 tests`。
- **Query 与 mutation 闭环**：新增 `useLlmStatusQuery`、`useAuthSessionQuery` 和稳定查询键，删除两处命令式读取及手写竞态保护。React Query 托管取消、去重、缓存和 refetch；刷新失败时旧 provider 列表/账户身份继续可见，同时顶栏错误 tone、accessible name 和弹层 alert 报告失败。登出改用 mutation：失败就地重试且保持已知身份；成功先把会话缓存提交为匿名，再失效查询向服务端确认。
- **可访问紧凑状态**：两个 dialog 均暴露 `aria-busy`、首次检查/后台刷新 `role=status` 和失败 `role=alert`；模型与账户都获得真实刷新和错误重试动作。受影响的顶栏入口、刷新、登录/登出和重试控件均达到 44px 并补 `:focus-visible`，继续使用 lucide-react 和 Catppuccin token，无新动画或渐变。
- **裁切修复与视觉证据**：顶栏保留 mode tabs 自身横向滚动，但允许 service popover 溢出显示，修复此前绝对定位弹层被 header 裁切的问题。Playwright 真实打开并刷新两个服务弹层，确认 `aria-busy` 回落；1440×900 截图确认账户弹层完整覆盖在工作台上层、顶栏入口仍落在 48px 行内，信息密度与层级稳定。
- **门禁**：frontend Vitest `27 files / 156 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿（主包 467.17KB / gzip 132.70KB，CSS gzip 11.78KB）；真实 FastAPI + Vite Playwright 设计系统/model/auth/Evolution 与数据画像→训练 golden path `2 passed`。
- **动态计划调整**：P2-2 基础异步查询面已覆盖项目、会话、文件、产物、图谱、活动文件、模型与账户。下一片不再扩张 query 组件，按原计划补克制的阶段/产物完成反馈，然后基于原始 motion/loading 验收边界做一次关闭审计。

## 2026-07-22 P2-2 动效与加载态（切片 7：阶段/产物完成反馈与关闭审计）

- **事件契约与 TDD 红→绿**：新增纯函数 `deriveWorkflowCompletionFeedback`，只消费 `stage_completed`、`step_completed`、`artifact_created` 三类结构化完成事件；普通 `task_progress` 不制造成功，新完成事件按事件序替换旧反馈。新增 AgentWorkspace 真实组件测试，先稳定观察 `3 failed / 1 passed`，实现后聚焦 `4/4`、全量 `28 files / 160 tests`。
- **克制的产品反馈**：最近完成状态放在 Workflow 摘要内，不新增遮挡工作台的全局 toast。阶段和产物使用 lucide 状态图标、Catppuccin success token 与 `aria-live="polite"`；产物显示规范名称/路径并提供 44px `Open artifact` 真操作，直接复用项目文件选择链。
- **动效与响应式边界**：完成反馈只执行一次 token 化 200ms opacity/2px transform 入场，无渐变、无装饰循环；窄于 900px 时文字与操作重排为两列。正式 Playwright 通过 `emulateMedia` 证明 reduced-motion 下时长不超过 0.01ms、循环数为 1。
- **P2-2 关闭审计**：原始范围“统一 transition、骨架、乐观更新、阶段/产物微动画”均已处理。普通 transition 无 `all` 且只动画 opacity/transform；项目/会话/文件/产物/图谱/活动文件/model/auth 均有真实首次加载、刷新、错误、恢复与 `aria-busy`；文件保存等成功响应即时写缓存，刷新失败保留旧数据。对文件、训练等服务端规范写入不做会预先宣告成功的乐观更新，保留真实 pending/error，仅在服务端成功后提交缓存，这是本项目的数据完整性边界。
- **浏览器与视觉复核**：真实 API golden path 从数据集点击 `Generate Profile`，验证可访问完成状态、动态产物路径和打开动作，再继续预处理与训练；设计系统与 golden path `2 passed`。1440×900 截图确认反馈不遮挡工作台、产物操作和右侧画像可用，也再次确认 workflow 阶段逐字换行仍是 P2-3 的真实问题。
- **门禁与动态计划**：Vitest `28 files / 160 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build、Playwright `2 passed` 全绿，P2-2 关闭。下一项严格按计划进入 P2-3，先修 workflow 阶段布局，再验证 1440×900、900px 与移动窄屏降级；不把 P2-4 信息设计混入响应式切片。

## 2026-07-22 P2-3 响应式重构（切片 1：workflow 阶段条布局）

- **真实链路审计**：`.workflow-stage-strip` 用 `grid-template-columns: repeat(9, minmax(72px, 1fr))`，但 `workflowState.ts` 的 `STAGES` 实际有 10 个阶段（含 `iterate`），第 10 个 `Learn` 掉到隐式第二行；四栏布局下中心列在 1440×900 仅约 686px（agent-workspace + cockpit padding 后可用约 638px），9 列网格最小需 712px，于是每卡被压到 72px 并触发横向滚动；`.workflow-stage small` 的 `overflow-wrap: anywhere` 使 detail 在约 28px 文本区逐字换行。这正是历次截图反复记录的"workflow 阶段逐字换行"根因。
- **TDD 红→绿**：新增 `e2e/responsive.e2e.ts`，在 1440×900 与 1200×900（最窄中心列约 446px）断言阶段条 10 卡同一行（`offsetTop` 唯一）、每卡宽 ≥120px 可读、标签单行（高度 ≤24px）、溢出被阶段条自身横向滚动吸收而不撑破外层 cockpit。先观察红：1440×900 下阶段跨 2 行（`offsetTop` 集合大小=2，期望 1）；实现后该用例通过。
- **优雅降级实现**：`.workflow-stage-strip` 从固定 9 列改为 `grid-auto-flow: column` + `grid-auto-columns: minmax(132px, 1fr)` 的单行步进器——阶段数不再硬编码，任意数量都单行排布、窄列横向滚动、宽列按 1fr 填充。`.workflow-stage strong` 单列出 `white-space: nowrap` + 溢出省略号（内层 `> div` 补 `min-width: 0` 使省略号生效）。`.workflow-stage small` 从 `overflow-wrap: anywhere` 改为 2 行 `line-clamp` + 词边界换行（`overflow-wrap/word-break: normal`）；signal-grid 的 `small` 拆出并保留原 break-anywhere 语义（承载可任意断行的路径值）。改动全部在 `agent.css`，不引入 `@media`（响应式查询仍只归 `responsive.css`）。
- **门禁**：Vitest `28 files / 160 tests`（设计令牌契约 15/15 未破——132px 属 `grid-auto-columns` 而非 gap/padding/margin/radius/z-index，不触发裸值检查）、ESLint、TypeScript + Vite build 全绿（主包 469.59KB、CSS gzip 12.06KB）；Playwright 三条 E2E（design-system / golden-path / responsive）`3 passed`。
- **浏览器复核**：1440×900 与 1200×900 阶段条单行、卡片可读、标签不换行、页面无横向溢出（docScroll==innerWidth）；390×800 移动端阶段条仍单行可横向滚动、signal/component 网格正确降为单列，唯余 17px 页面溢出来自 top-bar（MLAgent 品牌 + 模型/账户入口在 390px 挤不下），与阶段条无关。
- **动态计划调整**：P2-3 保持进行中，仅完成 workflow 阶段布局子切片。下一子切片处理 top-bar 在窄/移动视口的横向溢出与文件路径逐字换行（P2-3 evidence 明列的两项），再收口显式移动降级；不把 P2-4 信息设计混入。

## 2026-07-22 P2-3 响应式重构（切片 2：顶栏移动溢出）

- **真实链路审计（探针定位）**：用临时 Playwright 探针在 640/480/390 逐一测顶栏子元素右边界，确认 390px 下 22px 页面横向溢出的唯一来源是 `.auth-menu`（右边界 412 > 390）；status-bar 右边界=390 正常。顶栏是 `brand`(flex 0 0 auto) + `mode-tabs`(flex 1 1 auto，自身横向滚动) + `ModelStatusIndicator` + `AuthMenu` 的 flex 行，`gap: space-5`(20px)；两个服务入口 `flex 0 0 auto` 不收缩（图标 + 状态点 + 文字标签 + chevron），加上 3×20px gap 使固定 chrome 在约 448px 以下超出视口；480/640 各有约 12px 余量，故溢出仅在窄于约 448px 时出现。
- **TDD 红→绿**：在 `responsive.e2e.ts` 新增顶栏用例，在 768/480/400/360 断言页面无横向溢出（`documentElement.scrollWidth <= innerWidth`）且最右的 `.auth-menu` 右边界落在视口内。先观察红：390/360 溢出（Expected `<=391`，Received `412`）；实现后 4 宽度全绿。
- **移动压缩实现**：在既有 `@media (max-width: 480px)` 内把 `.top-nav` gap 收敛为 `space-2`、隐藏 `.model-status-label`/`.auth-menu-label`、`.auth-menu` margin-left 归零。两个服务入口降为"图标 + 状态点 + chevron"的紧凑控件（`aria-label`/`title` 保留完整信息，可访问性不受影响），固定 chrome 从约 424px 降到约 231px，360/320 均留有可滚动的 mode-tabs 空间。改动只落在 `responsive.css`，不新增断点、不触碰组件。
- **门禁**：Vitest `28 files / 160 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿（主包 469.59KB、CSS gzip 12.09KB）；Playwright 四条 E2E（design-system / golden-path / 阶段条 / 顶栏）`4 passed`。
- **浏览器复核**：390/360 顶栏图标化后完整落在视口内、无横向溢出；服务入口压缩后 mode-tabs 重获空间显示活动标签（可滚动）。过程中一次 `_probe.tmp.mjs` 因 PowerShell 工作目录回退到项目根、`Remove-Item` 静默失败而残留，被 `eslint .` 扫出 `no-undef`；用绝对路径删除后 lint 恢复干净——后续自管命令统一显式 `Set-Location frontend`。
- **动态计划调整**：P2-3 仍进行中，已完成阶段布局 + 顶栏溢出两个子切片。剩余：文件路径逐字换行（<900px 时 file-sidebar 隐藏，需在 900–1180px 窄侧栏区间核查）与显式移动降级/守卫收口；不把 P2-4 信息设计混入。

## 2026-07-22 工作台中文化（切片 2：全局导航与服务状态）

- **承接在途改动**：基于 `6e268c4` 已完成的中心 Agent cockpit 中文化，继续统一顶栏主模式、活动栏地标、工作区状态、底部状态栏、模型服务与账户服务的可见文案和可访问名称；代码标识、provider 名称、环境变量、文件名与数据值保持原文。
- **状态语义保持**：模型/认证的 loading、offline、background-refresh、retry、sign-in/sign-out 文案同步中文化，不改变 React Query 缓存、失败时保留旧状态、登出 mutation 与本地重试行为。
- **测试契约闭环**：接手时 11 个组件测试因 UI 已翻译而断言仍为英文失败；同步 `AuthMenu`、`ModelStatusIndicator`、纯 view model、AppShell smoke 与两条 Playwright 可访问名称后，聚焦 `29/29`、完整 Vitest `28 files / 160 tests` 全绿。

## 2026-07-22 P2-3 响应式重构（切片 3：长路径与移动降级收口，P2-3 完成）

- **TDD 红→绿**：新增真实 API 响应式用例，创建长项目名与长 CSV 文件名，在 1180px/901px 检查文件侧栏。红态确认 `.project-meta code` 仍为 `white-space: normal`，路径在 260px 栏内多行断裂；改为 block + `min-width: 0` + 单行 ellipsis 后通过，完整值继续由既有 `title` 和 DOM 文本提供。
- **移动端关闭审计**：新增 900/768/480/360 四档浏览器断言；900px 以下按既有断点隐藏文件侧栏与右检查器，但保留 48px 活动栏、可编辑 Agent 主工作区、顶栏与状态栏，中心区域恰好占满剩余宽度，页面无横向溢出。因此选择真实的优雅降级，不增加阻断式“请使用宽屏”守卫。
- **视觉复核**：901×800 真实截图确认长项目路径和长文件行稳定单行省略，文件操作仍可达，中心工作流在最窄三栏布局下保持可用；设计继续沿用 Catppuccin token、纯 CSS 与 Linear 式紧凑列表，无新依赖。
- **完整门禁**：Vitest `28 files / 160 tests`、ESLint、TypeScript + Vite build 全绿；真实 FastAPI + Vite Playwright 共 `6 passed`（design-system、golden path、阶段条、顶栏、移动主工作区、长路径）。P2-3 完成，下一主线进入 P2-4 信息设计（友好名称、路径渐进披露与复制动作）。

## 2026-07-22 P2-4 信息设计（友好名称、渐进披露与可操作空状态，P2-4 完成）

- **真实问题审计**：中心 cockpit 将 UUID、数据集路径和 `results/...` 产物路径直接塞进 `<code>`，候选实验/数据集按钮也展示原始 ID 或全路径；右侧训练检查器的实验和预测样本筛选无结果时只有英文 `No ... match`，无法就地恢复。其他项目/文件/图谱/日志空态多数已有真实引导，因此本项聚焦原 evidence 的 canonical 值泛滥与最后几个裸筛选空态。
- **纯逻辑 + 可复用展示层**：新增 `informationDisplay.ts`，统一识别 Windows/POSIX 路径、ID 与普通值，派生友好文件名、折叠的父级上下文和紧凑 ID；新增 `InformationValue.tsx`，默认只显示友好摘要，通过原生 `details/summary` 展开规范值，并以 Clipboard API + 安全回退复制完整内容。复制成功/失败通过 `aria-live` 明确反馈，summary 与复制按钮均为 44px，使用 lucide-react、Catppuccin token 和既有 reduced-motion 契约。
- **中心工作流接线**：所有 cockpit card facts、工作流完成反馈、当前组件与最新产物都改用统一披露控件；动态产物仍可用规范路径打开。候选运行按钮改为“文件名 · 模型”，候选数据集按钮使用文件名，原始 experiment/dataset version id 与完整路径拆成可披露事实，动作 payload 继续保留规范值，因此可读性提升而审计/继续执行语义不丢失。
- **空状态恢复闭环**：右侧训练历史在筛选无匹配时说明原因并提供“重置实验筛选”；预测样本无匹配时提供“重置样本筛选”，两者都恢复为全部数据。空预测样本、空 CSV、未选项目/文件、无训练记录统一补具体下一步，不增加插画卡片或装饰性 UI。组件测试覆盖两个重置闭环，真实 golden path 也验证 GPU-only 无匹配 → 重置 → focused baseline 行恢复。
- **TDD 与浏览器证据**：路径/ID 纯函数、组件披露/复制、候选文案和空态恢复聚焦 `41/41`；完整 Vitest `29 files / 167 tests`、ESLint、TypeScript + Vite build 全绿（主包 473.00KB，CSS gzip 12.44KB）。真实 FastAPI + Vite Playwright 全部 `6 passed`，随后扩展后的 golden path 再次 `1 passed`；浏览器还验证复制到剪贴板的值严格等于动态规范路径。1440×900 截图确认友好文件名、父级上下文、展开/复制反馈和四栏布局均可读。
- **动态计划**：P2-4 原始三项验收（友好名称与复制、空态指导、长路径渐进披露）均有直接证据，正式关闭。下一主线按 backlog 顺序进入 P2-5 Command Palette（⌘/Ctrl+K）+ slash commands，先审计现有 quick actions、composer 键盘契约与 command payload，再实现一个可测试的中心工作台垂直切片。

## 2026-07-22 P2-5 命令面板与 Slash Commands（P2-5 完成）

- **真实链路审计**：composer placeholder 已提示输入 `/` 查看命令，但生产代码没有 slash 解析、建议列表或命令面板；分析/机器学习各有三套硬编码 quick label + prompt，和后端自然语言 intent 依赖松散，无法搜索、键盘触达或统一演进。P2-5 因此以“一个命令来源、两种发现入口、同一 WebSocket 执行链”为验收边界。
- **统一命令模型**：新增 `agentCommands.ts`，定义 profile/clean/transform/train/gpu/evaluate/diagnose/iterate/export/learn/continue 共 11 个 typed command；每项包含稳定 slash、中文名称、说明、类别、关键词和上下文 prompt builder。数据集优先解析 training handoff 路径再回退 active file；评估/诊断/迭代/导出优先带 focused experiment；训练携带 target/preprocessing plan。原 quick actions 改为 registry ID 引用，删除重复 prompt，保证按钮、palette、slash 共享语义。
- **命令面板交互**：composer 新增可见 44px `Ctrl K` 入口，全局 Ctrl/Cmd+K 打开 `aria-modal` dialog；支持即时中文/英文/关键词过滤、Arrow 上下循环、Enter 插入、Escape/遮罩关闭、Tab 焦点约束与关闭后焦点恢复。列表使用 lucide 语义图标、左侧选中条和文字状态，搜索无结果时给出可操作查询建议；所有控件 ≥44px 且有 `:focus-visible`。
- **Slash 执行链**：输入 `/` 在 composer 上方打开同一 registry 的紧凑建议列表，Arrow/Enter 选择；完整 `/command` 直接展开为带当前项目/文件/实验上下文的自然语言 prompt，并复用既有 `submit → sendMessage → WebSocket`，不另造后端旁路。`/diagnose 用户补充` 会保留参数；未知命令不发送、不清空输入，就地提示按 Ctrl+K 查看可用命令。
- **视觉与产品约束**：面板沿用 Linear 式紧凑行与 Cursor 式细边框/无阴影结构，纯 CSS、Catppuccin token、Inter + JetBrains Mono、lucide-react；没有第三方 UI、渐变、嵌套卡片或装饰动画。1440×900 截图确认单结果过滤、slash 标签、键盘提示和暗色遮罩层级清晰，底层工作台上下文仍可辨认。
- **TDD 与门禁**：纯 registry + AgentWorkspace 聚焦 `13/13`，覆盖查询、上下文 prompt、参数、quick parity、Ctrl/Cmd+K、无结果、palette→composer→send、inline 建议、未知命令与 Escape 焦点恢复。完整 Vitest `30 files / 175 tests`、设计契约 15/15、ESLint、TypeScript + Vite build 全绿；初始 JS 484.93KB / gzip 138.83KB，仍低于 500KB 警戒线。真实 FastAPI + Vite Playwright `6 passed`，golden path 证明 Ctrl+K → 过滤“错误诊断” → 插入 `/diagnose` → 通过真实 WebSocket 发送。
- **动态计划**：P2-5 原 evidence 与 fix 已全部由生产代码、组件测试和浏览器路径覆盖，正式关闭。下一主线按 backlog 进入 P2-6 知识图谱可视化升级，先评估现有手写 SVG 的布局/缩放/聚类缺口与 bundle 成本，再决定成熟图库并保留既有 provenance 深链行为。

## 2026-07-22 P2-6 知识图谱可视化升级（P2-6 完成）

- **技术选型与边界**：对现有手写 SVG 做链路审计后，确认固定三列坐标只能排列 column/experiment/rule，缺少真实缩放、平移、拖拽、聚类与复杂拓扑布局。采用官方持续维护、MIT、内置布局/compound node/zoom/pan/event 能力的 Cytoscape.js 3.34.0，并 exact pin；保留既有 React Query 加载/刷新/失败保留旧图、节点详情、provenance 文件/实验深链、规则详情和高级洞察定位行为。
- **语义聚类与数据防护**：新增纯映射层，把数据特征、模型实验、自进化规则变成 compound cluster，真实节点归入对应 parent；过滤任一端点不存在的悬空边，不让异常后端关系渲染成不可解释连线；无真实节点的空 cluster 不进入布局，避免孤立分组拉低 fit 缩放。Cytoscape 使用无动画 COSE 布局，支持节点拖拽、空白平移、滚轮缩放与邻域 hover 强调。
- **操作与可访问性**：画布上方提供 44px 缩小、放大、适应视口按钮和实时百分比；原生分组 select “定位图谱节点”让键盘用户访问全部 canvas 节点，选择同步右侧详情。Canvas 暴露节点/关系摘要，帮助文字解释鼠标与键盘路径；insight 点击使用短时静态强调并自动 fit，不引入装饰循环或 reduced-motion 冲突。全部颜色由实时解析的 Catppuccin token 驱动，主题/品牌属性变化会更新 renderer style。
- **懒加载与性能**：`EvolutionWorkspace` 通过 `React.lazy` + `Suspense` 按需加载图谱；初始 JS 从 P2-5 的 484.93KB / gzip 138.83KB 降为 480.53KB / gzip 137.47KB，Cytoscape 独立为 453.14KB / gzip 145.78KB chunk，未把图库成本加入默认工作台。CSS 93.62KB / gzip 13.12KB。
- **真实缺陷与防回归**：首次浏览器截图发现 toolbar/DOM/canvas 都存在但画布透明。像素与 Cytoscape registry 探针确认 React StrictMode 二次挂载后的新 core 有 0 elements；初始化 effect 现在从最新 graph ref 自行恢复拓扑、选择和 highlight。组件测试以 StrictMode 覆盖二次挂载，golden path 进一步读取真实 canvas alpha，直接拒绝“canvas 存在但没画节点”的假阳性。
- **门禁与视觉证据**：映射/Canvas/Evolution 聚焦 `14/14`；完整 Vitest `32 files / 184 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿。真实 FastAPI + Vite Playwright `6 passed`，新增路径覆盖训练 → 图谱非透明像素 → 定位实验 → 放大/fit → 回到 focused baseline。1440×900 截图 `E:\ml_agent\.codex-runs\p2-6-knowledge-graph.png` 确认两个非空语义分组、节点/关系与紧凑工具栏可读。
- **动态计划**：P2-6 的成熟图库、布局、缩放和平移、聚类、键盘访问、深链保留、bundle 隔离与浏览器证据均已闭环，正式关闭。下一主线按 backlog 进入 P2-7 Accessibility audit，先建立 axe 自动化与当前基线，再修复 focus 管理、WCAG AA 对比度和剩余可访问名称/语义问题。

## 2026-07-24 P2-7 可访问性审计（focus 管理统一 + WCAG A/AA 闸门，P2-7 完成）

- **承接已入库闸门**：`9224739` 已建立自动化 a11y 闸门——`accessibility.e2e.ts` 用 `@axe-core/playwright` 对分析工作区、命令面板、模型/账户对话框、机器学习实验详情、Evolution 图谱 6 个关键状态做 WCAG 2 A/AA 扫描并要求 0 违规，同时补上全局 `:focus-visible` 基线并把 muted 文本对比度提升到审计阈值。但该 commit 尚未写入进度文档，本条一并收口。
- **真实链路审计**：三个 `role="dialog"` 中只有命令面板（P2-5）具备完整焦点管理；顶栏模型服务与账户两个 popover 虽有 Escape 和点击外部关闭，却在打开时不移入焦点、无 Tab 陷阱、关闭后不把焦点还给触发按钮，键盘/读屏用户会在对话框外迷失。命令面板自身的 trap 逻辑也是内联重复实现。
- **TDD 红→绿**：先新增 `useDialogFocus.test.tsx`（7 项：容器聚焦、指定初始焦点、失活恢复、Tab/Shift+Tab 循环、容器起点 Shift+Tab、非 Tab 键放行）与模型/账户 popover 各 2 项组件焦点测试；稳定观察红（焦点未移入、hook 模块缺失），实现后聚焦相关文件 `30/30`。
- **抽取共享 hook**：新增 `lib/useDialogFocus.ts`，统一“记住触发元素→移入焦点（可指定初始元素或容器）→Tab 循环陷入→失活恢复”，刻意放行非 Tab 键以便各 dialog 保留自有 Escape/关闭逻辑。命令面板、模型、账户三个对话框改用同一 hook，删除命令面板内联的 focus effect 与 trap 函数；两个 popover 的 dialog 容器补 `tabIndex=-1` + `ref` + `onKeyDown`。
- **真实浏览器验证**：`accessibility.e2e.ts` 新增键盘焦点用例——Ctrl+K 后焦点落在搜索框、Escape 关闭；模型/账户 popover 打开后焦点在对话框、Tab 不逃逸到工作台、Escape 关闭并把焦点还给触发按钮。
- **环境修复**：本机（DELL）此前从未建立 `backend/.venv`，导致 Playwright webServer 无法拉起后端、E2E 长期只能靠 CI。本次用系统 Python 3.11 新建 `backend/.venv` 并安装运行时+dev 依赖（纯 wheel，无编译），`app.main` 正常导入 15 路由，E2E 现可本地执行。
- **门禁**：Vitest `33 files / 195 tests`（设计契约 15/15）、ESLint、TypeScript + Vite build 全绿（主包 481.37KB / gzip 137.72KB）；真实 FastAPI + Vite Playwright `accessibility.e2e.ts` `2 passed`——axe 6 状态 0 违规 + 键盘焦点移入/陷入/恢复断言。
- **动态计划**：P2-7 四项验收（a11y 自动化闸门、`:focus-visible`、WCAG AA 对比度、focus 管理）全部闭环，正式关闭。下一主线按 backlog 进入 P2-8 Bundle performance，先审计当前 `dist` 分包与懒加载现状，建立可量化预算，再做工作区级路由拆分。

## 2026-07-27 P2-8 构建产物性能（路由级拆分 + 预算门禁，P2-8 完成）

- **原始 evidence 已过时**：backlog 记录的“单个 415KB chunk、无拆分”不再成立——P1-2 与 P2-6 已引入三处懒加载。实测基线为主包 481.37kB / gzip 137.72kB，另有按需的 MarkdownMessage 335.20kB、HistogramChart 369.21kB、KnowledgeGraphCanvas 453.14kB，CSS 93.87kB / gzip 13.19kB。因此先重建真实基线再动手，不沿用旧结论。
- **真实链路审计**：`AppShell.tsx:640` 按 `activeMode === "evolution"` 与 `AgentWorkspace` 互斥渲染 `EvolutionWorkspace`，但第 30 行是静态 import，整棵子树（34.4KB 源码 + graphEvidence/evolutionStats/图谱查询）无条件进首屏。`RightPanel`、`AgentWorkspace`、`FileExplorer`、`ActivityPanel` 首屏真实需要，`CommandPalette` 与常驻的 `SlashCommandSuggestions` 同文件且收益仅 5.4KB，均不属路由级候选。故本片唯一的路由级缺口是 `EvolutionWorkspace`。
- **TDD 红→绿**：新增 `tests/bundle-splitting.test.mjs`，以路由级工作区清单断言“不得静态 import + 必须 `lazy(() => import(...))` + 存在 `Suspense` 边界”。先稳定观察 2 项预期失败，实现后 2/2；设计令牌契约 15/15 未破。
- **路由级拆分实现**：按项目既有懒加载惯例（MarkdownMessage/HistogramChart 均为命名导出 + `export default`）给 `EvolutionWorkspace` 补 default 导出，`AppShell` 改用 `lazy` + `Suspense`，fallback 为 `aria-busy` 的 `<main className="agent-workspace">` 占位，避免 chunk 到达前主工作面塌陷。新增 `.workspace-loading` 只使用 Catppuccin token 与 opacity 状态动画，继承全局 reduced-motion，无渐变。主包降至 458.95kB / gzip 131.84kB（−22.42kB / −5.88kB gzip），新增 22.99kB / gzip 7.24kB 按需 chunk。
- **主动否决 vendor 分包**：用探针 `manualChunks` 量化主包构成——业务代码仅 200.86kB / gzip 54.23kB，其余为 react 194.25kB、react-query 41.31kB、lucide 24.99kB。但同一探针也证明按 `node_modules` 分组会把 cytoscape/recharts/react-markdown 提升成 1,149.25kB / gzip 351.84kB 的首屏 vendor chunk，**直接摧毁全部三处既有懒加载**（三个 chunk 缩水成 0.43–8.56kB 的空壳），而首屏字节并不下降。判定为负收益 + 真实风险，不采用；该结论写进预算脚本注释防止后人重蹈。
- **预算门禁与负向验证**：新增 `scripts/check-bundle-budget.mjs`，解析真实 `dist/index.html` 的引用集合（含 modulepreload）得到首屏资源，强制首屏 JS gzip ≤140kB、原始 ≤490kB、CSS gzip ≤16kB、首屏 JS chunk ≤3 个、单 chunk ≤500kB，并断言四个重依赖 chunk 既存在又不被首屏引用。单位与 Vite 输出统一为 1000 进制 kB，避免日后数字对不上。门禁接入 `npm run build`，因此无需改 CI workflow 即成为 PR 闸门。用被否决的探针产物做负向验证：门禁如实报出 gzip 486.00kB、原始 1616.15kB、单 chunk 1415.52kB 三项违规并退出码 1，确认不是假绿。
- **门禁与浏览器证据**：Vitest `34 files / 197 tests`（设计契约 15/15）、ESLint 0、TypeScript + Vite build + 预算门禁全绿。真实 FastAPI + Vite Playwright `8 passed`；其中 `design-system.e2e.ts` 切到自进化知识模式后 `.evolution-workspace` 可见、图谱 region 与 ML 品牌强调色覆盖正常，直接证明 `Suspense` 边界在真实浏览器中正确解析懒加载 chunk。新脚本首次 lint 因 `console`/`process`/`URL` 报 12 个 `no-undef`，按 `deep-link-smoke.mjs` 既有惯例补 `/* global */` 头后恢复干净。
- **动态计划**：P2-8 的路由级拆分、懒加载与可量化预算均已闭环，正式关闭；至此 P0/P1/P2 三条编号主线全部完成。复核 `task_plan.md` 后确认：2026-05-30 记录中留作缺口的“编排器 retry/失败恢复与 durable task 持久化”实际已由后续切片完成（北极星清单 112–125 行全部勾选），该缺口描述已过时。真正剩余的是产品北极星 follow-up 的 4 项（`task_plan.md` 126–129）：上下文 inspector 视图、更丰富的中心 cockpit 组件、全链路 provenance 回链、自然语言全流程 golden-path 覆盖。下一主线方向需与用户确认后再开工。

## 2026-07-27 中心 cockpit 组件增强（切片 1：卡片输入能力 + 目标列选择）

- **方向确认**：用户在 4 项北极星 follow-up 中选定“更丰富的中心 cockpit 组件”（`task_plan.md` 127）作为下一主线。该项含 7 类组件，本片按惯例只做一个可独立验证的垂直切片。
- **真实链路审计与死锁定位**：`CockpitComponentCard` 的形状是只读 `facts` + 触发式 `actions`，14 种卡片全部没有输入控件。这在训练配置卡片上形成真实产品死锁——目标列缺失时卡片 `status: "attention"`、启动按钮 `disabledReason: "训练前请选择或推断一个目标列。"`，但卡片自身不提供任何选择方式，用户必须离开中心工作台去右侧训练面板或改用自然语言。这正是 127 中 "target/feature selection" 的入口。
- **无需后端改动**：`data_quality_profile` 早已产出带评分与理由的目标列候选（`{column, score, dtype, unique_count, missing_ratio, reasons}`，按分降序），`uiStore` 也已有 `suggestedTargetColumn` 与 setter。本片只补前端的表达能力和接线。
- **TDD 红→绿**：注册表层先加 3 项（提供候选控件、已解析目标列即使未被画像排名也保留可选、无画像时不造假控件并保持原禁用理由），稳定观察 2 项预期失败；组件层再加 2 项（渲染候选并回传选择、无画像不渲染选择器），观察 1 项失败。实现后聚焦全绿。
- **发现并修复第二个真实缺口**：首版实现只读 `component_requested` 的 props，而最常用的「生成画像」按钮走的是本地 `artifact_created`，候选放在 artifact metadata 里且是**带评分的对象数组**（后端 `profile_props` 只在自然语言路径上把候选降级成列名数组）。即最常见的按钮路径拿不到选择器。补一条红测试固定该形状后，`classifyArtifact` 现在把 data_quality 的 metadata 一并作为信号 props，提取函数同时接受字符串与对象两种候选形状。
- **窄接口而非通用抽象**：新增 `CockpitComponentControl` 只落地当前真实用到的 `select`，不预造 input/checkbox/multi-select。选择结果经 `onSelectTargetColumn` 回到既有的 `uiStore.suggestedTargetColumn`，与右侧训练面板共用同一状态，不新造并行状态。
- **可访问性与视觉**：首版用 `<label>` 包裹 select，导致可访问名称把 description 文本一并计入、`getByRole("combobox", { name: "目标列" })` 取不到——改为显式 `aria-label` + `aria-describedby`。控件 44px、Catppuccin token、无渐变与装饰动画。1440×900 截图复核发现卡片里“目标列”出现两次（facts 只读值 + 选择器），属信息重复，已改为有控件时 facts 不再输出该条，并补断言防回归。
- **门禁与浏览器证据**：Vitest `34 files / 203 tests`、ESLint 0、TypeScript + Vite build + 预算门禁（主包 460.49kB / gzip 132.30kB，仍在 140kB 预算内）全绿；真实 FastAPI + Vite Playwright `8 passed`，其中 golden path 新增真实用户路径——点击「生成画像」后用顶栏切到机器学习模式（刻意不用 `page.goto` 重载，以保留刚生成的会话事件流），断言卡片内出现目标列选择器、候选含 `churn`、选择后「启动 sklearn」按钮启用。`accessibility.e2e.ts` 的 axe WCAG A/AA 扫描对新控件仍为 0 违规。
- **动态计划**：127 保持进行中。下一切片按同一模式处理特征选择或预处理计划编辑——两者都会复用本片建立的卡片输入能力；预处理计划编辑需要把修改写回 plan 产物，涉及后端契约，届时先做接口审计再动手。

## 2026-07-27 中心 cockpit 组件增强（切片 2：特征选择 = 预处理计划编辑）

- **审计推翻了原切片划分**：原计划把“特征选择”与“预处理计划编辑”当作两项。审计 `train_sklearn.py` 后确认二者在本架构下是同一件事——训练请求没有也不应有特征参数，`TrainSklearnRequest` 只有 `use_gpu`/`preprocessing_plan_path`，特征唯一的载体是 plan 的 `numeric_features`/`categorical_features`/`drop_columns`。特征必须写进 plan 才可复现，因此本片一次覆盖两项的核心。
- **拒绝直接改写 plan JSON**：plan 的 `feature_columns`、`drop_columns`、`drop_reasons`、`steps.*.selector` 和 `pipeline_script` 全部由同一次决策派生，手改 JSON 必然造成计划与生成脚本不一致。改为让特征选择成为 plan 生成的输入：`preprocessing_plan()` 新增可选 `selected_features`，未选中的非目标列以 `deselected` 理由进入 drop，所有派生字段自动跟随；不给该参数时自动质量丢弃行为完全不变。因为 `/preprocess-plan` 本就覆写同名产物，**无需新增端点**。
- **拦截一个会静默违背用户意图的边界**：`train_sklearn` 在计划无特征时会回退到“使用全部列”，因此空选择会把“我只要这几个特征”变成“用全部特征”。API 直接以 400 拒绝空选择，前端也在提交前就地拦下，避免用户白跑一次重生成。
- **TDD 红→绿**：后端工具层 3 项（显式选择生效且派生字段一致、忽略未知列与目标列、无选择时保留自动丢弃）先红后绿；API 层 2 项（选择落到产物与脚本、空选择被拒）同样先红后绿。前端注册表层 3 项、组件层 3 项，各自观察预期红灯后转绿。
- **修复两个被测试暴露的真实缺陷**：① `CockpitCard` 原本定义在 `AgentWorkspace` 函数体内，每次渲染都是新的组件类型，React 因此卸载重建整张卡片——勾选一个特征就会销毁所在节点并丢失焦点，无法连续选择。已提到模块作用域并显式传入回调。② `<label>` 包裹 `<input type="checkbox">` 时，点击会被 label 再次转发给 input，一次点击 toggle 两次、净效果为零，编辑被静默抵消。改为 `htmlFor`/`id` 关联，input 置于 label 外。两者都是真实用户会遇到的问题，而非仅测试现象。
- **交互与可访问性**：多选用 `fieldset` + `legend` 形成命名分组，未提交前保留本地草稿（`null` 表示未编辑即采用计划当前值），提交成功后清空草稿。复选框行 44px、`accent-color` 用 Catppuccin 强调色、无渐变与装饰动画。
- **门禁与浏览器证据**：后端 ruff + `227 passed, 3 skipped`；前端 Vitest `34 files / 209 tests`、ESLint 0、TypeScript + Vite build + 预算门禁（主包 462.37kB / gzip 132.98kB，仍在 140kB 预算内）；真实 FastAPI + Vite Playwright `8 passed`。golden path 新增完整往返：点「生成计划」→ 卡片内取消勾选 `support_tickets` → 点「应用特征选择」→ 复选框保持未勾选 → 再从卡片读出真实计划路径并校验产物中 `feature_columns` 不含该列、`drop_reasons.support_tickets === "deselected"`。首版 E2E 校验读错了路径（前端用会话 id 重新生成，与 setup 时 API 直接生成的目录不同），改为从卡片取真实路径后通过。`accessibility.e2e.ts` 的 axe WCAG A/AA 对新的 fieldset/checkbox 结构仍为 0 违规。1440×900 截图复核 `.codex-runs/cockpit-feature-selection.png`。
- **动态计划**：127 的 target/feature selection 与 preprocessing-plan editing 两项已闭环。剩余：变换 diff 复核、模型对比、错误切片下钻、预测样本、最终报告预览——其中模型对比、错误切片、预测样本在右侧检查器已有成熟实现，下一切片宜先审计“把既有检查器视图搬进 cockpit 卡片”与“127 真正缺什么”，避免重复造已有能力。

## 2026-07-27 中心 cockpit 组件增强（切片 3：职责边界审计 + 变换 diff 复核，127 收口）

- **先审计后动手，避免重复造已有能力**：逐项核对 127 列出的五项剩余组件。结论是模型对比、错误切片下钻、预测样本、最终报告预览在右侧检查器**均已完整实现**（`RightPanel.tsx` 的候选模型对比表、每类质量表、错误切片表、带筛选与重置的预测样本表、解释/系数表），且 cockpit 侧的 `model_comparison`/`error_analysis`/`prediction_samples`/`evaluation_report` 卡片都已带真实摘要事实与跳转入口，并非空壳。**"cockpit 给决策摘要与入口、检查器给完整表格与下钻"本就是已经成立的职责边界**，把检查器视图整体搬进卡片属于重复劳动，明确不做。
- **真正缺失的只有变换 diff 复核**：`transformation_report` 此前只在 `classifyArtifact` 与 `workflowState` 里有分类和阶段映射，既没有 cockpit 卡片，检查器也没有对应视图——`preprocessing_transform_report.json` 不匹配 `JsonTable` 的任何结构分支，只能以原始 JSON 呈现。后端 `execute_preprocessing_plan` 其实已经记录了 diff 所需的全部数据（`input_shape`/`output_shape`/`drop_columns`/`encoded_feature_columns` 与每列的填充/缩放/编码参数），因此本片是**纯前端**切片，无需后端改动。
- **TDD 红→绿**：新增纯逻辑 `transformDiff.ts` 与 8 项测试（识别报告结构、形状摘要、丢弃列、数值填充与缩放描述、类别列展开为编码输出、按最长匹配归属编码列、行数变化标记）；`RightPanel` 新增 2 项真实组件测试（渲染逐列对照表、行数变化提示）；注册表新增 1 项（卡片存在且三个入口分别指向正确产物）。均先观察预期红灯再实现。
- **一个真实的归属陷阱**：one-hot 输出列形如 `{列名}_{取值}`，而列名之间可能互为前缀（`contract` 与 `contract_type`）。若按简单前缀匹配，`contract_type_premium` 会被误算到 `contract` 名下。实现按最长匹配归属并以专门用例固定该行为。
- **两个产物入口必须分开**：执行计划会写出同名的 `.json` 明细与 `.md` 报告，而本地事件里 `.md` 后到、会覆盖 `transformation_report` 信号。结构化列对照只存在于 `.json`，因此卡片按扩展名归一化后分别给出"打开列对照"（json）、"打开变换报告"（md）、"打开输出数据集"三个入口，并以测试固定三个 payload 路径，避免主入口把用户带到纯文本。
- **审计中发现两个既有问题（均不在本片范围，未扩大改动）**：① cockpit 的"批准并执行"在**前端按钮生成计划**的路径上不会真正执行变换——该 approval id 由前端本地生成，`handleRespondToApproval` 只经 WebSocket 发给后端 orchestrator，而后端并不认识它，按钮却回报"已完成"。真正执行入口是选中计划产物后的 `Execute Plan`。② cockpit 的 `open_artifact` 只设置 activeFile，不改变右侧选中产物，因此结构化预览仍停留在先前选中的产物上。两者都影响多个既有卡片，宜作为独立切片处理。
- **门禁与浏览器证据**：前端 Vitest `35 files / 220 tests`、ESLint 0、TypeScript + Vite build + 预算门禁（主包 466.94kB / gzip 134.28kB，仍在 140kB 预算内）；真实 FastAPI + Vite Playwright `8 passed`。golden path 在特征选择之后继续执行刚编辑过的计划，断言变换卡片出现且入口可用，再从产物列表选中变换明细，验证列对照表中 `support_tickets` 呈现为"已丢弃"、`age` 显示 median 填充与 standard 缩放。1440×900 截图 `.codex-runs/cockpit-transform-diff.png` 确认 Rows 12→12、Columns 4→3、Dropped 1 与逐列对照可读。
- **动态计划**：127 的七类组件至此全部有真实落地或已确认由检查器承担，该项可以关闭。下一步建议处理本片审计出的两个既有一致性问题（本地审批按钮无效、`open_artifact` 不联动右侧选中产物），它们比继续堆新组件更直接地影响可用性。

## 2026-07-27 cockpit 与检查器的两处一致性修复

- **问题一：打开产物不联动右侧预览**。`activeFile` 与 `RightPanel` 内部的 `selectedArtifact` 是两个各自独立的“右侧正在看什么”，而预览是二选一（有选中产物就完全不渲染活动文件预览）。cockpit 的 `open_artifact` 只调 `onSelectFile`，于是用户点“打开列对照/打开报告/打开指标”后，预览仍停在此前选中的产物上；反过来点产物列表也不更新活动文件。修复：产物列表选中时同步 `onSelectFile`，并让 `selectedArtifact` 跟随 `activeFile`——命中已知产物则选中它，否则清空选中交给功能更完整的活动文件预览（它同样渲染结构化 JSON，还额外提供刷新、编辑、保存与二进制下载）。
- **首版修复引入过真实回归并被测试拦下**：最初为任意 `activeFile` 构造虚拟产物，导致 `selectedArtifact` 恒非空、`ActiveFilePreview` 永不渲染，5 个既有用例（骨架、读取重试、未保存草稿、保存写缓存、二进制下载）同时变红，等于废掉活动文件的编辑能力。改为“只在命中已知产物时选中”后 14/14 恢复。
- **问题二：本地审批的「批准并执行」不会真正执行**。前端按钮生成计划时会 push 一条本地 `approval_required`，其 approval id 与后端格式完全相同（`{session_id}-preprocessing-plan`），无法靠 id 区分；但这条计划走的是 REST 调用，后端从未写入待审批记录。用户点“批准并执行”后，前端立即回报“已完成”，后端却异步返回 `approval_not_found` 错误——假成功叠加实际失败。
- **按来源分派而非猜测**：给 `approval_required` 事件增加可选 `origin: "local"`，由本地流程显式标注，经 `workflowState.approval` 透传到 action payload。批准时只有编排器发起的审批才走 WebSocket 审批响应，本地审批直接调用既有的执行路径。两条路径各有组件测试固定，避免以后再次混淆。
- **门禁与浏览器证据**：前端 Vitest `35 files / 224 tests`、ESLint 0、TypeScript + Vite build + 预算门禁（主包 467.20kB / gzip 134.41kB）；真实 FastAPI + Vite Playwright `8 passed`。golden path 现在直接点卡片上的「批准并执行」完成变换，再点「打开列对照」验证右侧渲染出逐列对照表——这两步在修复前分别是空操作和不联动，如今都是真实可走的路径。
- **动态计划**：两处一致性问题已闭环。`task_plan.md` 的北极星 follow-up 还剩两项：上下文 inspector 视图（126）与全链路 provenance 回链（128）；另有自然语言全流程 golden-path 覆盖（129）。其中 126 与本次修复的“activeFile 驱动右侧预览”方向一致，可作为下一主线的自然延续。

## 2026-07-27 自然语言全流程 golden-path（129 完成）

- **选择理由与边界**：后端 intent 路由已有 27 个 WebSocket 单测，覆盖全部 10 个 intent 与重试/放弃/歧义；前端有命令面板发送测试。缺的是把两者串成一条真实浏览器全链路——此前的 golden path 只验证到“已发送”，从未验证 Agent 的实际响应。新增 `e2e/natural-language.e2e.ts`，全部指令经对话框以自然语言输入。
- **覆盖的真实链路**：原始数据 → 画像与可审计的预处理计划并**停在审批检查点** → 批准后产出训练就绪数据集 → 训练意图只召唤配置卡片（真实训练仍需用户确认）→ 启动 sklearn 真实训练 → 评估（真实指标、候选模型、报告）→ 诊断（类别误差与行级样本）→ 重试（无保存状态时如实说明）→ 导出交接包 → 经验沉淀。截图 `.codex-runs/natural-language-flow.png` 显示 `agent_orchestrator x7 · 完成`。
- **揪出缺陷一：本地 kernel 不在项目工作区内执行**。生成的训练代码使用项目相对路径，Docker kernel 靠挂载与 workdir 满足；而 `LocalPythonKernelService` 的 `subprocess.run` **既不设 cwd 也不接受 workspace_root**，工厂函数对 local 后端直接丢弃该参数。因此在没有 Docker 的机器上，任何 sklearn 训练都以 `FileNotFoundError` 失败——而工具层在交给 kernel 前刚用绝对路径校验过同一文件存在，失败只在运行时暴露。既有 kernel 测试从未执行过一次工作区相对读取，所以长期未被发现。已修复并补两项后端测试。
- **揪出缺陷二：cockpit 卡片上限截断了 Agent 正在引导的卡片**。卡片按工作流顺序产生，而渲染取**前** 4 张，等于永远优先保留最早期的阶段。流程推进后，Agent 明确说“review the training card”“review the model comparison and report cards”，对应卡片却已被挤出可见范围——用户被指向看不到的东西。先尝试“当前阶段优先”排序，实测无效（真实渲染为 `[data_quality, preprocessing_plan, transformation_report, planned_dataset, training_config, model_comparison]`，评估报告卡在第 7 位）；改为保留**最新**的若干张，抽出纯函数 `selectVisibleCockpitCards` 并把上限提到 8。
- **揪出缺陷三：会话就绪前发送会丢失响应**。套接字在真实会话建立前连的是占位的 `dev-session`，切换会话时 `setEvents([])` 清空事件流。首次运行时后端确实执行并在 `results/dev-session/` 下产出了画像、计划、脚本与待审批记录，但 UI 事件流已被清空，界面停在空状态、产物计数为 0。E2E 因此显式等待真实会话就绪后再发送；该竞态窗口对真实用户同样存在，已记录待后续处理。
- **门禁**：后端 ruff + `229 passed, 3 skipped`；前端 Vitest `35 files / 226 tests`、ESLint 0、TypeScript + Vite build + 预算门禁（主包 467.26kB / gzip 134.42kB）；Playwright `9 passed`（新增自然语言全流程，既有 8 条无回归）。
- **动态计划**：129 完成。北极星 follow-up 仅剩 126（上下文 inspector 视图）与 128（全链路 provenance 回链）。另记录一项本次发现但未处理的问题：会话建立前的发送竞态，宜与 126 一并考虑，因为两者都涉及“右侧/会话状态由谁驱动”。

## 2026-07-27 修复会话就绪前的消息丢失

- **缺陷本身**：`useAgentStream` 在真实会话建立前连接到占位的 `dev-session`（`AppShell` 的 fallback，MVP 遗留，全项目仅此一处使用）。该窗口内发送的消息**真的被投递并执行了**——后端在 `results/dev-session/` 下写出了画像、预处理计划、管道脚本与待审批记录——但会话切换时 effect 重跑并 `setEvents([])` 清空事件流，所有响应因此被丢弃。界面停在空状态、产物计数为 0，且没有任何错误提示。这是 129 的浏览器验证中发现的第三个缺陷。
- **修法是消除占位而非增加补偿**：`sessionId` 改为 `string | null`，为 null 时刻意不建立连接。这样"会话未就绪"如实表现为"未连接"，而 composer 早已正确处理该状态——拒绝发送、保留输入、给出明确提示，发送按钮与快捷命令也已禁用。不需要新增 UI 或状态。
- **额外收益**：不再为每个项目产生游离的 `dev-session` 会话目录。E2E 运行后核对工作区，`sessions/` 下只剩真实会话，`dev-session` 已消失。
- **TDD 与门禁**：扩展 `websocketStub` 记录实例与出站消息后，新增 4 项 `useAgentStream` 测试（无会话不连接、无会话拒绝发送并报错、会话就绪后连到正确 URL、发送落在真正连接的会话上），先稳定观察 3 项预期失败再实现。前端 Vitest `36 files / 230 tests`、ESLint 0、build + 预算门禁（主包 467.29kB / gzip 134.43kB）、Playwright `9 passed`。修复后"已连接"即等价于"会话就绪"，自然语言 E2E 的双重等待相应简化为一个条件。
- **动态计划**：北极星 follow-up 现仅剩 126（上下文 inspector 视图）与 128（全链路 provenance 回链）。

## 2026-07-27 P126 上下文 inspector 视图（检查器跟随工作流）

- **承接已完成的一半**：126 要求"面板由 workflow state 与选中产物驱动"。选中产物这一半已在同日的一致性修复中完成（`activeFile` 驱动右侧预览）。本片补上 workflow 驱动。
- **真实缺口**：右侧 tab 只由主模式映射（`machine-learning→训练`、`evolution→日志`、其余→图表），工作流推进完全不影响它。在数据分析模式下跑完训练，检查器仍停在图表页，用户得自己去找训练详情——而中心 Agent 刚刚告诉他结果已就绪。
- **不能用 `currentStage` 驱动**：首版实现用了它，浏览器验证直接暴露问题——检查器纹丝不动。`currentStage` 的语义是"需要用户注意的阶段"（failed > blocked > active），训练完成后它仍可能停在更早的待办阶段。改为以**最新产物所属阶段**为准（`latestArtifact.stage`），尚无产物时才回退 `currentStage`，这才对应"刚产出了什么、该去哪看"。
- **映射与优先级**：数据形态阶段（ingest/profile/clean/transform）→ 数据页，模型形态阶段（train/evaluate/diagnose/iterate/export）→ 训练页，沉淀阶段 → 日志页（其证据就是事件流）。显式意图始终优先：`rightTab` 深链生效；用户点击 tab 即"接管"，直到切换主模式或再次深链才交还自动跟随。evolution 模式不参与跟随，其主区是自进化工作台。
- **顺带修可访问性缺口**：tab 的选中状态此前只通过 CSS class 表达，辅助技术无法得知当前在哪个检查器。补 `aria-pressed`，同时让组件测试可以稳定断言选中项。
- **门禁与浏览器证据**：纯逻辑 6 项 + 组件 3 项（进入训练阶段自动切换、用户接管后不被拽走、深链优先）；前端 Vitest `37 files / 239 tests`、ESLint 0、build + 预算门禁（主包 467.79kB / gzip 134.67kB）、Playwright `9 passed`。自然语言 E2E 刻意去掉 `rightTab` 深链，训练完成后断言"训练"页处于选中态——修复前该断言失败，是真实回归证据。
- **动态计划**：126 完成。北极星 follow-up 仅剩 128（全链路 provenance 回链）。

## 2026-07-27 P128 全链路 provenance 回链（消息 → 执行链路）

- **审计已有与真缺口**：128 要求"每条可见消息、动作、产物、模型运行、报告与学习规则都能回溯到 provenance 记录"。已具备的部分不少：图谱节点的来源/证据面板、产物路径深链与打开动作、`trace_id` 贯穿整条事件流、日志面板已支持按 trace/task 过滤与事件检查器、实验记录里的产物链接、`InformationValue` 的规范值展开与复制。逐层核对后确认真正断掉的是**消息层**——前端仅 4 个文件出现 `trace_id`，全在事件/日志侧；`AgentMessage.metadata` 里根本没有它。用户看到一句结论，无从查看它背后跑了哪些工具、写了什么产物、有没有报错。
- **后端单点补齐**：消息此前从 `messaging.py` 与 `stages.py` 的 **11 处** `append_message` 各自写入，逐处添加字段既易漏、将来新增调用更会忘。改为统一经 `_persist_message` 包装写入并附带 `trace_id`，把这条保证收在一个地方。新增后端测试断言同一次执行里事件流只有一个 trace，且 user 与 assistant 消息的 `metadata.trace_id` 都等于它。
- **前端回溯入口**：assistant 消息下方提供"查看该回复的执行链路"，点击后经新的 `openTrace` 动作切到日志检查器并按该 trace 过滤——沿用既有 `openLogs`/`focusedTaskId` 的模式，`LogPanel` 相应接受外部 trace 聚焦。没有 trace 的旧消息不显示入口，避免给出点了没用的按钮。
- **一次被并行运行揭穿的脆弱断言**：E2E 最初断言 `.trace-summary[aria-pressed='true']` 恰好 1 个，单独跑通过、全套并行跑失败（实际 0）。原因是该断言盯的是 trace 摘要列表是否包含被过滤的 trace，而非回链本身是否有效。改为断言过滤后日志列表仍有条目——这才直接证明"这条回复真的能追回它的执行链路"。连续两次全量 `9 passed` 确认稳定。
- **门禁**：后端 ruff + `230 passed, 3 skipped`；前端 Vitest `37 files / 241 tests`、ESLint 0、build + 预算门禁（主包 468.74kB / gzip 134.87kB）、Playwright `9 passed`。
- **动态计划**：128 完成。至此 `task_plan.md` 的产品北极星 follow-up 全部清空，P0/P1/P2 三条编号主线亦早已关闭；下一步方向需与用户确认。

## 2026-07-27 合并到 master（PR #2）+ 三个被 CI 连环挖出的缺陷

- **合并结果**：`feat/p0-backend-hardening` 经 PR #2 以 merge commit 合入 `master`（`a7ddaa8`），95 个提交、170 个文件、+29,373 / −9,991。保留提交历史而非 squash，因为 `progress.md` 的切片记录与提交一一对应，压缩会丢掉这条追溯线。PR 标题与描述在合并前重写——原描述停留在 7-21 的 P2-2 状态，与实际范围严重不符。
- **合并前发现该分支 CI 长期红着**：并非本次引入，历史每一次 run 的后端 job 都失败。三个缺陷环环相扣，每一层都被上一层挡住，修好前一个才暴露后一个：
- **① ruff 规则集随版本漂移**：dev 依赖只写 `ruff>=0.6.0` 无上界，CI 每次装最新版。ruff 0.16 扩大默认规则集（引入 I001、TRY004 等），CI 报 65 个错误而本地 0.15 全绿——**闸门结果取决于当天装到哪个版本，本地无法复现**。更严重的是后端 job 是 e2e 的前置依赖，因此 **Playwright 步骤从未真正执行过**（一直显示 skipping）。修法是在 `pyproject.toml` 显式声明 `[tool.ruff.lint] select`，让闸门不再随工具升级漂移，而不是锁版本回避；本地装 CI 同版本 0.16.0 复核通过。扩大规则集是值得做的事，但应当是一次显式决策，不是版本升级的副作用。
- **② E2E 超时配置自相矛盾**：自然语言全流程测试沿用 Playwright 默认 30s 上限，而其中一个断言等待上限被我设为 60s——**断言永远等不到结果，测试先超时**。本地该流程只跑 6 秒从未触碰，CI 首次执行立刻撞上。已按该链路真实成本（8 次编排往返 + 一次真实训练）设为 180s，其余 8 条保持 30s 严格约束不变。
- **③ scikit-learn 从未被声明为依赖**：sklearn 训练在 kernel 子进程里执行生成的代码，用的是后端解释器，因此 sklearn 必须是后端运行依赖，但 `dependencies` 里根本没有它。本地 venv 恰好装过（1.9.0）所以一直能训练，**任何全新环境——包括 CI——的核心训练功能都是坏的**。后端测试抓不到：sklearn 相关用例全部驱动 mock kernel，从不真正 import sklearn；被 skip 的 3 个是 Docker 相关，与此无关。只有真实端到端执行才能暴露。
- **最终验证**：PR #2 合并前三项闸门全绿——后端 ruff + pytest（1m2s）、前端 eslint + tsc + vitest + build（47s）、Playwright 9 条真实 FastAPI + Vite 端到端路径（2m13s，首次完整通过）。
- **动态计划**：`task_plan.md` 已无未完成项。已知可做的小改进：CI 中 e2e job 名为「Playwright golden path」，实际执行的是全部 9 条 E2E（`npm run test:e2e`），属早期只有一条时的遗留命名。

## 2026-07-28 自进化治理（已采纳规则的停用与重新启用）

- **缺口来自产品目标本身**：`docs/final-product-goal.md` 的完成定义要求用户能回答"How can learned behavior be reviewed, scoped, **disabled, or rolled back**?"。逐层核对后确认只有 review 侧完整（列表/提取/采纳/拒绝/标记冲突 + injection-log），**disabled / rolled back / scoped 三项均无实现**。
- **这是一个安全问题，不只是功能缺失**：`evolution_service._write_rule_index` 与 `rule_injection_service.match_rules` 都直接读取全部 `high_confidence` 经验。采纳因此是一扇**单向门**——一条经验一旦采纳就永久影响之后每一次 Agent 运行，即使事后发现它有害也没有关闭开关。自进化系统只能累积、无法收回。
- **设计决策：`enabled` 与 `status` 正交**。`status` 是审核结论（这条规则是否可信），`enabled` 是运行开关（当前是否注入）。曾考虑加第五种状态 `disabled`，但那会把"从未被认可"（rejected）与"曾被采纳后关闭"混为一谈，丢失采纳事实，重新启用时也无从知道该回到哪个状态。
- **单一真相源防止两条注入路径漂移**：新增 `list_active_rules()`（已采纳且未停用），持久化规则索引与实时规则匹配都改读它，避免停用的规则仍从其中一条路径泄漏进运行。
- **默认值即迁移策略**：`enabled` 默认 `True`，使升级前写入的记录保持生效——否则一次升级会静默停掉用户所有已采纳规则。前端类型同样设为可选，缺失一律按启用处理。专门补测试固定该行为（删除已存记录的 `enabled` 字段后仍应命中）。
- **停用可审计**：停用接受可选理由并写入经验证据，使"决定不再信任某条规则"这一决策本身留痕。
- **TDD 红→绿**：后端 4 项（停用后不再注入、重新启用恢复注入、理由写入证据、旧记录默认启用）先观察全红；前端 3 项（生效中提供停用入口、已停用显示不再注入并可重启、待审核不提供该入口）观察 2 项预期失败。
- **顺带修一个潜伏的测试脆弱性**：`design-tokens.test.mjs` 把文件原始字节与 LF 拼接串比较，而 git autocrlf 在 Windows 检出时会写入 CRLF——合并后切分支重新检出即触发失败。该契约检查的是导入顺序与令牌，与行尾风格无关，读取时改为统一行尾。**任何 Windows 全新克隆此前都会踩到这个失败**。
- **门禁与浏览器证据**：后端 ruff + `234 passed, 3 skipped`；前端 Vitest `37 files / 244 tests`、ESLint 0、build + 预算门禁（主包 469.09kB / gzip 134.98kB）；Playwright `10 passed`。新增 `rule-governance.e2e.ts` 断言真正重要的事——界面停用后 `rules/match` 对同一上下文由命中 1 条变为 0 条，重新启用后恢复为 1 条。1440×900 截图确认状态仍为「已采纳」、同时显示「已停用 · 不再注入后续运行」与重新启用入口，下方注入审计保留停用前的命中历史。
- **动态计划**：治理三项中的 disable/rollback 已闭环（对规则而言，停用即是实际意义上的回滚——历史运行的产物是不可变记录，不存在"撤销已发生的影响"）。**scoped（限定规则适用范围）仍未实现**，是该方向的下一片。

## 2026-07-28 自进化治理（规则适用范围，治理三项收口）

- **补上治理最后一项**：停用只能整条关掉，无法把规则收窄到它真正成立的地方——一条在某个数据集上学到的经验会作用于项目里的每一个数据集。
- **关键设计：scope 是打分前的硬门禁，不是又一个打分项**。`conditions` 与 `scope` 是两种不同的东西：前者由 agent 推导、软打分（"这看起来像经验来源的那类场景"），后者由用户设定、硬边界（"无论多像，只准在这里生效"）。若做成打分项，一条高置信规则仍可能靠 conditions 跨过 0.65 阈值而越界生效，护栏形同虚设。因此在 `match_rules` 里先做 `_within_scope` 过滤再打分，越界直接排除。
- **空即不限制**：`scope` 缺失或某维度为空表示该维度不设限，升级前的记录因此保持全局适用——与 `enabled` 默认 True 同一套迁移策略。两个列表皆空即恢复全局。
- **正向用例揪出编排器缺环**：先写的反向用例（限定到别的数据集 → 不注入）**通过了，但是因为错误的原因**——编排器只传 `mode` 和硬编码 tags，不传数据集，于是 `dataset_path` 为 `None`、任何限定范围的规则都被判越界。真正的缺陷是"限定到**当前**数据集的规则也会被误杀"。补正向用例后立刻变红，据此让 `_rules_event` 传入 `context.active_file`。**只写反向断言会让这个缺陷完全逃过测试**。
- **门禁与浏览器证据**：后端 ruff + `240 passed, 3 skipped`；前端 Vitest `37 files / 247 tests`、ESLint 0、build + 预算门禁（主包 469.50kB / gzip 135.02kB）；Playwright `10 passed`。`rule-governance.e2e.ts` 扩展为停用 → 重新启用 → 限定范围 → 解除的完整链路，断言同一规则在被限定的数据集上命中 1 条、在其他数据集上 0 条、解除后恢复。1440×900 截图确认「适用范围　全部数据集与模式」正确渲染。
- **动态计划**：`final-product-goal.md` 完成定义中的治理三项（reviewed / scoped / disabled / rolled back）至此全部落地。已知遗留：`_rules_event` 的 `tags: ["missing-value"]` 仍是硬编码，规则匹配的标签维度尚未接入真实上下文——独立于本片，可作为后续改进。

## 2026-07-28 规则注入在真实运行中从未生效（根因修复）

- **从"硬编码 tags"查到一个大得多的缺陷**：本打算只修 `_rules_event` 里写死的 `tags: ["missing-value"]`，审计时用探针按真实上下文给抽取器产出的两类经验打分——**missing-value 0.522、kernel-error 0.278，双双低于 0.65 阈值**。即：经验被提取、被用户采纳、被写进规则索引，却**从不注入任何一次真实运行**。整个自进化闭环只在手工构造富上下文的测试里成立，生产路径上从未闭合。
- **根因是打分把"未知"当成"不符"**：规则在运行开始时匹配，此时只知道模式、数据集与情境；而经验的 `conditions` 常常提到列级细节（`feature_type`、`missing_ratio`）——这些还没人确定。原实现对每一维无条件判等，上下文没提供该维即视为不匹配，于是每条经验都为"仅仅是未知"的事实被扣分。
- **改为只在可评估的维度上打分**：某一维只有在经验有条件、上下文也有值时才计入。**不符仍然扣分**（放宽"未知"不能连"已知且不符"也放过），无人能评估的维度不作为任何一方的证据；若一条经验没有任何可评估维度则不匹配——"没有主张"不构成"到处注入"的理由。补了正反两个方向的用例固定该语义。
- **tags 硬编码本身也是真实错误**：它无条件宣称每次运行都在处理缺失值。后果有两面——按运行领域标注的经验（如 `data-analysis`）永远对不上；缺失值经验被注入到与之无关的运行里。现按运行模式派生情境标签，取值与 `LessonExtractor` 写入 `domain` 的词汇保持一致，否则两侧对不上、标签维度形同虚设。
- **修复暴露了一个依赖旧假设的测试夹具**：scope 切片里的 `_scoped_rule_match` 用 `domain: ["missing-value"]`，正好依赖被修掉的硬编码。该用例意图验证的是范围限定而非标签匹配，已改用抽取器真实词汇。
- **门禁与证据**：后端 ruff + `244 passed, 3 skipped`（新增端到端用例：抽取器格式的经验被采纳后确实出现在 `rules_matched` 与注入提示中）；前端 Vitest `37 files / 247 tests`、build + 预算门禁；Playwright `10 passed`。
- **动态计划**：自进化闭环至此在生产路径上真正闭合。已知可继续改进：情境标签目前只由模式派生，尚未反映运行中出现的错误类型（`kernel-error` 类经验因此仍需真实错误标签才会命中）。

## 2026-07-28 项目盘点与 P3 计划

- **盘点手法来自上一片的教训**：PR #5 发现"规则注入在真实运行中从未生效"，暴露出一个模式——**测试通过不等于链路接通**。因此本轮特意用"找有消费方无生产方的代码"这一手法系统排查，而非凭印象列改进项。
- **P3-1 经验抽取只在 legacy 流程可达**（本轮最重要发现）：`LessonExtractor` 依赖 `missing.json`，而该产物**只由 `stages.py:77` 的 legacy「分析数据」流程产出**；现代自然语言流程产出的是 `data_quality_profile.json`。因此在产品主路径上跑完整流程后执行"沉淀经验"，抽取器找不到任何候选——这正是自然语言 E2E 截图里 Agent 回复"no rule candidate matched the current extraction heuristics yet"的原因。注入半环刚由 PR #5 修好，**抽取半环在主路径上仍是断的**。
- **P3-2 `kernel_output` 无任何生产方**：系统扫描前端声明的 20 种事件类型后确认，它是唯一真正无后端生产方的一种（`stage_started`/`stage_completed` 经变量 `_stage_event` 发射，属扫描误报）。后果是抽取器仅有的两类经验之一永远无法触发，日志面板的 stderr 分级渲染也是死代码。
- **P3-3/P3-4/P3-5**：情境标签尚未反映运行中的错误类型（依赖 P3-2）；四个领域 action hook 共 1,412 行命令式业务逻辑无直接测试——**本轮多个缺陷（审批空操作、`open_artifact` 不联动、会话就绪前消息丢失）全部出自该层**；四个超大文件（`RightPanel.tsx` 2,278 行等）建议在补齐该层测试之后再拆。
- **计划已写入 `task_plan.md` 的 P3 章节**，每条附可复核证据与验收标准。排序原则：已验证的真实缺陷（P3-1/P3-2）优先于工程健康（P3-4/P3-5）。

## 2026-07-28 P3-1 经验抽取接通产品主路径

- **缺陷复述**：抽取器只认 legacy「分析数据」流程产出的 `missing.json`；现代自然语言流程写的是 `data_quality_profile.json`。因此在产品主路径上跑完整个工作流再执行"沉淀经验"，一个候选也找不到——golden path 截图里 Agent 那句"no rule candidate matched the current extraction heuristics yet"一直在如实报告这件事，只是此前被当成数据太少。
- **实现：两种产物汇入同一个筛选 helper**，而不是两处各写一遍判定慢慢分叉。两者结构确实不同——legacy 是「列名→统计」映射且不带列类型，现代是带 `kind` 的列表——因此现代路径额外限定为数值列，中位数填充建议本就只适用于数值列；legacy 无类型信息，保持其原有行为不变。一次会话同时存在两份画像时按列去重，同一列不会沉淀两次。
- **端到端验收**：新增后端用例真实跑完自然语言主路径（`Analyze this dataset and prepare it for modeling`），再调用 `extract-from-session`，断言确实产出 `age` 的候选且状态为 `pending_review`。
- **顺带收紧一个纵容缺陷的断言**：E2E 此前只断言 `lesson_review` 卡片渲染出来——卡片是由 intent 路由无条件召唤的，**候选为空时它照样出现**，所以这个断言在闭环断裂的整段时间里一直是绿的。现改为断言真的产出了候选。E2E 数据集同时从 12 行扩到 24 行并让 `age` 缺 1 个（4.2%），使主路径真正走过"低缺失率数值列"这一可沉淀情形。
- **一次夹具错误**：首版端到端用例用 12 行数据缺 1 个 = 8.3%，超出 `(0, 5%]` 边界，测试红了但**是我的数据算错而非代码问题**——扩大样本量后通过。
- **门禁**：后端 ruff + `248 passed, 3 skipped`；前端 Vitest `37 files / 247 tests` + ESLint；Playwright `10 passed`（扩数据集未破坏任何既有断言）。
- **动态计划**：自进化闭环的抽取与注入两个半环至此都在主路径上成立。P3-2（`kernel_output` 无生产方）是下一项，它决定抽取器另一类经验能否触发。

## 2026-07-28 P3-2 kernel 报错补上生产方

- **缺陷复述**：`kernel_output` 两端的消费方一直都在——日志面板按 stderr 分级渲染、抽取器据它沉淀依赖缺失类经验——但全后端没有任何生产方。两者因此都是死代码：kernel 报错既不出现在日志里，也永远无法沉淀成经验，而这正是抽取器仅会的两类经验之一。
- **发射位置的选择**：训练在 REST 路径执行，那里只写任务状态与产物、**不写会话事件**（`machine_learning.py` 此前根本没有引入 `SessionService`）。而抽取器读的是持久化会话事件，日志面板也从持久化事件取数。因此在训练失败已经收敛的唯一位置 `_write_training_failure_state` 补发事件——三处 `except` 分支都经由它，不会漏。
- **失败处理的边界**：会话不存在时（例如默认的 `manual-training`）静默跳过而非抛错。训练失败本身已由任务状态与 HTTP 响应如实报告，**不该因为记事件失败而把它变成另一种错误**。
- **端到端验收**：用例断言 kernel 报 `ModuleNotFoundError` 后，事件确实出现在 `/api/sessions/{id}/events` 且 `stream=stderr`；随后调用 `extract-from-session`，确实沉淀出 `["runtime", "kernel-error"]` 经验且建议里含缺失的包名——即这类经验从"永不可能"变为真实可沉淀。
- **门禁**：后端 ruff + `249 passed, 3 skipped`；前端 Vitest `37 files / 247 tests` + ESLint；Playwright `10 passed`。
- **动态计划**：抽取器的两类经验至此都能在真实路径上触发。P3-3（情境标签只反映模式、不反映运行中的错误）现在有了现实意义——kernel-error 经验虽可沉淀，但其 `domain: ["runtime", "kernel-error"]` 仍需上下文带同名标签才会被注入。

## 2026-07-28 P3-3 情境标签并入未解决的失败（错误闭环收口）

- **缺陷复述**：情境标签只由运行模式派生，因此 `["runtime", "kernel-error"]` 这类错误经验永远匹配不到——**恰恰在最需要它的时候缺席**：一次刚撞上同类报错的运行，标签里却没有任何错误情境。
- **信号选择：任务状态而非事件历史**。失败被重试或放弃后任务状态即被删除，因此它回答的是"现在还有没有这个问题"；翻事件历史回答的是"历史上曾经出现过"，会让一次早已修好的报错永远把会话标记为错误情境。这个区别决定了标签是有用的现状描述还是逐渐失真的陈年记录。
- **错误闭环至此完整**：三处缺口曾各自切断这条链路——kernel 报错没有生产方（无从沉淀，P3-2）、规则打分把未知维度当成不符（沉淀了也匹配不到，PR #5）、情境标签只反映模式（错误经验永远对不上，本片）。新增端到端用例走完整个往返：训练撞上 `ModuleNotFoundError` → 从该次失败沉淀经验 → 采纳 → 失败仍未解决时下一次运行确实命中该经验。
- **反向用例**：无未解决失败时不谎称运行处于错误情境，避免把"放宽匹配"做成"到处匹配"。
- **门禁**：后端 ruff + `252 passed, 3 skipped`；前端 Vitest `37 files / 247 tests` + ESLint；Playwright `10 passed`。
- **动态计划**：P3-1/P3-2/P3-3 完成，自进化闭环在数据与错误两条线上都真实闭合。剩余 P3-4（四个 action hook 共 1,412 行命令式逻辑无直接测试）与 P3-5（超大文件拆分），均属工程健康，建议按此顺序——先补测试再动结构。

## 2026-07-28 P3-4 领域 action hook 补直接测试

- **为什么是这层**：四个 hook 共 1,412 行命令式业务逻辑此前只靠 E2E 间接覆盖，而本轮多个缺陷恰好都出自这里——本地审批空操作、`open_artifact` 不联动预览、会话就绪前消息丢失。
- **测的是真正会坏的地方，不是行覆盖率**：重命名/删除的路径级联（活动文件、训练数据集、预处理计划、展开目录一并跟随重命名后的目录，而 `data/raw_backup` 这种**仅前缀相似**的同级目录不受影响）、删除后的选择回退（活动文件回退到任一文件，训练数据集只回退到真正的数据集文件）、执行计划后的产物到状态交接、训练入参的三级回退与失败处理、以及每个治理操作后的经验列表失效。共 31 项。
- **揪出一个真实缺陷**：训练成功后自动沉淀的经验 `domain` 写作 `machine_learning`（下划线），而抽取器、情境标签与其他所有经验都用连字符。标签维度因此永远对不上，**该类经验注定无法被规则注入命中**——与本轮此前修的三处属同一类断裂：两侧词汇不一致导致链路静默失效。
- **两次自身失误**：① `renderFileActions(undefined)` 触发 JS 默认参数回落，"没有项目"分支根本没被测到，改为显式传对象；② 训练结果夹具缺 `runs`/`metrics_artifact`/`model_artifact`，报错是夹具不全而非代码问题。两者都由测试自身暴露并修正。
- **门禁**：前端 Vitest `41 files / 278 tests`、ESLint、build + 预算门禁；后端 `252 passed, 3 skipped`；Playwright `10 passed`（domain 词汇改动未影响既有断言）。
- **动态计划**：P3 仅剩 P3-5（超大文件拆分）。该层现在有了直接测试托底，拆分风险显著下降。

## 2026-07-28 P3-5 切片 1：RightPanel 拆分（2,367 → 329 行）

- **先复核证据再动手**：四个待拆文件都比 P3 盘点时记录的更大（`RightPanel.tsx` 2,278→2,367、`stages.py` 1,841→1,950、`componentRegistry.ts` 1,287→1,345、`machine_learning.py` 1,097→1,228）——它们在 P3-1~P3-4 期间仍在膨胀，问题在恶化而非静止。
- **延续目录里已有的模式，而不是另发明一套**：`right-panel/` 下 `errorSlices`、`transformDiff`、`trainingDiagnostics`、`inspectorContext` 早已是"纯逻辑拆成同目录模块 + 各带测试"，所以剩下的 2,367 行全是组件与展示层。按职责拆成 9 个模块：`panelTabs`、`panelTypes`、`panelFormat`、`csvPreview`、`PanelPrimitives`、`ArtifactPreview`、`ActiveFilePreview`、`ChartsEmptyState`、`TrainingPanel` + `TrainingRunDetail`。
- **拆分点按状态归属选，不按行数切**：`TrainingPanel` 原有 15 个 `useState`。若只把「实验详情」当模板切走，它需要约 20 个 props——等于没拆。审计后确认预测样本读取、切片筛选、候选模型排序、报告/导出按钮态**只服务于选中实验这一个视图**，于是连状态一起搬进 `TrainingRunDetail`，父组件只保留训练配置、GPU 操作与历史列表选择，接口收窄到 `onFeedback` + `onOpenArtifactPath`。副作用是原先跨 400 行的「点击错误切片 → 过滤预测样本」联动现在收在同一文件内，反而更易读。
- **揪出一处用户直接可见的缺陷**：实验详情里"评估策略"标签是乱码 `璇勪及绛栫暐`——"评估策略" 的 UTF-8 字节被按 GBK 解读的产物（`E8AF`→璇、`84E4`→勪…）。按 GBK 误读的特征字符全项目扫描后确认**仅此一处**，其余中文完好。
- **没有在重构里新种一个同类断裂**：搬 `ActiveFilePreview` 时我一度把二进制提示语在判定处（`activeFileReadError`）与消费处（`isBinary` 比较）各写了一遍字面量。这正是本轮反复修的"两侧词汇不一致致链路静默失效"模式——改一处另一处会静默失配，下载入口就再也不出现。已改为从 `panelFormat` 单一导出 `BINARY_PREVIEW_MESSAGE`。
- **拆分的附带收益是可测性**：`parseCsvPreview` 此前埋在组件文件里无法直接测，而它有真正会坏的逻辑。新增 29 项测试——CSV 的引号包裹逗号、`""` 反转义、引号内换行不分行、CRLF、maxRows 截断、无尾换行；格式化层的"零值不能当缺失值"（`formatMetricCount(0)` 必须是 `"0"` 而非 `"-"`）、415→二进制提示、扩展名路由大小写不敏感。
- **门禁**：前端 `43 files / 307 tests`（基线 41/278）+ ESLint + build；后端 `252 passed, 3 skipped`；Playwright `10 passed`。**首屏 bundle 与拆分前逐字节一致**（469.02kB / gzip 135.02kB，`HistogramChart` 仍是独立懒加载 chunk）——这是"纯结构改动、未引入新首屏依赖"的直接证据。
- **动态计划**：P3-5 余下三个文件。`stages.py` 已勘察好边界——单个 `StageRunnersMixin` 内 15 个 `_run_*` 方法，每个 80~200 行，可按 intent 分组为 recovery / data / model / governance 四个 mixin 再继承回来，属机械拆分；`componentRegistry.ts` 与 `machine_learning.py` 待勘察。

## 2026-07-28 P3-5 切片 2：stages.py 拆分（1,950 行 → stages/ 包，最大 378 行）

- **先证明这是纯归属划分，再动手**：15 个 `_run_*` 方法**彼此不互相调用**（`grep self._run_` 只命中一处 `_run_agentic_answer`，而它不在此文件内），且 `StageRunnersMixin` 全项目仅被 `agent_orchestrator_service.py` 引用一次。这两点决定了拆分不会改变任何调用关系——是搬家，不是改结构。
- **按 intent 分六组，每组都有语义理由**：`data`（概览/摄取/画像/清洗）、`preprocessing`（变换/建模准备/已批准执行——三者共享同一个审批检查点语义，都在写或删 pending approval）、`model`（训练/评估）、`diagnosis`（诊断/迭代——诊断产出的错误切片正是迭代提案的输入，同一条因果链）、`handoff`（导出/学习）、`recovery`（继续/放弃上次失败）。`stages/__init__.py` 把六个 mixin 聚合回 `StageRunnersMixin`，因此 **`AgentOrchestrator` 零改动**——导入路径 `from .stages import StageRunnersMixin` 与组合方式都不变。
- **方法体不手抄**：用 `sed` 按行范围逐字节提取。这是上一片的经验反过来用——切片 1 我手抄了 2,000 行，虽然测试通过，但手抄本身是无谓风险。提取后对账：1,911 行方法体 + 39 行 header = 原文件 1,950 行，且 15 个方法名全部到位、每段都以 `async def _run_*` 开头。
- **ruff 抓到一处我的分析错误**：我用 grep 统计每个导入符号的归属，把 `recovery.py` 里 `state.get("recovery_policy")` 这个**字典键字符串**误判成对导入函数的调用，于是多给了一个 import。grep 无法区分标识符与字面量——这类错误只能靠工具兜住，`F401` 正好报了出来。反过来说，"少给 import" 不会被 ruff 发现，那是靠 pytest 的 NameError 兜住的；两道门禁各管一头。
- **验收**：运行时自检确认 `AgentOrchestrator` 的 MRO 为 `StageRunnersMixin → Data → Preprocessing → Model → Diagnosis → Handoff → Recovery → Messaging`，15 个 stage runner 全部正确解析。后端 ruff + `252 passed, 3 skipped`；Playwright `10 passed`——其中 `natural-language.e2e.ts` 真实走完 profile→approval→train→evaluate→diagnose→export→learn，即经过全部被拆开的 runner，不是只验证了 import 能过。
- **动态计划**：`stages.py` 已从项目最大文件榜消失。P3-5 余下 `componentRegistry.ts` 1,345 行（现为全项目最大）与 `machine_learning.py` 1,228 行。

## 2026-07-28 P3-5 切片 3：componentRegistry.ts 拆分（1,345 → 113 行）

- **这一片不能纯搬移**：`buildCockpitComponentCards` 单个函数约 980 行——86 个派生局部变量后面跟着 18 个卡片块，全部共享同一个作用域。前两片靠"方法/组件彼此独立"就能安全切开，这里不成立。
- **所以先建依赖图，再动手**：把每个派生变量归属到真正读取它的卡片块，结果是 **86 个中 78 个只属于一组，仅 8 个跨组**（`signals`、两个 missing command、`activeDatasetPath`、`effectiveTargetColumn`、`planPath`、`plannedDatasetPath`、`datasetDisabled`）。这个比例才是拆分可行的前提——如果大部分变量都跨组，拆开只会把一个大作用域换成一堆长参数列表。
- **分组与后端 `stages.py` 落在同一套边界上**：blocked / recovery / data / preprocessing / model / diagnosis / handoff。两个技术栈、两个文件、独立分析后得出同一组划分，说明这是领域自带的边界，不是我强加的。
- **context 刻意保持窄**：七个 builder 共享 `CardBuilderContext`，里面**只放真正跨组的值**。把 86 个全塞进去等于用新名字复现原来那个大作用域——那是"看起来拆了"。各组私有派生值留在各自 builder 内部计算。因为 builder 解构 context，**sed 提取的卡片块一行未改**就能复用，引用的还是同名裸标识符。
- **顺序是产品行为，不是实现细节**：`selectVisibleCockpitCards` 取末尾 N 张卡片，所以调换 builder 顺序会直接改变用户看到哪几张卡。requested-component 兜底留在编排层（它必须看到之前所有卡片）；三个检查"是否已有 task-state-inspector"的重试块全部落在 recovery 组内部，顺序依赖因此不跨组——这一点是分组时特意确认的，否则拆开就会静默改变行为。
- **两处 grep 假象在成为缺陷前被拦下**：`datasetVersionId` 在 593 行是**对象字面量的键名**、`taskInspection.planPath` 是**属性访问**，两者都不是对局部变量的使用。照 grep 结果归属会把错误的值放进 context。这是切片 2 被 ruff 抓到同类问题后我提前加的核对步骤——上一次靠门禁兜住，这一次自己先查了。
- **门禁**：tsc 一次通过；前端 `43 files / 307 tests`（含 `componentRegistry.test.ts` 的 32 个用例）、ESLint、build、Playwright `10 passed`。首屏 bundle 增加 0.66kB / gzip 0.03kB——**不像切片 1 那样逐字节一致**，因为这一片确实重组了结构（引入 context 对象与七次函数调用），代价很小但不为零，如实记录。
- **动态计划**：P3-5 仅剩 `machine_learning.py` 1,228 行（现为全项目最大源文件）。

## 2026-07-28 P3-5 切片 4：machine_learning.py 拆分（1,228 行 → machine_learning/ 包）与 P3 收口

- **调用图严格单向，分组自然浮现**：`support` → `report` / `bundle` / `failure_state` → `runs` / `training` → 包根。路由前缀与路径不变，`app.main` 的导入方式也不变。最大子模块 `training.py` 400 行。
- **两个 helper 按"谁在用"归位，而非"原来在哪"**：`_record_kernel_stderr` 原在通用 helper 区，但只被失败路径触达（它正是 P3-2 补的 `kernel_output` 生产方），归入 `failure_state`；`_require_artifact_file` 只被运行查询路由调用，归入 `runs`。
- **拆分对测试有不可避免的连带影响，而两类 patch 性质不同**——这是本片最需要想清楚的地方。八处 monkeypatch 指向这个模块：`gpu_scheduler` 是**单例对象**，patch 的是对象方法，对所有持有引用的模块生效，因此包根 re-export 后那 2 处无需改动；`create_kernel_service` 是**普通函数**，patch 的是模块属性，只影响被 patch 的那个模块，调用点搬到 `training.py` 后那 6 处必须改指向。**改后的路径也更正确**：patch 本就该指向真正使用该符号的模块，而不是历史上恰好定义它的地方。
- **ruff 抓到我自己归属阶段的 3 个 F821**：两个 `train_*_classifier` 是纯遗漏（分析里有、写 header 时漏了）；`_resolve_project_file` 是因为我的调用图脚本按行号归类，把 `_require_artifact_file` 算进了 support，而我后来把它划给了 runs——**分析与最终划分不一致**。这也**修正了我在切片 2 的说法**：我当时写"少给 import 不会被 ruff 发现，靠 pytest 的 NameError 兜住"，实际上 F821 静态就能发现，ruff 双向都管。
- **grep 假象连续第三片被拦下**：`Field` 在 `report.py` 里是 Markdown 表头字符串 `["Field", "Value"]`，不是 pydantic 的 `Field`。前两次分别是字典键 `"recovery_policy"` 和对象键 `datasetVersionId:`。
- **一次自检方法的失误**：我先写了个枚举 `app.routes` 的脚本判断路由是否注册，它报 0 条 ML 路由——差点据此认为拆坏了。实际原因是这个 FastAPI 版本把 included router 包成 `_IncludedRouter`（`path` 为 `None`）、不展平到 `app.routes`，**是脚本方法不适用，不是回归**。改用直接打端点后拿到决定性证据：请求不存在的项目返回处理函数自己的 `Project not found` 而非 FastAPI 默认的 `Not Found`（证明路由匹配并执行了处理函数），OpenAPI 列出全部 **9 条 ML 路径**、与拆分前一条不差。教训是自检脚本本身也需要证伪——pytest 全绿时就该怀疑脚本而不是代码。
- **门禁**：后端 ruff + `252 passed, 3 skipped`（含 13 个打真实端点的 ML API 测试）；Playwright `10 passed`。
- **P3-5 完成，P3 整体收口**。四个文件累计 6,890 行，拆后最大单文件 400 行。四片难度并不相同：切片 1/2 是搬移（成员彼此独立），切片 3 必须先建 86 个变量的依赖图才敢动，切片 4 的难点在测试 patch 的语义差异。**一个跨栈的观察**：`stages.py`（后端 Python）与 `componentRegistry.ts`（前端 TypeScript）在独立分析后落在同一套分组边界上——recovery / data / preprocessing / model / diagnosis / handoff。同一套边界在两个技术栈、两个互不相关的文件里各自浮现，说明它是产品领域自带的结构，不是谁强加的划分。

## 2026-07-28 P4 跨栈契约盘点与 P4-1 类型契约收口

- **这轮盘点的目的是验证 P3 是否真的闭合了链路**，而不是靠印象。沿用 P3 的手法（"找有消费方无生产方、或反之"），但**六个方向都做双向比对**——P3 那次只查了事件类型一个方向。
- **结论先行：没有找到已在生产路径上失效的缺陷。** 这个"没找到"本身是有价值的结果：事件类型 20 种双向一致（`kernel_output` 自 P3-2 起有生产方）、图谱洞察 2 种前端完整消费、21 个 cockpit action 的声明/handler/回调三层齐备、53 条 API 端点双向一致、10 个 stage id 完全一致、6 种 artifact_role 都有识别路径。
- **过程中排除了 5 处假象**，都记进了 `task_plan.md` 以免后来者重复劳动：`stage_started`/`stage_completed` 经变量发射；`tool_result`/`tool_use` 属 Anthropic API 消息块；`lessons/{id}/disable|enable` 是前端三元表达式拼接；`transformation_report` 经 artifact 文件名而非事件识别；`POST /rules/match` 只有测试调用，但运行时的规则命中由 `rules_matched` 事件在日志面板完整呈现，功能没断。
- **唯一的真实发现是类型防线不完整**（P4-1）：`AgentComponentKind` 声明 14 种、后端发射 13 种，两边各有出入——后端发射的 `task_state_inspector` 不在声明里，声明里的 `provenance_graph` 后端从不产出也没有卡片 builder；而 `COMPONENT_LABELS` 是 `Record<string, string>`，新增 kind 时**编译器不强制补中文标签**。component kind 是 cockpit 卡片路由的键，拼错即卡片静默不出现，正是 P3 反复修的那类缺陷的温床，而防线本该由类型系统提供。
- **一次被我自己推翻的推测**：我一度认为 `task_state_inspector` 缺标签会让用户在中文界面看到英文标识符，正要写成"用户可见缺陷"时去查了后端——它发射时总带 `title`，而 `componentTitle` 只在 `event.title ?? …` 的兜底位置调用，所以这个后果并不成立。如实记下：**这是温床，不是已发生的失效。**
- **修复的三处与保留的一处**：补 `task_state_inspector`、删死声明 `provenance_graph`（含标签）、`COMPONENT_LABELS` 收紧为 `Record<AgentComponentKind, string>`。事件字段的 `component: AgentComponentKind | string` **有意保留**——它表达"来自网络的数据可能是未知 kind"，对边界数据是合理容忍；收紧它只会把运行时问题换成假的编译期安全感。
- **护栏做了负向验证**：临时删掉一个标签后 tsc 确实报 `TS2741 Property 'task_state_inspector' is missing`。不做这一步，"编译器强制标签完整"就只是未经验证的断言——而本轮反复出现的教训正是"声称 ≠ 验证"。
- **门禁**：前端 `43 files / 322 tests`（新增 15 项：14 个已声明 kind 都拿到中文标签、不回退到裸 kind，外加未知 kind 回退到自身）、tsc、ESLint、build + 预算门禁、Playwright `10 passed`。未触碰后端。
- **动态计划**：P3 与 P4-1 均已收口，`task_plan.md` 无未勾选项。roadmap 里仍标 Planned 的较大项为：typed/inspectable 的工具调用事件（P0 级但一直未动）、诊断可行动化、provenance inspector（删掉的 `provenance_graph` 声明就属于它）。另一个可选方向是 `componentRegistry.test.ts` 1,662 行——它现在是最大的测试文件，可按新的 cockpit 模块边界切开。

## 2026-07-28 P4-2 未运行的阶段不再谎报为已完成

- **起点是核查 roadmap 里唯一还标 P0 的 Planned 项**（"Make tool invocation typed and inspectable"）。实测结论是**它大部分已经实现**——工具的 start/finish 通过两个 helper 成对发射（真实主路径 3 开始 / 3 结束、零孤立），载荷统一，前后端类型对齐。roadmap 的状态是过时的，真实差距在别处。
- **调查中我犯了两次错误，都由实测纠正**：① 第一版探针只统计 `tool_call_started`、漏了 `tool_started`，于是"2 个 finished 无对应 started"的假象让我以为找到了大缺陷——补上后配对完好；② 由此我一度认为这两种事件类型语义重复，直到看清事件顺序才明白 `tool_call_started tool=agent_orchestrator` 是**跨阶段的外层包裹**（最后才 finish），`tool_started` 才是具体工具，两者是有意区分。**"名字相似"这一坑本轮踩了四次**（`recovery_policy` 字典键、`datasetVersionId` 对象键、`Field` 表头字符串、这次的两种 tool 事件）。
- **真正的缺陷在阶段状态语义上**：`markEarlierStagesReady` 的函数名与它写入的 detail 都是"就绪"，但 status 赋的是 `"completed"`——`WorkflowStepStatus` 当时没有"就绪"这一档。阶段条直接用 status 作 CSS class，而 `.workflow-stage.completed` 用的是 **success 绿**。
- **触发条件是每次对话**：`rules_matched` 是规则注入链路的常态事件，`workflowState.ts:462` 收到它就把 learn 设为 active，于是 learn 之前的 train / evaluate / diagnose / iterate / export 全被标成已完成。
- **用真实数据实测，而不是读代码推断**：跑一次自然语言主路径（只跑完画像、停在变换审批），把导出的持久化事件喂给 `deriveWorkflowState`，得到 `train=completed evaluate=completed diagnose=completed iterate=completed export=completed`——**五个从未运行的阶段显示为成功色**。`currentStage` 本身正确（`transform blocked`），所以这是"阶段条谎报进度"，不是"当前阶段错"。
- **现有 322 个测试对此零覆盖**——这正是它长期存在的原因。修复后新增 2 项测试，并做了**负向验证**：把 status 改回 `completed`，这 2 项确实失败（`train 从未运行，不应报成 completed`）。不做这一步就无法确认测试真的能捕获缺陷。
- **一次自身失误**：测试夹具漏了 `rules_matched` 的必需字段 `prompt_snippet`，vitest 用 esbuild 不做类型检查所以照样绿，是 tsc 报出来的。**vitest 全绿不能替代 tsc**——这两道门禁各管一头。
- **门禁**：前端 `43 files / 324 tests`、tsc、ESLint、build + 预算门禁（CSS +0.02kB，来自新增的 ready 样式）、Playwright `10 passed`；未触碰后端。
- **动态计划**：调查中另外确认了一项独立问题并记为 P4-3——`tool_call_started` 不带 stage，而 14 个发射点里 13 个的 `tool` 都是 `"agent_orchestrator"`，它匹配不到前端 `STAGE_TOOL_PATTERNS` 的任何正则，阶段归属必然回退到默认值。实测 `currentStage` 仍被后续 `stage_started` 修正，故后果是阶段条多一个错误 active 标记，严重性低于 P4-2，单独处理。

## 2026-07-29 P4-3 阶段归属不再靠猜

- **我记 P4-3 时低估了它的严重性，实测把结论推翻了**。原记录写的是"后果是阶段条多一个错误 active 标记，严重性低于 P4-2"。真实后果是 **P4-2 那个缺陷的另一条活路**：包裹事件的 `tool_call_finished` 会把猜出来的阶段直接标成 `completed`，而 P4-2 修的是 `markEarlierStagesReady` 那条路径，管不到这里。**低估的原因是我只看了 started 分支没看 finished 分支**。
- **实测方法**：跑六段真实会话（概览、经验、清洗、画像、变换、训练），取持久化事件喂给 `deriveWorkflowState`，两种模式各算一遍。结果——ML 模式下 learn / clean / profile / transform / overview **五段都把「训练」显示成已完成**；分析模式下 clean / profile / transform 把「接入」显示成已完成。修复后两种模式的输出**完全一致**，这本身就是判据：`defaultStage` 不再泄漏成假的完成标记。
- **一处修复带出两处同类缺陷，都是同一次实测里现形的**：① `task_progress` 的收尾标签 `Complete` 不指向任何阶段，兜底到 defaultStage 后被读成"该阶段完成"；② 阶段词表漏词——`learn` 根本不在表里，`evaluate` / `diagnose` 只有动词形式，而后端发的是 "Learning context ready" / "Evaluation context ready" / "Diagnosis context ready"，三条都漏过前面所有行，最后被 ingest 行的 `read` 捞走——**`ready` 含子串 `read`**。经验/评估/诊断的进度被记到「接入」上。
- **改法收敛成一条规则**：阶段归属只认事件自带的 stage，认不出就不动阶段条。`tool_started` 带准确 stage，照旧驱动；包裹事件仍进日志面板与工具活动条，只是不再驱动阶段条；失败仍由随后带 stage 的 `error` / `step_failed` 呈现——这一点特意核对过 `_emit_resolution_error` 与各 runner 的错误分支，两者都成对发射，不会把失败吞掉。
- **E2E 抓到了一处真实回归，也暴露了一个坏断言**。"没有保存的失败状态"这条消息**没有卡片**，用户此前唯一能在阶段条上看到它的原因是：那条进度不带 stage，被兜底写进了「接入」的 detail。E2E 断言的正是这个巧合。判据改到助手回复本身（"did not find a saved failed task state"），并加断言不得出现恢复卡片——这比断言一个不相关阶段的 detail 更贴近那条测试自己写的意图（"必须如实说明，而不是假装恢复了什么"）。
- **测试守整类而不是逐个单词**：`learn` 是踩到才发现的，`Evaluation` / `Diagnosis` 是随后从后端字面量里翻出来的——照这个补法只能补到下一次踩雷为止。所以新增 16 项表驱动用例，逐条照抄后端实际发射的 `task_progress` 标签并固定它落到哪个阶段（含三条"不该落到任何阶段"的）。四处修复各自做过负向验证：撤回包裹事件修复挂 2 项、撤回 `Complete` 修复挂 1 项、撤回 `learn` 挂 1 项、撤回词干挂 2 项。
- **门禁**：前端 `43 files / 343 tests`（新增 19 项）、tsc、ESLint、build + 预算门禁（gzip 135.04kB 未变）、Playwright `10 passed`；未触碰后端，ruff 复核通过。
- **动态计划**：另记一项已实测但不在本片修的问题——`"Waiting for dataset selection"` 由训练阶段发出，却因含 `dataset` 归到「接入」。它不是词表漏洞（标签确实在说数据集），要修得让 `task_progress` 带上 stage，属后端契约变更，另开一片。

## 2026-07-29 金链路补上阶段条诚实性断言

- **为什么做这一片**：过去十来片里，每一次真实缺陷都是"跑真实系统看输出"发现的，没有一次是测试套件报出来的。P4-2、P4-3 被发现时 324 项单测 + 10 项 E2E 全绿，而 P4 那轮"六方向双向盘点"恰恰没抓到它们——**盘点比的是两侧词汇是否一致，不是行为**。所以把手工探针变成常驻门禁，比再做一轮盘点有用。
- **缺口很具体**：金链路 E2E 早就走完整条流程，但它**只断言卡片出没出现，从不看阶段条的状态**。P4-2/P4-3 的症状全在阶段条上，于是从它眼皮底下走过去。
- **判据的第一版被实测推翻，这是本片最有价值的一步**。我写的是"只有用户显式要求过的阶段才能标完成"，跑起来立刻挂：训练那一步之后评估、诊断、沉淀都是 completed。查下来是**我错了不是应用错了**——一次 sklearn 训练本身就会写出 `prediction_samples.json` 与候选对比产物（`api/machine_learning/training.py:80`），评估与诊断因此拿到真属于自己的证据。**产物归属才是判据，用户说没说过不是。** 改成"摄取/清洗/迭代全程不得显示为完成"——这三个阶段在这条链路里确实没有任何产物或事件。
- **两半判据缺一不可**：只查"不得谎报完成"的话，一条永远空白的阶段条能完美通过；所以另一半查"走到过的阶段必须留下痕迹"。
- **负向验证做了两次**，这是"这条断言能抓住那两个缺陷"从说法变成事实的唯一途径：回退 P4-3 的修复 → 金链路报 `谎报完成: ["ingest"]`；回退 P4-2 的修复 → 报 `["ingest","clean","iterate"]`。
- **实现细节**：阶段条同时输出 `data-workflow-status`，class 供样式、data 供断言。让测试去解析 class 字符串的话，将来加一个修饰类就会误判。
- **门禁**：前端 `43 files / 343 tests`、tsc、ESLint、build + 预算门禁（gzip 135.05kB）、Playwright `10 passed`；未触碰后端。
