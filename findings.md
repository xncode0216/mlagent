# MLAgent Follow-up Findings

## 2026-05-23

- `docs/project-progress.md` says the project is in runnable MVP plus self-evolution/graph/GPU enhancement stage.
- `docs/ui-demo-functional-development-plan.md` has an updated progress table, but its final "next step" section still contains old Phase 0/1 guidance.
- `backend/app/services/kernel_service.py` exposes `KernelServiceProtocol`, `LocalPythonKernelService`, and `DockerPythonKernelService`.
- The Docker kernel service currently runs one container per call with workspace mount support, but lacks explicit resource limits, mount mode controls, and path validation tests.
- `backend/app/services/gpu_scheduler_service.py` is an in-memory queue foundation; GPU worker binding is still later work.
- Kernel execution now has explicit Docker resource knobs: memory, CPU, pids limit, and workspace mount mode.
- Both local and Docker Kernel execution return structured timeout results instead of leaking `TimeoutExpired`.
- Frontend `npm.cmd test` and `npm.cmd run build` pass outside the sandbox; inside the sandbox, Vite/esbuild hits `Cannot read directory "../..": Access is denied`.
- A public API golden path can run through upload, WebSocket analysis, lesson extraction, adoption, ML handoff, baseline training, rule matching, injection log, and graph insight.
- Graph edge construction already parsed baseline `candidate_runs` feature names, but surprise-connection insights did not; this blocked baseline-backed adopted lessons from surfacing as insights.
- GPU scheduler cancellation previously woke queued tasks without telling the waiter it had been canceled, so callers could treat cancellation as acquisition.
- GPU scheduling now needs distinct user-facing states for acquired, queued, canceled, timed out, and released.
- The app now supports `?mode=machine-learning` to make training-panel QA deterministic without manual tab clicks.
- Playwright CLI is not available in the local frontend dependencies; npm-based CLI lookup tries to touch the user npm cache and registry, which is brittle under this sandbox.
- On this Windows host, Chrome CLI screenshot works when using `--headless=new --no-sandbox --disable-gpu --disable-extensions --no-first-run --no-default-browser-check --run-all-compositor-stages-before-draw --timeout=10000`; Vite dev-server pages still failed to emit a screenshot, while the built frontend served through a simple local static/API proxy succeeded.
- Knowledge graph nodes now carry stable `properties.provenance` metadata so the frontend can display source evidence for dataset columns, experiment runs, and lessons without inferring it from labels.
- The graph detail sidebar can display dataset paths, artifact paths, lesson source ids, and raw evidence key/value pairs; browser QA confirmed column and rule node evidence rendering.
- Graph evidence rows with file paths now expose file navigation actions that reuse `activeFile` and expand parent folders, avoiding a separate graph-specific navigation state.
- Dataset column provenance can include multiple source paths; displaying each path as its own evidence row keeps every source independently navigable.
- The left activity bar now has a central configuration and every visible icon opens a real sidebar panel; settings currently surfaces runtime/service state and quick mode switching rather than persisted preference editing.
- Experiment graph provenance now needs both artifact navigation and run-detail navigation; the `experiment_id` is the stable bridge between the graph, activity panel, and training detail.
- The in-app browser can validate the experiment focus behavior through DOM state, but full-page CDP screenshot capture can still time out on this page; keep CLI/browser fallback notes available for visual captures.
- Mainstream product UI guidance converges on the same priorities MLAgent needs next: visible system status, clear object navigation, consistent controls, local error recovery, accessible keyboard/focus behavior, and dense but calm operational layouts.
- `docs/skills/mlagent-frontend-product-designer/SKILL.md` is now the project-specific frontend optimization skill; future frontend work should load it before design or implementation.
- The in-app browser runtime may expose no `localStorage`; preference persistence should tolerate missing browser storage and keep the live app usable with an in-memory fallback.
- Training panel defaults must initialize from `suggestedTargetColumn`; a later effect alone is not enough when the default value equals the last suggested value during mount.
