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
