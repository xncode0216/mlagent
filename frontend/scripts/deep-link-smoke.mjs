/* global WebSocket, URL, clearTimeout, console, fetch, process, setTimeout */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const baseUrl = process.env.SMOKE_BASE_URL ?? process.argv[2] ?? "http://127.0.0.1:5174";
const apiBaseUrl = process.env.SMOKE_API_URL ?? inferApiBaseUrl(baseUrl);
const browserPath = process.env.BROWSER_PATH ?? findBrowserExecutable();
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 20_000);
const smokeProjectName = process.env.SMOKE_PROJECT_NAME ?? "smoke_deep_links";
const smokeDatasetPath = "data/smoke_churn.csv";
const smokeAnalysisSessionId = "smoke-golden-analysis";
const smokeFollowUpSessionId = "smoke-golden-follow-up";
const smokeSessionId = "smoke-deep-link-training";
const smokeProfileIntentSessionId = "smoke-profile-intent";
const smokeCleanIntentSessionId = "smoke-clean-intent";
const smokeTransformIntentSessionId = "smoke-transform-intent";
const smokeIterateIntentSessionId = "smoke-iterate-intent";
const smokeTrainIntentSessionId = "smoke-train-intent";
const smokeAmbiguousDatasetSessionId = "smoke-ambiguous-dataset-selection";
const smokeEvaluateIntentSessionId = "smoke-evaluate-intent";
const smokeAmbiguousRunSessionId = "smoke-ambiguous-run-selection";
const smokeAmbiguousDiagnoseSessionId = "smoke-ambiguous-diagnose-selection";
const smokeAmbiguousExportSessionId = "smoke-ambiguous-export-selection";
const smokeDiagnoseIntentSessionId = "smoke-diagnose-intent";
const smokeExportIntentSessionId = "smoke-export-intent";
const smokeLearnIntentSessionId = "smoke-learn-intent";
const smokeLessonMarker = "smoke-golden-path-v1";
const smokeExplanationExperimentId = "smoke_sklearn_explanation";
const smokeAmbiguousBaselineExperimentId = "smoke_ambiguous_baseline";
const smokeAmbiguousSklearnExperimentId = "smoke_ambiguous_sklearn";
const smokeExportRetrySessionId = "smoke-export-retry";
const smokeLearnRetrySessionId = "smoke-learn-retry";

function buildSmokeCases(seed) {
  const projectId = encodeURIComponent(seed.projectId);
  const datasetPath = encodeURIComponent(seed.datasetPath);
  const experimentId = encodeURIComponent(seed.experimentId);
  const evaluationReportPath = encodeURIComponent(seed.evaluationReportPath);
  const reportPath = encodeURIComponent(seed.reportPath);
  const profilePath = encodeURIComponent(seed.profilePath);
  const preprocessingPlanPath = encodeURIComponent(seed.preprocessingPlanPath);
  const handoffPath = encodeURIComponent(seed.handoffPath);
  const cleanedDatasetPath = encodeURIComponent(seed.cleanedDatasetPath);
  const plannedDatasetPath = encodeURIComponent(seed.plannedDatasetPath);

  return [
    {
      name: "analysis data panel",
      url: `/?mode=analysis&activity=explorer&rightTab=data&projectId=${projectId}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          return {
            ok: document.title === "MLAgent" &&
              modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.datasetPath}") &&
              Boolean(document.querySelector(".data-workspace, .data-preview")),
            state: { modeIndex, rightTabIndex, activeFile }
          };
        })()
      `,
    },
    {
      name: "analysis report preview",
      url: `/?mode=analysis&activity=data&rightTab=code&projectId=${projectId}&file=${reportPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activityIndex = activeIndex(".activity-bar button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const reportText = document.querySelector(".code-editor textarea")?.value ?? "";
          return {
            ok: modeIndex === 0 &&
              activityIndex === 2 &&
              rightTabIndex === 1 &&
              activeFile.includes("${seed.reportPath}") &&
              reportText.includes("# 数据分析报告") &&
              reportText.includes("${seed.datasetPath}"),
            state: { modeIndex, activityIndex, rightTabIndex, activeFile, hasReport: reportText.includes("# 数据分析报告") }
          };
        })()
      `,
    },
    {
      name: "analysis handoff preview",
      url: `/?mode=analysis&activity=data&rightTab=data&projectId=${projectId}&file=${handoffPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const previewText = document.querySelector(".json-preview")?.textContent ?? "";
          return {
            ok: modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.handoffPath}") &&
              previewText.includes("recommended_target_column") &&
              previewText.includes("churn") &&
              previewText.includes("${seed.datasetPath}"),
            state: { modeIndex, rightTabIndex, activeFile, hasHandoff: previewText.includes("recommended_target_column") }
          };
        })()
      `,
    },
    {
      name: "analysis quality profile preview",
      url: `/?mode=analysis&activity=data&rightTab=data&projectId=${projectId}&file=${profilePath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const metricText = document.querySelector(".data-quality-profile .metrics-grid")?.textContent ?? "";
          const headers = [...document.querySelectorAll(".data-quality-profile th")].map((item) => item.textContent?.trim());
          const cells = [...document.querySelectorAll(".data-quality-profile td")].map((item) => item.textContent?.trim());
          return {
            ok: modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.profilePath}") &&
              metricText.includes("Target") &&
              metricText.includes("churn") &&
              ["字段", "类型", "缺失", "唯一值", "质量标记"].every((header) => headers.includes(header)) &&
              ["age", "monthly_spend", "support_tickets", "churn"].every((cell) => cells.includes(cell)),
            state: { modeIndex, rightTabIndex, activeFile, metricText, headers, cells }
          };
        })()
      `,
    },
    {
      name: "cleaned dataset preview",
      url: `/?mode=analysis&activity=data&rightTab=data&projectId=${projectId}&file=${cleanedDatasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const headers = [...document.querySelectorAll(".data-preview th")].map((item) => item.textContent?.trim());
          return {
            ok: modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.cleanedDatasetPath}") &&
              ["age", "monthly_spend", "support_tickets", "churn"].every((header) => headers.includes(header)),
            state: { modeIndex, rightTabIndex, activeFile, headers }
          };
        })()
      `,
    },
    {
      name: "analysis preprocessing plan preview",
      url: `/?mode=analysis&activity=data&rightTab=data&projectId=${projectId}&file=${preprocessingPlanPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const previewText = document.querySelector(".preprocessing-plan-preview")?.textContent ?? "";
          return {
            ok: modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.preprocessingPlanPath}") &&
              previewText.includes("Target") &&
              previewText.includes("churn") &&
              previewText.includes("Pipeline Script") &&
              previewText.includes("Drop") &&
              previewText.includes("support_tickets") &&
              previewText.includes("Execute Plan"),
            state: { modeIndex, rightTabIndex, activeFile, previewText }
          };
        })()
      `,
      after: `
        (async () => {
          const button = [...document.querySelectorAll(".artifact-action-row button")]
            .find((item) => item.textContent?.includes("Execute Plan"));
          if (!button) return { ok: false, state: { reason: "missing execute plan button" } };
          button.click();
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const activeFile = activeFileText();
            const feedback = document.querySelector(".preprocessing-plan-preview .action-feedback")?.textContent ?? "";
            if (activeFile.includes("${seed.plannedDatasetPath}") || feedback.includes("selected for training")) {
              return { ok: true, state: { activeFile, feedback } };
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return {
            ok: false,
            state: {
              activeFile: activeFileText(),
              feedback: document.querySelector(".preprocessing-plan-preview .action-feedback")?.textContent ?? ""
            }
          };
        })()
      `,
      afterAssertion: `
        (() => {
          const activeFile = activeFileText();
          const feedback = document.querySelector(".preprocessing-plan-preview .action-feedback")?.textContent ?? "";
          return {
            ok: activeFile.includes("${seed.plannedDatasetPath}") || feedback.includes("selected for training"),
            state: { activeFile, feedback }
          };
        })()
      `,
    },
    {
      name: "analysis planned dataset preview",
      url: `/?mode=analysis&activity=data&rightTab=data&projectId=${projectId}&file=${plannedDatasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const headers = [...document.querySelectorAll(".data-preview th")].map((item) => item.textContent?.trim());
          return {
            ok: modeIndex === 0 &&
              rightTabIndex === 2 &&
              activeFile.includes("${seed.plannedDatasetPath}") &&
              headers.includes("age") &&
              headers.includes("monthly_spend") &&
              headers.includes("support_tickets") &&
              headers.includes("churn"),
            state: { modeIndex, rightTabIndex, activeFile, headers }
          };
        })()
      `,
    },
    {
      name: "machine learning training panel",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&file=${plannedDatasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activityIndex = activeIndex(".activity-bar button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          return {
            ok: document.title === "MLAgent" &&
              modeIndex === 1 &&
              activityIndex === 3 &&
              rightTabIndex === 3 &&
              activeFile.includes("${seed.plannedDatasetPath}") &&
              Boolean(document.querySelector(".training-panel")),
            state: { modeIndex, activityIndex, rightTabIndex, activeFile }
          };
        })()
      `,
    },
    {
      name: "analysis profile intent cockpit",
      url: `/?mode=analysis&activity=explorer&rightTab=data&projectId=${projectId}&sessionId=${encodeURIComponent(seed.profileIntentSessionId)}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 0 &&
              activeFile.includes("${seed.datasetPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "profile this dataset and show quality warnings";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const profileCard = document.querySelector('[data-cockpit-component="data_quality"]');
          return {
            ok: Boolean(profileCard) &&
              text.includes("Data quality profile ready") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("results/${seed.profileIntentSessionId}/data_quality_profile.json") &&
              text.includes("Profile context ready"),
            state: {
              hasProfileCard: Boolean(profileCard),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasProfilePath: text.includes("results/${seed.profileIntentSessionId}/data_quality_profile.json"),
              hasProgress: text.includes("Profile context ready")
            }
          };
        })()
      `,
    },
    {
      name: "analysis clean intent cockpit",
      url: `/?mode=analysis&activity=explorer&rightTab=data&projectId=${projectId}&sessionId=${encodeURIComponent(seed.cleanIntentSessionId)}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 0 &&
              activeFile.includes("${seed.datasetPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "clean this dataset and propose safe fixes";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const profileCard = document.querySelector('[data-cockpit-component="data_quality"]');
          const planCard = document.querySelector('[data-cockpit-component="preprocessing_plan"]');
          return {
            ok: Boolean(profileCard) &&
              Boolean(planCard) &&
              text.includes("Review quality issues") &&
              text.includes("Prepare cleaning plan") &&
              text.includes("Generate Plan") &&
              text.includes("Cleaning review ready"),
            state: {
              hasProfileCard: Boolean(profileCard),
              hasPlanCard: Boolean(planCard),
              hasQualityReview: text.includes("Review quality issues"),
              hasGeneratePlan: text.includes("Generate Plan"),
              hasProgress: text.includes("Cleaning review ready")
            }
          };
        })()
      `,
    },
    {
      name: "analysis transform intent cockpit",
      url: `/?mode=analysis&activity=explorer&rightTab=data&projectId=${projectId}&sessionId=${encodeURIComponent(seed.transformIntentSessionId)}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 0 &&
              activeFile.includes("${seed.datasetPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "transform these features with a preprocessing plan";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const planCard = document.querySelector('[data-cockpit-component="preprocessing_plan"]');
          return {
            ok: Boolean(planCard) &&
              text.includes("Review preprocessing plan") &&
              text.includes("results/${seed.transformIntentSessionId}/preprocessing_plan.json") &&
              text.includes("Approve & Execute") &&
              text.includes("Revise Plan") &&
              text.includes("Transform approval ready") &&
              !Boolean(document.querySelector('[data-cockpit-component="planned_dataset"]')) &&
              !Boolean(document.querySelector('[data-cockpit-component="training_config"]')),
            state: {
              hasPlanCard: Boolean(planCard),
              hasPlanPath: text.includes("results/${seed.transformIntentSessionId}/preprocessing_plan.json"),
              hasApprove: text.includes("Approve & Execute"),
              hasRevise: text.includes("Revise Plan"),
              hasProgress: text.includes("Transform approval ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning iterate intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.iterateIntentSessionId)}&file=${evaluationReportPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          const focusedRow = document.querySelector(".graph-focused-row");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.evaluationReportPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton) &&
              Boolean(focusedRow),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton), hasFocusedRow: Boolean(focusedRow) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "iterate on this model and improve recall with a safer retrain plan";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const iterationCard = document.querySelector('[data-cockpit-component="iteration_proposal"]');
          return {
            ok: Boolean(iterationCard) &&
              text.includes("Iteration proposal") &&
              text.includes("${seed.experimentId}") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("Open Metrics") &&
              text.includes("Open Training") &&
              text.includes("Iteration proposal ready") &&
              !Boolean(document.querySelector('[data-cockpit-component="training_config"]')),
            state: {
              hasIterationCard: Boolean(iterationCard),
              hasExperiment: text.includes("${seed.experimentId}"),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasMetricsAction: text.includes("Open Metrics"),
              hasTrainingAction: text.includes("Open Training"),
              hasProgress: text.includes("Iteration proposal ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning train intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.trainIntentSessionId)}&file=${preprocessingPlanPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector('.composer button[aria-label="发送消息"]');
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.preprocessingPlanPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector('.composer button[aria-label="发送消息"]');
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "start sklearn training from this plan";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const trainingCard = document.querySelector('[data-cockpit-component="training_config"]');
          return {
            ok: Boolean(trainingCard) &&
              text.includes("Training configuration") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("churn") &&
              text.includes("${seed.preprocessingPlanPath}") &&
              text.includes("Start sklearn") &&
              text.includes("Training configuration ready"),
            state: {
              hasTrainingCard: Boolean(trainingCard),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasTarget: text.includes("churn"),
              hasPlan: text.includes("${seed.preprocessingPlanPath}"),
              hasStart: text.includes("Start sklearn"),
              hasProgress: text.includes("Training configuration ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning ambiguous dataset train selection cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.ambiguousDatasetSessionId)}&file=${encodeURIComponent(seed.ambiguousDatasetActiveFilePath)}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.ambiguousDatasetActiveFilePath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "train a sklearn model";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const selectionCard = document.querySelector('[data-cockpit-component="dataset_selection"]');
          const trainingCard = document.querySelector('[data-cockpit-component="training_config"]');
          const candidateButton = [...document.querySelectorAll('[data-cockpit-component="dataset_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.datasetPath}"));
          return {
            ok: Boolean(selectionCard) &&
              Boolean(candidateButton) &&
              !Boolean(trainingCard) &&
              text.includes("Select training dataset") &&
              text.includes("Missing") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("Waiting for dataset selection"),
            state: {
              hasSelectionCard: Boolean(selectionCard),
              hasCandidateButton: Boolean(candidateButton),
              hasPrematureTrainingCard: Boolean(trainingCard),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasProgress: text.includes("Waiting for dataset selection")
            }
          };
        })()
      `,
      afterSelection: `
        (() => {
          const button = [...document.querySelectorAll('[data-cockpit-component="dataset_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.datasetPath}"));
          if (!button) return { ok: false, state: { reason: "missing selected dataset button" } };
          button.click();
          return { ok: true, state: { clicked: "${seed.datasetPath}" } };
        })()
      `,
      afterSelectionAssertion: `
        (() => {
          const text = document.body.innerText;
          const trainingCard = document.querySelector('[data-cockpit-component="training_config"]');
          return {
            ok: Boolean(trainingCard) &&
              text.includes("Training configuration") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("churn") &&
              text.includes("Start sklearn") &&
              text.includes("Training configuration ready"),
            state: {
              hasTrainingCard: Boolean(trainingCard),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasTarget: text.includes("churn"),
              hasStart: text.includes("Start sklearn"),
              hasProgress: text.includes("Training configuration ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning evaluate intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.evaluateIntentSessionId)}&file=${evaluationReportPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          const focusedRow = document.querySelector(".graph-focused-row");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.evaluationReportPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton) &&
              Boolean(focusedRow),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton), hasFocusedRow: Boolean(focusedRow) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "evaluate this model and show the report";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const comparisonCard = document.querySelector('[data-cockpit-component="model_comparison"]');
          const reportCard = document.querySelector('[data-cockpit-component="evaluation_report"]');
          return {
            ok: Boolean(comparisonCard) &&
              Boolean(reportCard) &&
              text.includes("Model comparison") &&
              text.includes("Evaluation report ready") &&
              text.includes("${seed.experimentId}") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("${seed.evaluationReportPath}") &&
              text.includes("Regenerate Report") &&
              text.includes("Evaluation context ready"),
            state: {
              hasComparisonCard: Boolean(comparisonCard),
              hasReportCard: Boolean(reportCard),
              hasExperiment: text.includes("${seed.experimentId}"),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasReport: text.includes("${seed.evaluationReportPath}"),
              hasRegenerate: text.includes("Regenerate Report"),
              hasProgress: text.includes("Evaluation context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning ambiguous run selection cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.ambiguousRunSessionId)}&file=${encodeURIComponent(seed.ambiguousActiveFilePath)}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.ambiguousActiveFilePath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "evaluate this model and show the report";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const selectionCard = document.querySelector('[data-cockpit-component="experiment_run_selection"]');
          const comparisonCard = document.querySelector('[data-cockpit-component="model_comparison"]');
          const candidateButton = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          return {
            ok: Boolean(selectionCard) &&
              Boolean(candidateButton) &&
              !Boolean(comparisonCard) &&
              text.includes("Select experiment run") &&
              text.includes("Missing") &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousBaselineExperimentId}") &&
              text.includes("Waiting for experiment run selection"),
            state: {
              hasSelectionCard: Boolean(selectionCard),
              hasCandidateButton: Boolean(candidateButton),
              hasPrematureComparison: Boolean(comparisonCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasBaselineRun: text.includes("${seed.ambiguousBaselineExperimentId}"),
              hasProgress: text.includes("Waiting for experiment run selection")
            }
          };
        })()
      `,
      afterSelection: `
        (() => {
          const button = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          if (!button) return { ok: false, state: { reason: "missing selected run button" } };
          button.click();
          return { ok: true, state: { clicked: "${seed.ambiguousSelectedExperimentId}" } };
        })()
      `,
      afterSelectionAssertion: `
        (() => {
          const text = document.body.innerText;
          const comparisonCard = document.querySelector('[data-cockpit-component="model_comparison"]');
          const reportCard = document.querySelector('[data-cockpit-component="evaluation_report"]');
          return {
            ok: Boolean(comparisonCard) &&
              Boolean(reportCard) &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousSelectedDatasetPath}") &&
              text.includes("${seed.ambiguousEvaluationReportPath}") &&
              text.includes("Regenerate Report") &&
              text.includes("Evaluation context ready"),
            state: {
              hasComparisonCard: Boolean(comparisonCard),
              hasReportCard: Boolean(reportCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasDataset: text.includes("${seed.ambiguousSelectedDatasetPath}"),
              hasReport: text.includes("${seed.ambiguousEvaluationReportPath}"),
              hasProgress: text.includes("Evaluation context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning ambiguous diagnose run selection cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.ambiguousDiagnoseSessionId)}&file=${encodeURIComponent(seed.ambiguousActiveFilePath)}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.ambiguousActiveFilePath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "diagnose why recall is poor and show prediction samples";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const selectionCard = document.querySelector('[data-cockpit-component="experiment_run_selection"]');
          const errorCard = document.querySelector('[data-cockpit-component="error_analysis"]');
          const samplesCard = document.querySelector('[data-cockpit-component="prediction_samples"]');
          const candidateButton = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          return {
            ok: Boolean(selectionCard) &&
              Boolean(candidateButton) &&
              !Boolean(errorCard) &&
              !Boolean(samplesCard) &&
              text.includes("Select experiment run") &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousBaselineExperimentId}") &&
              text.includes("Waiting for experiment run selection"),
            state: {
              hasSelectionCard: Boolean(selectionCard),
              hasCandidateButton: Boolean(candidateButton),
              hasPrematureErrorCard: Boolean(errorCard),
              hasPrematureSamplesCard: Boolean(samplesCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasBaselineRun: text.includes("${seed.ambiguousBaselineExperimentId}"),
              hasProgress: text.includes("Waiting for experiment run selection")
            }
          };
        })()
      `,
      afterSelection: `
        (() => {
          const button = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          if (!button) return { ok: false, state: { reason: "missing selected run button" } };
          button.click();
          return { ok: true, state: { clicked: "${seed.ambiguousSelectedExperimentId}" } };
        })()
      `,
      afterSelectionAssertion: `
        (() => {
          const text = document.body.innerText;
          const errorCard = document.querySelector('[data-cockpit-component="error_analysis"]');
          const samplesCard = document.querySelector('[data-cockpit-component="prediction_samples"]');
          return {
            ok: Boolean(errorCard) &&
              Boolean(samplesCard) &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousSelectedDatasetPath}") &&
              text.includes("${seed.ambiguousPredictionSamplesPath}") &&
              text.includes("Diagnosis context ready"),
            state: {
              hasErrorCard: Boolean(errorCard),
              hasSamplesCard: Boolean(samplesCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasDataset: text.includes("${seed.ambiguousSelectedDatasetPath}"),
              hasSamples: text.includes("${seed.ambiguousPredictionSamplesPath}"),
              hasProgress: text.includes("Diagnosis context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning ambiguous export run selection cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.ambiguousExportSessionId)}&file=${encodeURIComponent(seed.ambiguousActiveFilePath)}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.ambiguousActiveFilePath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "export the final report and handoff bundle";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const selectionCard = document.querySelector('[data-cockpit-component="experiment_run_selection"]');
          const reportCard = document.querySelector('[data-cockpit-component="evaluation_report"]');
          const exportCard = document.querySelector('[data-cockpit-component="export_bundle"]');
          const candidateButton = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          return {
            ok: Boolean(selectionCard) &&
              Boolean(candidateButton) &&
              !Boolean(reportCard) &&
              !Boolean(exportCard) &&
              text.includes("Select experiment run") &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousBaselineExperimentId}") &&
              text.includes("Waiting for experiment run selection"),
            state: {
              hasSelectionCard: Boolean(selectionCard),
              hasCandidateButton: Boolean(candidateButton),
              hasPrematureReportCard: Boolean(reportCard),
              hasPrematureExportCard: Boolean(exportCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasBaselineRun: text.includes("${seed.ambiguousBaselineExperimentId}"),
              hasProgress: text.includes("Waiting for experiment run selection")
            }
          };
        })()
      `,
      afterSelection: `
        (() => {
          const button = [...document.querySelectorAll('[data-cockpit-component="experiment_run_selection"] button')]
            .find((item) => item.textContent?.includes("Use ${seed.ambiguousSelectedExperimentId}"));
          if (!button) return { ok: false, state: { reason: "missing selected run button" } };
          button.click();
          return { ok: true, state: { clicked: "${seed.ambiguousSelectedExperimentId}" } };
        })()
      `,
      afterSelectionAssertion: `
        (() => {
          const text = document.body.innerText;
          const reportCard = document.querySelector('[data-cockpit-component="evaluation_report"]');
          const exportCard = document.querySelector('[data-cockpit-component="export_bundle"]');
          return {
            ok: Boolean(reportCard) &&
              Boolean(exportCard) &&
              text.includes("${seed.ambiguousSelectedExperimentId}") &&
              text.includes("${seed.ambiguousSelectedDatasetPath}") &&
              text.includes("${seed.ambiguousEvaluationReportPath}") &&
              text.includes("Export context ready"),
            state: {
              hasReportCard: Boolean(reportCard),
              hasExportCard: Boolean(exportCard),
              hasSelectedRun: text.includes("${seed.ambiguousSelectedExperimentId}"),
              hasDataset: text.includes("${seed.ambiguousSelectedDatasetPath}"),
              hasReport: text.includes("${seed.ambiguousEvaluationReportPath}"),
              hasProgress: text.includes("Export context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning diagnose intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.diagnoseIntentSessionId)}&file=${evaluationReportPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          const focusedRow = document.querySelector(".graph-focused-row");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.evaluationReportPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton) &&
              Boolean(focusedRow),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton), hasFocusedRow: Boolean(focusedRow) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "diagnose why recall is poor and show prediction samples";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const errorCard = document.querySelector('[data-cockpit-component="error_analysis"]');
          const samplesCard = document.querySelector('[data-cockpit-component="prediction_samples"]');
          return {
            ok: Boolean(errorCard) &&
              Boolean(samplesCard) &&
              text.includes("Error analysis") &&
              text.includes("Prediction samples") &&
              text.includes("${seed.experimentId}") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("${seed.predictionSamplesPath}") &&
              text.includes("yes -> no") &&
              text.includes("Open Samples") &&
              text.includes("Diagnosis context ready"),
            state: {
              hasErrorCard: Boolean(errorCard),
              hasSamplesCard: Boolean(samplesCard),
              hasExperiment: text.includes("${seed.experimentId}"),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasSamples: text.includes("${seed.predictionSamplesPath}"),
              hasConfusion: text.includes("yes -> no"),
              hasOpenSamples: text.includes("Open Samples"),
              hasProgress: text.includes("Diagnosis context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning export intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.exportIntentSessionId)}&file=${evaluationReportPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          const focusedRow = document.querySelector(".graph-focused-row");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.evaluationReportPath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton) &&
              Boolean(focusedRow),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton), hasFocusedRow: Boolean(focusedRow) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "export the final report and handoff bundle";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const exportCard = document.querySelector('[data-cockpit-component="export_bundle"]');
          const checklistCard = document.querySelector('[data-cockpit-component="evaluation_report"]');
          return {
            ok: Boolean(exportCard) &&
              Boolean(checklistCard) &&
              text.includes("Prepare export bundle") &&
              text.includes("Handoff artifact checklist") &&
              text.includes("${seed.experimentId}") &&
              text.includes("${seed.datasetPath}") &&
              text.includes("${seed.evaluationReportPath}") &&
              text.includes("Export Bundle") &&
              text.includes("Export context ready"),
            state: {
              hasExportCard: Boolean(exportCard),
              hasChecklistCard: Boolean(checklistCard),
              hasExperiment: text.includes("${seed.experimentId}"),
              hasDataset: text.includes("${seed.datasetPath}"),
              hasReport: text.includes("${seed.evaluationReportPath}"),
              hasExportAction: text.includes("Export Bundle"),
              hasProgress: text.includes("Export context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning learn intent cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.learnIntentSessionId)}&file=${encodeURIComponent(seed.learnEvidencePath)}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activeFile = activeFileText();
          const connected = document.body.innerText.includes("WebSocket Connected");
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          return {
            ok: modeIndex === 1 &&
              activeFile.includes("${seed.learnEvidencePath}") &&
              connected &&
              Boolean(input) &&
              Boolean(sendButton),
            state: { modeIndex, activeFile, connected, hasInput: Boolean(input), hasSend: Boolean(sendButton) }
          };
        })()
      `,
      after: `
        (() => {
          const input = document.querySelector(".composer textarea");
          const sendButton = document.querySelector(".composer button[aria-label]");
          if (!input || !sendButton) return { ok: false, state: { reason: "missing composer" } };
          input.value = "extract lessons and propose learned rules";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          sendButton.click();
          return { ok: true, state: { submitted: input.value } };
        })()
      `,
      afterAssertion: `
        (() => {
          const text = document.body.innerText;
          const lessonCard = document.querySelector('[data-cockpit-component="lesson_review"]');
          return {
            ok: Boolean(lessonCard) &&
              text.includes("Learned-rule review") &&
              text.includes("${seed.learnIntentSessionId}") &&
              text.includes("Candidates") &&
              text.includes("Extract Lessons") &&
              text.includes("Open Evidence") &&
              text.includes("Learning context ready"),
            state: {
              hasLessonCard: Boolean(lessonCard),
              hasSession: text.includes("${seed.learnIntentSessionId}"),
              hasCandidates: text.includes("Candidates"),
              hasExtract: text.includes("Extract Lessons"),
              hasEvidence: text.includes("Open Evidence"),
              hasProgress: text.includes("Learning context ready")
            }
          };
        })()
      `,
    },
    {
      name: "machine learning experiment focus",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&file=${datasetPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const focusedRow = document.querySelector(".graph-focused-row");
          const focusNote = document.querySelector(".experiment-focus-note")?.textContent?.trim() ?? "";
          const experimentDetail = document.querySelector(".experiment-detail")?.textContent ?? "";
          const candidateRows = document.querySelectorAll(".candidate-run-table tbody tr").length;
          const candidateText = document.querySelector(".candidate-run-table")?.textContent ?? "";
          const explanationRows = document.querySelectorAll(".explanation-table tbody tr").length;
          const coefficientRows = document.querySelectorAll(".coefficient-table tbody tr").length;
          const errorSliceRows = document.querySelectorAll(".error-slice-table tbody tr").length;
          const errorSliceText = document.querySelector(".error-slice-table")?.textContent ?? "";
          const predictionSampleRows = document.querySelectorAll(".prediction-sample-table tbody tr").length;
          const predictionSampleText = document.querySelector(".prediction-sample-table")?.textContent ?? "";
          const diagnosticText = document.querySelector(".diagnostic-summary")?.textContent ?? "";
          const sampleControls = document.querySelector(".prediction-sample-table .table-controls")?.textContent ?? "";
          const explanationText = document.querySelector(".experiment-detail")?.textContent ?? "";
          return {
            ok: Boolean(focusedRow) &&
              focusNote.length > 0 &&
              experimentDetail.includes("${seed.experimentId}") &&
              candidateRows > 0 &&
              candidateText.includes("Accuracy") &&
              candidateText.includes("F1") &&
              explanationRows > 0 &&
              coefficientRows > 0 &&
              errorSliceRows > 0 &&
              errorSliceText.includes("Error Rate") &&
              errorSliceText.includes("Main Confusion") &&
              errorSliceText.includes("yes") &&
              errorSliceText.includes("no") &&
              diagnosticText.includes("Worst class") &&
              diagnosticText.includes("Main confusion") &&
              diagnosticText.includes("Error rows") &&
              predictionSampleRows > 0 &&
              predictionSampleText.includes("Prediction Samples") &&
              predictionSampleText.includes("Error") &&
              predictionSampleText.includes("monthly_spend") &&
              sampleControls.includes("Errors only") &&
              sampleControls.includes("Any actual") &&
              sampleControls.includes("Any predicted") &&
              explanationText.includes("Permutation Importance") &&
              explanationText.includes("Linear Coefficients") &&
              explanationText.includes("Evaluation Report") &&
              explanationText.includes("Regenerate Report") &&
              explanationText.includes("Prediction Samples") &&
              explanationText.includes("${seed.predictionSamplesPath}") &&
              explanationText.includes("${seed.evaluationReportPath}") &&
              explanationText.includes("Preprocessing Plan") &&
              explanationText.includes("${seed.preprocessingPlanPath}"),
            state: {
              focusNote,
              hasFocusedRow: Boolean(focusedRow),
              detailIncludesExperiment: experimentDetail.includes("${seed.experimentId}"),
              candidateRows,
              explanationRows,
              coefficientRows,
              errorSliceRows,
              errorSliceText,
              diagnosticText,
              sampleControls,
              predictionSampleRows,
              predictionSampleText,
              hasEvaluationReport: explanationText.includes("${seed.evaluationReportPath}"),
              hasRegenerateReport: explanationText.includes("Regenerate Report"),
              hasPredictionSamples: explanationText.includes("${seed.predictionSamplesPath}"),
              hasPreprocessingPlan: explanationText.includes("${seed.preprocessingPlanPath}"),
              openButtons: document.querySelectorAll(".artifact-path-button").length
            }
          };
        })()
      `,
      after: `
        (() => {
          const button = document.querySelector('[data-artifact-path="${seed.preprocessingPlanPath}"]');
          if (!button) return { ok: false, state: { reason: "missing preprocessing plan open button" } };
          button.click();
          return { ok: true, state: { clickedPath: "${seed.preprocessingPlanPath}" } };
        })()
      `,
      afterAssertion: `
        (() => {
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const previewText = document.querySelector(".preprocessing-plan-preview")?.textContent ?? "";
          return {
            ok: rightTabIndex === 2 &&
              activeFile.includes("${seed.preprocessingPlanPath}") &&
              previewText.includes("Target") &&
              previewText.includes("support_tickets"),
            state: { rightTabIndex, activeFile, previewText }
          };
        })()
      `,
    },
    {
      name: "machine learning export retry cockpit",
      url: `/?mode=machine-learning&activity=experiments&rightTab=training&projectId=${projectId}&sessionId=${encodeURIComponent(seed.exportRetrySessionId)}&file=${datasetPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const text = document.body.innerText;
          const inspector = document.querySelector('[data-cockpit-component="task_state_inspector"]');
          const experimentDetail = document.querySelector(".experiment-detail")?.textContent ?? "";
          return {
            ok: Boolean(inspector) &&
              text.includes("Export failure inspector") &&
              text.includes("Retry Export") &&
              text.includes("Open Report") &&
              text.includes("Repair") &&
              text.includes("Resume") &&
              text.includes("Abandon State") &&
              text.includes("missing_report.md") &&
              experimentDetail.includes("Export Bundle") &&
              experimentDetail.includes("Regenerate Report"),
            state: {
              hasInspector: Boolean(inspector),
              hasRetryExport: text.includes("Retry Export"),
              hasOpenReport: text.includes("Open Report"),
              hasRepair: text.includes("Repair"),
              hasResume: text.includes("Resume"),
              hasAbandonState: text.includes("Abandon State"),
              hasMissingReport: text.includes("missing_report.md"),
              hasExportBundle: experimentDetail.includes("Export Bundle"),
            }
          };
        })()
      `,
    },
    {
      name: "evolution learn extraction action",
      url: `/?mode=evolution&activity=knowledge&evolutionTab=rules&projectId=${projectId}&sessionId=${encodeURIComponent(seed.learnRetrySessionId)}&file=${datasetPath}`,
      assertion: `
        (() => {
          const text = document.body.innerText;
          const modeIndex = activeIndex(".mode-tabs button");
          return {
            ok: modeIndex === 2 &&
              text.includes("Extract Lessons") &&
              text.includes("Learn failure inspector") &&
              text.includes("Retry Learning") &&
              text.includes("Repair") &&
              text.includes("Resume") &&
              text.includes("Abandon State") &&
              text.includes("Review Queue") === false &&
              Boolean(document.querySelector(".lesson-list")),
            state: {
              modeIndex,
              hasExtractLessons: text.includes("Extract Lessons"),
              hasRetryLearning: text.includes("Retry Learning"),
              hasRepair: text.includes("Repair"),
              hasResume: text.includes("Resume"),
              hasAbandonState: text.includes("Abandon State"),
              hasLearnInspector: text.includes("Learn failure inspector"),
              hasLessonList: Boolean(document.querySelector(".lesson-list")),
            }
          };
        })()
      `,
    },
    {
      name: "machine learning evaluation report preview",
      url: `/?mode=machine-learning&activity=experiments&rightTab=code&projectId=${projectId}&file=${evaluationReportPath}&experimentId=${experimentId}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const rightTabIndex = activeIndex(".right-tabs button");
          const activeFile = activeFileText();
          const reportText = document.querySelector(".code-editor textarea")?.value ?? "";
          return {
            ok: modeIndex === 1 &&
              rightTabIndex === 1 &&
              activeFile.includes("${seed.evaluationReportPath}") &&
              reportText.includes("# Model Evaluation Report") &&
              reportText.includes("${seed.experimentId}") &&
              reportText.includes("Permutation Importance"),
            state: {
              modeIndex,
              rightTabIndex,
              activeFile,
              hasReportTitle: reportText.includes("# Model Evaluation Report"),
              hasExperimentId: reportText.includes("${seed.experimentId}")
            }
          };
        })()
      `,
    },
    {
      name: "knowledge activity summary",
      url: `/?mode=evolution&activity=knowledge&rightTab=logs&projectId=${projectId}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activityIndex = activeIndex(".activity-bar button");
          const rows = [...document.querySelectorAll(".activity-detail-row")].map((row) => row.textContent ?? "");
          const hasHighConfidence = rows.some((row) => row.includes("高置信规则") && !row.trim().endsWith("0"));
          const hasInjectionAudit = rows.some((row) => row.includes("注入审计") && !row.trim().endsWith("0"));
          const stableHighConfidence = hasHighConfidence || rows.some((row) => row.includes("高置信规则") && !row.trim().endsWith("0"));
          const stableInjectionAudit = hasInjectionAudit || rows.some((row) => row.includes("注入审计") && !row.trim().endsWith("0"));
          return {
            ok: modeIndex === 2 && activityIndex === 5 && stableHighConfidence && stableInjectionAudit,
            state: { modeIndex, activityIndex, rows, hasHighConfidence: stableHighConfidence, hasInjectionAudit: stableInjectionAudit }
          };
        })()
      `,
    },
    {
      name: "evolution logs panel",
      url: `/?mode=evolution&activity=knowledge&rightTab=logs&projectId=${projectId}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const activityIndex = activeIndex(".activity-bar button");
          const rightTabIndex = activeIndex(".right-tabs button");
          return {
            ok: document.title === "MLAgent" &&
              modeIndex === 2 &&
              activityIndex === 5 &&
              rightTabIndex === 4 &&
              Boolean(document.querySelector(".log-panel")),
            state: { modeIndex, activityIndex, rightTabIndex }
          };
        })()
      `,
    },
    {
      name: "evolution rules and injection audit",
      url: `/?mode=evolution&activity=knowledge&rightTab=logs&projectId=${projectId}&file=${datasetPath}`,
      assertion: `
        (() => {
          const adoptedLesson = [...document.querySelectorAll(".lesson-card-header span")].some((item) => item.textContent?.includes("已采纳"));
          const injectionText = [...document.querySelectorAll(".injection-log-card")].map((card) => card.textContent ?? "").join("\\n");
          return {
            ok: adoptedLesson &&
              injectionText.includes("${smokeFollowUpSessionId}") &&
              injectionText.includes("${seed.lessonId}"),
            state: { adoptedLesson, hasFollowUpLog: injectionText.includes("${smokeFollowUpSessionId}"), hasLessonLog: injectionText.includes("${seed.lessonId}") }
          };
        })()
      `,
    },
    {
      name: "evolution graph tab",
      url: `/?mode=evolution&activity=knowledge&evolutionTab=graph&rightTab=logs&projectId=${projectId}&file=${datasetPath}`,
      assertion: `
        (() => {
          const modeIndex = activeIndex(".mode-tabs button");
          const graphTabIndex = activeIndex(".view-tabs button");
          const hasGraphSurface = Boolean(document.querySelector(".graph-view-wrapper"));
          const hasGraphContent = Boolean(document.querySelector(".graph-container, .graph-empty-state"));
          const hasEvidence = Boolean(document.querySelector(".graph-evidence-panel, .graph-detail-sidebar"));
          const hasSurpriseInsight = Boolean(document.querySelector(".insight-card.surprise_connection"));
          return {
            ok: document.title === "MLAgent" &&
              modeIndex === 2 &&
              graphTabIndex === 1 &&
              hasGraphSurface &&
              hasGraphContent &&
              hasEvidence &&
              hasSurpriseInsight,
            state: { modeIndex, graphTabIndex, hasGraphSurface, hasGraphContent, hasEvidence, hasSurpriseInsight }
          };
        })()
      `,
    },
  ];
}

function inferApiBaseUrl(frontendUrl) {
  const url = new URL(frontendUrl);
  url.port = process.env.SMOKE_API_PORT ?? "8000";
  return url.origin;
}

function smokeCsv() {
  return [
    "age,monthly_spend,support_tickets,churn",
    "22,49,1,no",
    "25,52,0,no",
    "29,58,1,no",
    "31,61,0,no",
    "34,66,2,no",
    "38,72,1,no",
    "42,81,2,yes",
    "46,88,3,yes",
    "51,96,4,yes",
    "57,105,5,yes",
    "63,118,5,yes",
    "68,124,6,yes",
  ].join("\n");
}

async function seedSmokeProject() {
  await waitForApi();
  const projects = await apiJson("/api/projects");
  let project = projects.find((item) => item.name === smokeProjectName);
  if (!project) {
    project = await apiJson("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: smokeProjectName }),
    });
  }

  await upsertSmokeDataset(project.id);
  const analysisArtifacts = await seedAnalysisArtifacts(project.id);
  const runsPayload = await apiJson(`/api/projects/${project.id}/ml/runs`);
  const existingRun = [...runsPayload.items]
    .reverse()
    .find((run) => run.dataset_path === smokeDatasetPath && run.target_column === "churn" && run.status === "completed");
  if (!existingRun) {
    await apiJson(`/api/projects/${project.id}/ml/train-baseline`, {
      method: "POST",
      body: JSON.stringify({
        dataset_path: smokeDatasetPath,
        target_column: "churn",
        session_id: smokeSessionId,
      }),
    });
  }
  const explanationExperimentId = await seedSklearnExplanationRun(project.id, analysisArtifacts.preprocessingPlanPath);
  const ambiguousRunArtifacts = await seedAmbiguousRunSelectionFixture(project.id, analysisArtifacts.preprocessingPlanPath);
  const lessonId = await seedEvolutionKnowledge(project.id, explanationExperimentId);
  await seedExportAndLearnRetryState(project.id, analysisArtifacts.preprocessingPlanPath);
  await setSessionId(project.id, "analysis", "Smoke profile intent", smokeProfileIntentSessionId);
  await setSessionId(project.id, "analysis", "Smoke clean intent", smokeCleanIntentSessionId);
  await setSessionId(project.id, "analysis", "Smoke transform intent", smokeTransformIntentSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke iterate intent", smokeIterateIntentSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke train intent", smokeTrainIntentSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke ambiguous dataset selection", smokeAmbiguousDatasetSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke evaluate intent", smokeEvaluateIntentSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke ambiguous run selection", smokeAmbiguousRunSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke ambiguous diagnose run selection", smokeAmbiguousDiagnoseSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke ambiguous export run selection", smokeAmbiguousExportSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke diagnose intent", smokeDiagnoseIntentSessionId);
  await setSessionId(project.id, "machine-learning", "Smoke export intent", smokeExportIntentSessionId);
  await seedLearnIntentEvidence(project.id);

  return {
    ...analysisArtifacts,
    datasetPath: smokeDatasetPath,
    evaluationReportPath: `results/${smokeSessionId}/smoke_sklearn_evaluation_report.md`,
    predictionSamplesPath: `results/${smokeSessionId}/prediction_samples.json`,
    experimentId: explanationExperimentId,
    profileIntentSessionId: smokeProfileIntentSessionId,
    cleanIntentSessionId: smokeCleanIntentSessionId,
    transformIntentSessionId: smokeTransformIntentSessionId,
    iterateIntentSessionId: smokeIterateIntentSessionId,
    trainIntentSessionId: smokeTrainIntentSessionId,
    ambiguousDatasetSessionId: smokeAmbiguousDatasetSessionId,
    ambiguousDatasetActiveFilePath: "notes/ambiguous-dataset-selection.md",
    evaluateIntentSessionId: smokeEvaluateIntentSessionId,
    ambiguousRunSessionId: smokeAmbiguousRunSessionId,
    ambiguousDiagnoseSessionId: smokeAmbiguousDiagnoseSessionId,
    ambiguousExportSessionId: smokeAmbiguousExportSessionId,
    ...ambiguousRunArtifacts,
    diagnoseIntentSessionId: smokeDiagnoseIntentSessionId,
    exportIntentSessionId: smokeExportIntentSessionId,
    learnIntentSessionId: smokeLearnIntentSessionId,
    learnEvidencePath: `results/${smokeLearnIntentSessionId}/missing.json`,
    exportRetrySessionId: smokeExportRetrySessionId,
    learnRetrySessionId: smokeLearnRetrySessionId,
    lessonId,
    projectId: project.id,
  };
}

async function seedSklearnExplanationRun(projectId, preprocessingPlanPath) {
  const createdAt = "2026-05-24T09:00:00.000000+00:00";
  const metricsArtifactPath = `${smokeSessionId}/smoke_sklearn_explanation_metrics.json`;
  const metricsProjectPath = `results/${metricsArtifactPath}`;
  const evaluationReportProjectPath = `results/${smokeSessionId}/smoke_sklearn_evaluation_report.md`;
  const predictionSamplesProjectPath = `results/${smokeSessionId}/prediction_samples.json`;
  const modelProjectPath = "models/smoke_sklearn_explanation_model.json";
  const metrics = {
    accuracy: 0.9167,
    f1_weighted: 0.916,
    row_count: 12,
    train_row_count: 8,
    eval_row_count: 4,
    class_count: 2,
    holdout_strategy: "stratified_holdout",
    class_distribution: { no: 6, yes: 6 },
    eval_class_distribution: { no: 2, yes: 2 },
    per_class: {
      no: { precision: 1, recall: 0.9, f1: 0.9474, support: 2 },
      yes: { precision: 0.9, recall: 1, f1: 0.9474, support: 2 },
    },
    confusion_matrix: {
      no: { no: 2, yes: 0 },
      yes: { no: 1, yes: 1 },
    },
  };
  const model = {
    algorithm: "logistic_regression",
    feature_count: 3,
    permutation_importance: [
      { feature: "monthly_spend", mean_importance: 0.25, std_importance: 0.05 },
      { feature: "support_tickets", mean_importance: 0.12, std_importance: 0.03 },
      { feature: "age", mean_importance: 0.08, std_importance: 0.02 },
    ],
    linear_coefficients: [
      { feature: "monthly_spend", coefficient: 1.82, abs_coefficient: 1.82 },
      { feature: "support_tickets", coefficient: 0.74, abs_coefficient: 0.74 },
      { feature: "age", coefficient: 0.31, abs_coefficient: 0.31 },
    ],
  };
  const candidateRuns = [
    {
      model_name: "logistic_regression",
      model,
      metrics,
    },
    {
      model_name: "random_forest",
      model: {
        algorithm: "random_forest",
        feature_count: 3,
        feature_importance: [
          { feature: "monthly_spend", importance: 0.61 },
          { feature: "support_tickets", importance: 0.27 },
          { feature: "age", importance: 0.12 },
        ],
        permutation_importance: [
          { feature: "monthly_spend", mean_importance: 0.2, std_importance: 0.04 },
          { feature: "support_tickets", mean_importance: 0.1, std_importance: 0.02 },
        ],
      },
      metrics: { ...metrics, accuracy: 0.875, f1_weighted: 0.872 },
    },
  ];
  const predictionSamples = {
    experiment_id: smokeExplanationExperimentId,
    dataset_path: smokeDatasetPath,
    target_column: "churn",
    engine: "sklearn",
    sample_source: "stratified_holdout",
    samples: [
      {
        row_index: 7,
        actual: "yes",
        predicted: "no",
        is_error: true,
        features: { age: 50, monthly_spend: 98, support_tickets: 5 },
      },
      {
        row_index: 2,
        actual: "no",
        predicted: "no",
        is_error: false,
        features: { age: 29, monthly_spend: 41, support_tickets: 1 },
      },
      {
        row_index: 10,
        actual: "yes",
        predicted: "yes",
        is_error: false,
        features: { age: 48, monthly_spend: 104, support_tickets: 4 },
      },
    ],
  };
  const record = {
    experiment_id: smokeExplanationExperimentId,
    project_id: projectId,
    status: "completed",
    engine: "sklearn",
    dataset_path: smokeDatasetPath,
    target_column: "churn",
    use_gpu: false,
    best_model_name: "logistic_regression",
    metrics,
    model,
    candidate_runs: candidateRuns,
    model_artifact: {
      type: "model",
      name: "smoke_sklearn_explanation_model.json",
      path: modelProjectPath,
    },
    metrics_artifact: {
      id: "smoke-sklearn-explanation-metrics",
      type: "training",
      name: "smoke_sklearn_explanation_metrics.json",
      path: metricsProjectPath,
      created_at: createdAt,
    },
    evaluation_report_artifact: {
      id: "smoke-sklearn-evaluation-report",
      type: "report",
      name: "smoke_sklearn_evaluation_report.md",
      path: evaluationReportProjectPath,
      created_at: createdAt,
      metadata: {
        project_id: projectId,
        session_id: smokeSessionId,
        experiment_id: smokeExplanationExperimentId,
        dataset_path: smokeDatasetPath,
        metrics_path: metricsProjectPath,
        model_path: modelProjectPath,
        prediction_samples_path: predictionSamplesProjectPath,
        preprocessing_plan_path: preprocessingPlanPath,
      },
    },
    prediction_samples_artifact: {
      id: "smoke-sklearn-prediction-samples",
      type: "dataframe",
      name: "prediction_samples.json",
      path: predictionSamplesProjectPath,
      created_at: createdAt,
      metadata: {
        project_id: projectId,
        session_id: smokeSessionId,
        experiment_id: smokeExplanationExperimentId,
        role: "prediction_samples",
      },
    },
    preprocessing_plan_artifact: {
      id: "smoke-sklearn-preprocessing-plan",
      type: "dataframe",
      name: "preprocessing_plan.json",
      path: preprocessingPlanPath,
      created_at: createdAt,
      metadata: {
        project_id: projectId,
        session_id: smokeAnalysisSessionId,
        dataset_path: smokeDatasetPath,
        target_column: "churn",
        role: "preprocessing_plan",
      },
    },
    preprocessing_plan: {
      drop_columns: [],
      numeric_features: ["age", "monthly_spend", "support_tickets"],
      categorical_features: [],
    },
    created_at: createdAt,
  };
  const metricsPayload = {
    experiment_id: smokeExplanationExperimentId,
    dataset_path: smokeDatasetPath,
    use_gpu: false,
    engine: "sklearn",
    task_type: "classification",
    target_column: "churn",
    feature_columns: ["age", "monthly_spend", "support_tickets"],
    model_name: "logistic_regression",
    model,
    metrics,
    runs: candidateRuns,
    preprocessing_plan_path: preprocessingPlanPath,
    prediction_samples: predictionSamples.samples,
    preprocessing_plan: record.preprocessing_plan,
  };

  await upsertProjectFile(projectId, modelProjectPath, JSON.stringify({ model, experiment_id: smokeExplanationExperimentId }, null, 2));
  await upsertProjectFile(projectId, metricsProjectPath, JSON.stringify(metricsPayload, null, 2));
  await upsertProjectFile(projectId, predictionSamplesProjectPath, JSON.stringify(predictionSamples, null, 2));
  await upsertProjectFile(
    projectId,
    evaluationReportProjectPath,
    [
      "# Model Evaluation Report",
      "",
      "## Experiment",
      "",
      `Experiment ID: ${smokeExplanationExperimentId}`,
      `Dataset: ${smokeDatasetPath}`,
      "Best model: logistic_regression",
      "",
      "## Candidate Model Comparison",
      "",
      "| Model | Accuracy | F1 weighted |",
      "| --- | --- | --- |",
      "| logistic_regression | 91.67% | 91.60% |",
      "| random_forest | 87.50% | 87.20% |",
      "",
      "## Per-Class Quality",
      "",
      "| Class | Precision | Recall | F1 | Support |",
      "| --- | --- | --- | --- | --- |",
      "| no | 100.00% | 90.00% | 94.74% | 2 |",
      "| yes | 90.00% | 100.00% | 94.74% | 2 |",
      "",
      "## Confusion Matrix",
      "",
      "| True \\\\ Pred | no | yes |",
      "| --- | --- | --- |",
      "| no | 2 | 0 |",
      "| yes | 0 | 2 |",
      "",
      "## Prediction Samples",
      "",
      `Prediction samples: ${predictionSamplesProjectPath}`,
      "",
      "## Permutation Importance",
      "",
      "| Feature | Mean | Std |",
      "| --- | --- | --- |",
      "| monthly_spend | 0.25 | 0.05 |",
      "| support_tickets | 0.12 | 0.03 |",
      "| age | 0.08 | 0.02 |",
      "",
      "## Linear Coefficients",
      "",
      "| Feature | Coefficient | Abs |",
      "| --- | --- | --- |",
      "| monthly_spend | 1.82 | 1.82 |",
      "| support_tickets | 0.74 | 0.74 |",
      "| age | 0.31 | 0.31 |",
      "",
      "## Artifacts",
      "",
      `Preprocessing plan: ${preprocessingPlanPath}`,
      "",
    ].join("\n"),
  );
  await upsertProjectFile(
    projectId,
    `experiments/runs/${smokeExplanationExperimentId}.json`,
    JSON.stringify(record, null, 2),
  );

  return smokeExplanationExperimentId;
}

async function seedAmbiguousRunSelectionFixture(projectId, preprocessingPlanPath) {
  const activeFilePath = "notes/ambiguous-run-selection.md";
  const selectedDatasetPath = "data/smoke_ambiguous_b.csv";
  const baselineDatasetPath = "data/smoke_ambiguous_a.csv";
  const selectedMetricsPath = "results/smoke-ambiguous/selected_metrics.json";
  const baselineMetricsPath = "results/smoke-ambiguous/baseline_metrics.json";
  const selectedModelPath = "models/smoke_ambiguous_sklearn.json";
  const baselineModelPath = "models/smoke_ambiguous_baseline.json";
  const selectedReportPath = "results/smoke-ambiguous/selected_evaluation_report.md";
  const baselineReportPath = "results/smoke-ambiguous/baseline_evaluation_report.md";
  const selectedSamplesPath = "results/smoke-ambiguous/selected_prediction_samples.json";
  const baselineSamplesPath = "results/smoke-ambiguous/baseline_prediction_samples.json";
  const selectedCreatedAt = "2026-06-06T23:59:00.000000+00:00";
  const baselineCreatedAt = "2026-06-06T23:58:00.000000+00:00";
  const commonMetrics = {
    accuracy: 0.9,
    f1_weighted: 0.89,
    confusion_matrix: {
      no: { no: 3, yes: 0 },
      yes: { no: 1, yes: 2 },
    },
  };
  const selectedRecord = {
    experiment_id: smokeAmbiguousSklearnExperimentId,
    project_id: projectId,
    status: "completed",
    engine: "sklearn",
    dataset_path: selectedDatasetPath,
    target_column: "churn",
    use_gpu: false,
    best_model_name: "logistic_regression",
    metrics: commonMetrics,
    model: { algorithm: "logistic_regression" },
    candidate_runs: [],
    model_artifact: {
      type: "model",
      name: "smoke_ambiguous_sklearn.json",
      path: selectedModelPath,
    },
    metrics_artifact: {
      id: "smoke-ambiguous-selected-metrics",
      type: "training",
      name: "selected_metrics.json",
      path: selectedMetricsPath,
      created_at: selectedCreatedAt,
    },
    evaluation_report_artifact: {
      id: "smoke-ambiguous-selected-report",
      type: "report",
      name: "selected_evaluation_report.md",
      path: selectedReportPath,
      created_at: selectedCreatedAt,
    },
    prediction_samples_artifact: {
      id: "smoke-ambiguous-selected-samples",
      type: "dataframe",
      name: "selected_prediction_samples.json",
      path: selectedSamplesPath,
      created_at: selectedCreatedAt,
    },
    preprocessing_plan_artifact: {
      id: "smoke-ambiguous-preprocessing-plan",
      type: "dataframe",
      name: "preprocessing_plan.json",
      path: preprocessingPlanPath,
      created_at: selectedCreatedAt,
    },
    created_at: selectedCreatedAt,
  };
  const baselineRecord = {
    experiment_id: smokeAmbiguousBaselineExperimentId,
    project_id: projectId,
    status: "completed",
    engine: "baseline",
    dataset_path: baselineDatasetPath,
    target_column: "churn",
    use_gpu: false,
    best_model_name: "majority_class",
    metrics: { accuracy: 0.75, f1_weighted: 0.72 },
    model: { strategy: "majority_class" },
    candidate_runs: [],
    model_artifact: {
      type: "model",
      name: "smoke_ambiguous_baseline.json",
      path: baselineModelPath,
    },
    metrics_artifact: {
      id: "smoke-ambiguous-baseline-metrics",
      type: "training",
      name: "baseline_metrics.json",
      path: baselineMetricsPath,
      created_at: baselineCreatedAt,
    },
    evaluation_report_artifact: {
      id: "smoke-ambiguous-baseline-report",
      type: "report",
      name: "baseline_evaluation_report.md",
      path: baselineReportPath,
      created_at: baselineCreatedAt,
    },
    prediction_samples_artifact: {
      id: "smoke-ambiguous-baseline-samples",
      type: "dataframe",
      name: "baseline_prediction_samples.json",
      path: baselineSamplesPath,
      created_at: baselineCreatedAt,
    },
    created_at: baselineCreatedAt,
  };

  await upsertProjectFile(projectId, activeFilePath, "Use this neutral note to trigger ambiguous experiment selection.");
  await upsertProjectFile(projectId, selectedDatasetPath, smokeCsv());
  await upsertProjectFile(projectId, baselineDatasetPath, smokeCsv());
  await upsertProjectFile(projectId, selectedModelPath, JSON.stringify({ model: selectedRecord.model }, null, 2));
  await upsertProjectFile(projectId, baselineModelPath, JSON.stringify({ model: baselineRecord.model }, null, 2));
  await upsertProjectFile(projectId, selectedMetricsPath, JSON.stringify({ experiment_id: smokeAmbiguousSklearnExperimentId, metrics: commonMetrics }, null, 2));
  await upsertProjectFile(projectId, baselineMetricsPath, JSON.stringify({ experiment_id: smokeAmbiguousBaselineExperimentId, metrics: baselineRecord.metrics }, null, 2));
  await upsertProjectFile(
    projectId,
    selectedReportPath,
    [
      "# Model Evaluation Report",
      "",
      `Experiment ID: ${smokeAmbiguousSklearnExperimentId}`,
      `Dataset: ${selectedDatasetPath}`,
      "Best model: logistic_regression",
      "",
      `Prediction samples: ${selectedSamplesPath}`,
    ].join("\n"),
  );
  await upsertProjectFile(
    projectId,
    baselineReportPath,
    [
      "# Model Evaluation Report",
      "",
      `Experiment ID: ${smokeAmbiguousBaselineExperimentId}`,
      `Dataset: ${baselineDatasetPath}`,
      "Best model: majority_class",
      "",
      `Prediction samples: ${baselineSamplesPath}`,
    ].join("\n"),
  );
  await upsertProjectFile(
    projectId,
    selectedSamplesPath,
    JSON.stringify({ experiment_id: smokeAmbiguousSklearnExperimentId, samples: [] }, null, 2),
  );
  await upsertProjectFile(
    projectId,
    baselineSamplesPath,
    JSON.stringify({ experiment_id: smokeAmbiguousBaselineExperimentId, samples: [] }, null, 2),
  );
  await upsertProjectFile(
    projectId,
    `experiments/runs/${smokeAmbiguousSklearnExperimentId}.json`,
    JSON.stringify(selectedRecord, null, 2),
  );
  await upsertProjectFile(
    projectId,
    `experiments/runs/${smokeAmbiguousBaselineExperimentId}.json`,
    JSON.stringify(baselineRecord, null, 2),
  );

  return {
    ambiguousActiveFilePath: activeFilePath,
    ambiguousSelectedExperimentId: smokeAmbiguousSklearnExperimentId,
    ambiguousBaselineExperimentId: smokeAmbiguousBaselineExperimentId,
    ambiguousSelectedDatasetPath: selectedDatasetPath,
    ambiguousEvaluationReportPath: selectedReportPath,
    ambiguousPredictionSamplesPath: selectedSamplesPath,
  };
}

async function seedExportAndLearnRetryState(projectId, preprocessingPlanPath) {
  await apiJson(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    body: JSON.stringify({
      mode: "machine-learning",
      title: "Smoke export retry",
    }),
  });
  await setSessionId(projectId, "machine-learning", "Smoke export retry", smokeExportRetrySessionId);
  await upsertProjectFile(
    projectId,
    `sessions/${smokeExportRetrySessionId}/task_state/export.json`,
    JSON.stringify(
      {
        status: "failed",
        stage: "export",
        session_id: smokeExportRetrySessionId,
        project_id: projectId,
        experiment_id: smokeExplanationExperimentId,
        dataset_path: smokeDatasetPath,
        target_column: "churn",
        engine: "sklearn",
        metrics_path: `results/${smokeSessionId}/smoke_sklearn_explanation_metrics.json`,
        model_path: "models/smoke_sklearn_explanation_model.json",
        report_path: `results/${smokeSessionId}/missing_report.md`,
        preprocessing_plan_path: preprocessingPlanPath,
        retry_count: 1,
        last_error: "Evaluation Report Artifact not found",
        repair_hint: "Restore model, metrics, and report artifacts or regenerate evaluation before exporting.",
        stale_check: "Confirm the model, metrics, and report files still exist before creating the handoff bundle.",
        resume_action: "Retry the saved model handoff bundle export.",
        regenerate_action: "Regenerate the evaluation report or rerun training before exporting.",
        abandon_action: "Clear the saved export retry state and keep existing run artifacts unchanged.",
        stale_artifact_paths: [
          `results/${smokeSessionId}/smoke_sklearn_explanation_metrics.json`,
          "models/smoke_sklearn_explanation_model.json",
          `results/${smokeSessionId}/missing_report.md`,
        ],
        created_at: "2026-06-01T00:00:00.000000+00:00",
        updated_at: "2026-06-01T00:00:00.000000+00:00",
      },
      null,
      2,
    ),
  );

  await apiJson(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    body: JSON.stringify({
      mode: "evolution",
      title: "Smoke learn retry",
    }),
  });
  await setSessionId(projectId, "evolution", "Smoke learn retry", smokeLearnRetrySessionId);
  await upsertProjectFile(
    projectId,
    `sessions/${smokeLearnRetrySessionId}/task_state/learn.json`,
    JSON.stringify(
      {
        status: "failed",
        stage: "learn",
        session_id: smokeLearnRetrySessionId,
        project_id: projectId,
        source_type: "session",
        source_id: smokeLearnRetrySessionId,
        retry_count: 1,
        last_error: "Session not found for lesson extraction",
        repair_hint: "Restore the source session and its evidence events before extracting learned rules.",
        stale_check: "Confirm the source session still exists and its evidence/log events are readable.",
        resume_action: "Retry learned-rule extraction from the saved source session.",
        regenerate_action: "Rerun the source analysis or training workflow to recreate stronger learning evidence.",
        abandon_action: "Clear the saved learning retry state and keep existing lessons unchanged.",
        stale_artifact_paths: [],
        created_at: "2026-06-01T00:00:00.000000+00:00",
        updated_at: "2026-06-01T00:00:00.000000+00:00",
      },
      null,
      2,
    ),
  );
}

async function seedLearnIntentEvidence(projectId) {
  const evidencePath = `results/${smokeLearnIntentSessionId}/missing.json`;
  await setSessionId(projectId, "machine-learning", "Smoke learn intent", smokeLearnIntentSessionId);
  await upsertProjectFile(
    projectId,
    evidencePath,
    JSON.stringify({ columns: { monthly_spend: { missing_ratio: 1 / 12 } } }, null, 2),
  );
  const payload = {
    type: "artifact_created",
    trace_id: "smoke-learn-intent-trace",
    artifact: {
      id: "smoke-learn-intent-missing",
      project_id: projectId,
      session_id: smokeLearnIntentSessionId,
      type: "dataframe",
      name: "missing.json",
      path: evidencePath,
      metadata: {
        dataset_path: smokeDatasetPath,
        missing_summary: { monthly_spend: 1 / 12 },
      },
      created_at: new Date().toISOString(),
    },
  };
  const eventEnvelope = {
    id: "smoke-learn-intent-event",
    session_id: smokeLearnIntentSessionId,
    type: "artifact_created",
    payload,
    created_at: new Date().toISOString(),
  };
  await upsertProjectFile(projectId, `sessions/${smokeLearnIntentSessionId}/events.jsonl`, `${JSON.stringify(eventEnvelope)}\n`);
  await upsertProjectFile(projectId, `logs/${smokeLearnIntentSessionId}.jsonl`, `${JSON.stringify(eventEnvelope)}\n`);
}

async function seedAnalysisArtifacts(projectId) {
  const profile = await apiJson(`/api/projects/${projectId}/analysis/profile`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      session_id: smokeAnalysisSessionId,
    }),
  });
  const report = await apiJson(`/api/projects/${projectId}/analysis/report`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      session_id: smokeAnalysisSessionId,
    }),
  });
  const handoff = await apiJson(`/api/projects/${projectId}/analysis/handoff-to-ml`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      session_id: smokeAnalysisSessionId,
    }),
  });
  const preprocessing = await apiJson(`/api/projects/${projectId}/analysis/preprocess-plan`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      session_id: smokeAnalysisSessionId,
    }),
  });
  const cleaned = await apiJson(`/api/projects/${projectId}/analysis/clean`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      session_id: smokeAnalysisSessionId,
    }),
  });
  const executed = await apiJson(`/api/projects/${projectId}/analysis/execute-preprocess-plan`, {
    method: "POST",
    body: JSON.stringify({
      dataset_path: smokeDatasetPath,
      preprocessing_plan_path: preprocessing.plan_artifact.path,
      session_id: smokeAnalysisSessionId,
    }),
  });

  return {
    cleanedDatasetPath: cleaned.cleaned_data_artifact.path,
    handoffPath: handoff.artifact.path,
    plannedDatasetPath: executed.transformed_data_artifact.path,
    preprocessingPlanPath: preprocessing.plan_artifact.path,
    profilePath: profile.artifact.path,
    reportPath: report.artifact.path,
  };
}

async function seedEvolutionKnowledge(projectId, experimentId) {
  const lessonsPayload = await apiJson(`/api/projects/${projectId}/evolution/lessons`);
  let lesson = lessonsPayload.items.find((item) => item.evidence?.smoke_fixture === smokeLessonMarker);
  if (!lesson) {
    lesson = await apiJson(`/api/projects/${projectId}/evolution/lessons/extract`, {
      method: "POST",
      body: JSON.stringify({
        source_type: "analysis_session",
        source_id: smokeAnalysisSessionId,
        domain: ["missing-value", "age"],
        title: "Smoke golden path age rule",
        observation: "age 字段在 churn 数据集中是稳定的数值特征，少量缺失值需要保守填充后再进入模型。",
        recommendation: "处理 churn 数据集时，先检查 age 缺失率；低缺失率用中位数填充并保留该特征进入 baseline 对照。",
        confidence: 0.92,
        conditions: {
          task_modes: ["analysis"],
          feature_type: "numeric",
          missing_ratio_range: [0, 0.1],
        },
        expected_benefit: { workflow: "analysis-to-ml", risk: "reduce missing-value drift" },
        evidence: {
          column: "age",
          dataset_path: smokeDatasetPath,
          experiment_id: experimentId,
          smoke_fixture: smokeLessonMarker,
        },
      }),
    });
  }

  if (lesson.status !== "high_confidence") {
    lesson = await apiJson(`/api/projects/${projectId}/evolution/lessons/${lesson.id}/adopt`, { method: "POST" });
  }

  await apiJson(`/api/projects/${projectId}/evolution/rules/match`, {
    method: "POST",
    body: JSON.stringify({
      session_id: smokeFollowUpSessionId,
      context: {
        mode: "analysis",
        feature_type: "numeric",
        missing_ratio: 1 / 12,
        tags: ["missing-value"],
      },
    }),
  });

  return lesson.id;
}

async function upsertSmokeDataset(projectId) {
  await upsertProjectFile(projectId, smokeDatasetPath, smokeCsv());
  await upsertProjectFile(
    projectId,
    "notes/ambiguous-dataset-selection.md",
    "Neutral note used to force an explicit training dataset selection.",
  );
}

async function setSessionId(projectId, mode, title, sessionId) {
  const sessionsPayload = await apiJson(`/api/projects/${projectId}/sessions`);
  const sessions = sessionsPayload.items.filter((session) => session.id !== sessionId);
  const existing = sessions.find((session) => session.mode === mode && session.title === title);
  const record = existing
    ? { ...existing, id: sessionId }
    : {
        id: sessionId,
        project_id: projectId,
        mode,
        title,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
      };
  await upsertProjectFile(
    projectId,
    "sessions/index.json",
    JSON.stringify({ sessions: [record, ...sessions.filter((session) => session.id !== existing?.id)] }, null, 2),
  );
}

async function upsertProjectFile(projectId, filePath, content) {
  const payload = { path: filePath, type: "file", content };
  const createResponse = await fetch(`${apiBaseUrl}/api/projects/${projectId}/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (createResponse.ok) return;
  if (createResponse.status !== 409) {
    throw new Error(`POST /files/create failed HTTP ${createResponse.status}: ${await createResponse.text()}`);
  }
  await apiJson(`/api/projects/${projectId}/files/content`, {
    method: "PUT",
    body: JSON.stringify({ path: filePath, content }),
  });
}

async function waitForApi() {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/projects`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`API is not reachable at ${apiBaseUrl}: ${lastError?.message ?? "timeout"}`);
}

async function apiJson(pathname, options = {}) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} failed HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function findBrowserExecutable() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function waitForFrontend() {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`Frontend is not reachable at ${baseUrl}: ${lastError?.message ?? "timeout"}`);
}

async function launchBrowser() {
  if (!browserPath) {
    throw new Error("Could not find Chrome or Edge. Set BROWSER_PATH to a Chromium executable.");
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), "mlagent-smoke-"));
  const browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port] = (await readFile(portFile, "utf-8")).split(/\r?\n/);
      return {
        browser,
        endpoint: `http://127.0.0.1:${port}`,
        cleanup: async () => {
          browser.kill();
          await waitForProcessExit(browser);
          await rm(userDataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
        },
      };
    }
    await delay(100);
  }

  browser.kill();
  await waitForProcessExit(browser);
  await rm(userDataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  throw new Error("Timed out waiting for browser debugging endpoint.");
}

async function createPage(endpoint) {
  const targetUrl = `${endpoint}/json/new?${encodeURIComponent("about:blank")}`;
  let response = await fetch(targetUrl, { method: "PUT" });
  if (!response.ok) response = await fetch(targetUrl);
  if (!response.ok) throw new Error(`Could not create browser target: HTTP ${response.status}`);
  const target = await response.json();
  return new CdpPage(target.webSocketDebuggerUrl);
}

class CdpPage {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id) return;
      const waiter = this.pending.get(payload.id);
      if (!waiter) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        waiter.reject(new Error(payload.error.message));
      } else {
        waiter.resolve(payload.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(message);
    return result;
  }

  async navigate(url) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Page.navigate", { url });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForAssertion(page, smokeCase) {
  const deadline = Date.now() + timeoutMs;
  let lastState;
  while (Date.now() < deadline) {
    const result = await page.evaluate(`
      (() => {
        const activeIndex = (selector) =>
          [...document.querySelectorAll(selector)].findIndex((element) => element.classList.contains("active"));
        const activeFileText = () =>
          [...document.querySelectorAll(".status-bar span")].find((item) => item.textContent?.startsWith("Active file:"))?.textContent ?? "";
        return (${smokeCase.assertion});
      })()
    `);
    lastState = result?.state;
    if (result?.ok) return lastState;
    await delay(300);
  }
  throw new Error(`${smokeCase.name} failed. Last state: ${JSON.stringify(lastState)}`);
}

function absoluteUrl(relativeUrl) {
  return new URL(relativeUrl, baseUrl).toString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmokeStep(page, smokeCase, stepName, expression) {
  const result = await page.evaluate(`
    (() => {
      const activeIndex = (selector) =>
        [...document.querySelectorAll(selector)].findIndex((element) => element.classList.contains("active"));
      const activeFileText = () =>
        [...document.querySelectorAll(".status-bar span")].find((item) => item.textContent?.startsWith("Active file:"))?.textContent ?? "";
      return (${expression});
    })()
  `);
  if (!result?.ok) {
    throw new Error(`${smokeCase.name} ${stepName} failed. State: ${JSON.stringify(result?.state)}`);
  }
  return result.state;
}

function waitForProcessExit(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    childProcess.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  await waitForFrontend();
  const seed = await seedSmokeProject();
  const browser = await launchBrowser();
  const page = await createPage(browser.endpoint);

  try {
    for (const smokeCase of buildSmokeCases(seed)) {
      await page.navigate(absoluteUrl(smokeCase.url));
      const state = await waitForAssertion(page, smokeCase);
      console.log(`PASS ${smokeCase.name}: ${JSON.stringify(state)}`);
      if (smokeCase.after) {
        const afterState = await runSmokeStep(page, smokeCase, "after", smokeCase.after);
        console.log(`PASS ${smokeCase.name} after: ${JSON.stringify(afterState)}`);
      }
      if (smokeCase.afterAssertion) {
        const afterAssertionCase = {
          ...smokeCase,
          name: `${smokeCase.name} after assertion`,
          assertion: smokeCase.afterAssertion,
        };
        const afterAssertionState = await waitForAssertion(page, afterAssertionCase);
        console.log(`PASS ${afterAssertionCase.name}: ${JSON.stringify(afterAssertionState)}`);
      }
      if (smokeCase.afterSelection) {
        const afterSelectionState = await runSmokeStep(page, smokeCase, "afterSelection", smokeCase.afterSelection);
        console.log(`PASS ${smokeCase.name} afterSelection: ${JSON.stringify(afterSelectionState)}`);
      }
      if (smokeCase.afterSelectionAssertion) {
        const afterSelectionAssertionCase = {
          ...smokeCase,
          name: `${smokeCase.name} after selection assertion`,
          assertion: smokeCase.afterSelectionAssertion,
        };
        const afterSelectionAssertionState = await waitForAssertion(page, afterSelectionAssertionCase);
        console.log(`PASS ${afterSelectionAssertionCase.name}: ${JSON.stringify(afterSelectionAssertionState)}`);
      }
    }
  } finally {
    page.close();
    await browser.cleanup();
  }
}

main().catch((error) => {
  const message = error?.stack || error?.message || String(error);
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
});
