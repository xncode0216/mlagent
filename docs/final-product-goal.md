# MLAgent Final Product Goal

## Goal

MLAgent should become an auditable, recoverable, and reproducible Data/ML Agent IDE.

The product is complete when a user can drive a full data-analysis and machine-learning workflow from the center Agent Cockpit with natural language:

```text
ingest -> profile -> clean -> transform -> train -> evaluate -> diagnose -> iterate -> export -> learn
```

At every step, MLAgent should produce inspectable artifacts, typed messages, tool calls, model runs, reports, approvals, recovery state, and learned-rule proposals. These outputs must be linked by provenance so the user can understand what happened, recover from failures, reproduce results, and safely reuse lessons.

The target is not merely a chat interface with data tools, nor only an AutoML surface. MLAgent should feel like a Codex-style IDE specialized for data analysis and machine learning.

## Completion Definition

MLAgent is an excellent data-analysis and machine-learning platform when a user can start from a raw data source, complete the full workflow through the center Cockpit, and always answer:

- What goal did the agent understand?
- Which dataset and version did the workflow use?
- What plan is the agent following?
- Which actions require confirmation?
- Which tools ran, with which parameters?
- Which artifacts were produced?
- How can a failed step be resumed, regenerated, or abandoned?
- How can the final result be reproduced and handed off?
- Which learned rules were proposed or adopted, and why?
- How can learned behavior be reviewed, scoped, disabled, or rolled back?

## Product Shape

### Left Navigation

The left side is the durable IDE navigation layer. It should expose:

- Projects
- Files
- Datasets
- Experiments and runs
- Knowledge and learned rules
- Logs and audit views
- Settings

The left navigation should help users find stable project resources, not force them to manually stitch together a workflow.

### Center Agent Cockpit

The center is the primary work surface. It should not behave like a passive chat transcript.

It should show:

- The interpreted user intent
- Selected dataset, plan, run, report, or lesson context
- The workflow phase timeline
- Current step and next action
- Typed tool calls and tool results
- Approval checkpoints
- Failed-state recovery choices
- Stage-specific Data/ML cards
- Artifact links
- Final handoff and learned-rule proposals

Users should be able to remain in one conversation while the agent progresses through data ingestion, profiling, cleaning, transformation, training, evaluation, diagnosis, iteration, export, and learning.

### Right Contextual Inspector

The right side should become a contextual Inspector. Selecting any dataset, profile, preprocessing plan, transformed dataset, experiment run, metrics file, report, log event, graph node, export bundle, or learned rule should reveal its canonical detail view.

The user should not need to guess which fixed tab contains the relevant detail.

## Core Completion Criteria

### 1. Full Natural-Language Workflow

The user can say:

```text
Import this dataset, analyze quality, clean and prepare it for modeling, train models, evaluate performance, diagnose recall issues, propose the next experiment, export a reproducible report, and extract lessons.
```

MLAgent should parse the request into structured workflow state and move through:

- Ingest
- Profile
- Clean
- Transform
- Train
- Evaluate
- Diagnose
- Iterate
- Export
- Learn

The user should not need to manually jump between disconnected analysis, training, logs, and knowledge views to complete the workflow.

### 2. Dataset Registry And Semantic Context

Every data source should have a stable registry record:

- Dataset id
- Dataset version id
- Source path or connector
- Source hash
- Source format
- Schema snapshot
- Row and column counts
- Sample strategy
- Column types
- Target-column candidates
- Column descriptions when available
- Business meaning when available
- Quality status
- Provenance links

Downstream profile, clean, transform, train, evaluate, diagnose, export, and learn steps should reference the dataset version instead of passing only a loose file path.

### 3. Agent Command And Context Resolver

Natural-language prompts should resolve into structured commands:

```json
{
  "intent": "train",
  "dataset_version_id": "dataset-v1",
  "target_column": "churn",
  "selected_run_id": null,
  "selected_artifacts": [],
  "missing_context": [],
  "risk_level": "medium",
  "planned_steps": ["profile", "transform", "train"],
  "proposed_tools": ["data_quality_profile", "preprocessing_plan", "train_sklearn"]
}
```

The system should ask for missing or ambiguous context before taking risky action.

### 4. Inspectable Cockpit Components

Each workflow stage should have real inline components:

- Ingest: dataset selector and source summary
- Profile: data quality profile and target candidates
- Clean: quality issue review
- Transform: preprocessing-plan editor and transform diff
- Train: training configuration and run monitor
- Evaluate: model comparison and evaluation report
- Diagnose: error slices and prediction samples
- Iterate: follow-up experiment proposal
- Export: reproducible handoff bundle
- Learn: learned-rule review

Cards should show real state, artifact links, actions, loading states, empty states, failure states, and confirmation requirements.

### 5. Editable And Auditable Preprocessing

Preprocessing should be a reviewable workflow, not a static JSON artifact.

The platform should support:

- Keep/drop column controls
- Target validation
- Missing-value strategy
- Encoding strategy
- Scaling strategy
- Leakage warnings
- Schema drift checks
- Train/test split strategy
- Transform preview
- Before/after schema diff
- Row-count and column-count diff
- Approval, revision, regeneration, execution, and retry
- Transformation report output

### 6. IDE-Style ML Runs

Training should feel like an IDE run/debug panel.

Each run should track:

- Dataset version
- Target column
- Preprocessing plan
- Engine
- Model candidates
- Parameters
- Random seed
- Validation strategy
- Metrics
- Candidate leaderboard
- Model artifacts
- Metrics artifacts
- Prediction samples
- Evaluation report
- Logs
- Runtime state
- Retry and rerun actions

Users should be able to compare baseline and follow-up experiments.

### 7. Actionable Diagnosis And Iteration

Diagnosis should lead to concrete next actions.

The system should identify:

- Weak classes
- Main confusion directions
- Error slices
- Misclassified examples
- Feature or preprocessing caveats
- Metric tradeoffs

It should propose reviewable iteration plans such as:

- Adjust features
- Revise preprocessing
- Tune threshold
- Handle class imbalance
- Try another model family
- Collect or label more data
- Rerun from a saved configuration

Follow-up runs should be compared against the previous baseline.

### 8. Provenance As The Product Spine

Every visible object should answer:

- What produced it?
- Which data version was used?
- Which tool ran?
- Which parameters were used?
- Which message or command triggered it?
- Which session and run does it belong to?
- Was human approval required?
- Which artifacts came out of it?
- What downstream objects depend on it?

This applies to:

- Messages
- Tool calls
- Dataset versions
- Profiles
- Cleaning decisions
- Preprocessing plans
- Transformed datasets
- Training runs
- Metrics
- Models
- Reports
- Prediction samples
- Export bundles
- Logs
- Learned rules

### 9. Recovery And Human Control

Risky or behavior-changing actions should be human-controlled.

The system should provide approval gates for:

- Dataset mutation
- Preprocessing execution
- Training execution when context is ambiguous
- Exporting deliverables
- Adopting learned rules

Recoverable failures should persist task state:

- Stage
- Status
- Inputs
- Artifact paths
- Retry count
- Last error
- Repair hint
- Stale artifact check
- Resume action
- Regenerate-upstream action
- Abandon action

The user should be able to resume, regenerate, or abandon failed work without losing context.

### 10. Workflow-Level Reproducible Export

The final export should be a workflow-level handoff bundle, not only a model artifact.

The bundle should include:

- Manifest
- Dataset version reference
- Schema snapshot
- Data quality profile
- Cleaning decisions
- Preprocessing plan
- Transformed dataset reference or artifact
- Training configuration
- Model artifact
- Metrics artifact
- Candidate comparison
- Diagnostics
- Prediction samples
- Evaluation report
- Logs
- Tool parameters
- Environment or dependency information
- Provenance graph or summary
- Learned-rule proposals

Every file in the bundle should have a source step and hash in the manifest.

### 11. Safe Learning Loop

Learning should improve future workflows without silently changing behavior.

Learned-rule proposals should show:

- Source session
- Evidence artifacts
- Evidence events
- Confidence
- Scope
- Conditions
- Expected benefit
- Conflict detection
- Adopt/reject decision
- Injection audit
- Rollback or disable action

Accepted rules should be visible when they influence future agent behavior.

### 12. Agent QA And Benchmarks

The platform should continuously test both software behavior and agent behavior.

Quality gates should include:

- Backend contract tests
- Frontend component tests
- Lint/type/build checks
- Browser smoke tests
- Full natural-language golden path
- Failure and recovery fixtures
- Intent-routing tests
- Structured command parser tests
- Dataset/version/provenance tests
- Agent benchmark prompts

Benchmarks should cover:

- Target-column recognition
- Dataset-context resolution
- Safe preprocessing recommendations
- Training configuration quality
- Evaluation/report completeness
- Diagnosis usefulness
- Export bundle completeness
- Learned-rule safety

## Platform Maturity Levels

### Level 1: Runnable Data/ML Workbench

The app can manage projects and files, profile CSV datasets, generate reports, run basic sklearn training, display metrics, and show logs.

### Level 2: Agent Cockpit MVP

The center Cockpit routes natural-language prompts to typed workflow stages, generates artifacts, requests components, and pauses for approvals before risky actions.

### Level 3: Recoverable Data/ML IDE

The system persists task state, supports retry/resume/abandon, displays failure inspectors, and keeps workflow context across reloads and sessions.

### Level 4: Interactive Data/ML Workflow Platform

Users can edit preprocessing plans, inspect transform diffs, configure training, diagnose errors, create follow-up experiments, and export reproducible workflow bundles from one Cockpit.

### Level 5: Auditable And Learning Data/ML Agent IDE

Every artifact, message, tool call, model run, report, export, and learned rule has provenance. The platform safely learns from successful workflows and evaluates its own agent behavior through benchmarks.

## Non-Goals

MLAgent should not optimize for:

- A decorative landing page
- A generic chatbot experience
- A disconnected collection of panels
- Auto-executing high-risk changes without review
- Hidden data mutation
- Untraceable learned behavior
- Model metrics without reproducibility
- Export bundles that omit data, parameters, logs, or provenance

## One-Sentence Definition Of Done

MLAgent is complete when a user can start with a raw data source and, through one natural-language Agent Cockpit, complete data ingestion, profiling, cleaning, transformation, training, evaluation, diagnosis, iteration, export, and learning with every step explainable, approval-aware, recoverable, reproducible, and traceable.
