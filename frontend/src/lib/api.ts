export type Project = {
  id: string;
  owner_id: string;
  name: string;
  workspace_path: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type FileItem = {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number | null;
};

export type ProjectFileContent = {
  path: string;
  content: string;
  size: number;
  mime_type: string;
};

export type FileSearchMatch = {
  path: string;
  name: string;
  match_type: "path" | "content" | string;
  line_number?: number | null;
  preview: string;
};

export type TrainingMetric = {
  accuracy: number;
  f1_weighted?: number;
  row_count?: number;
  train_row_count?: number;
  eval_row_count?: number;
  class_count?: number;
  holdout_strategy?: string;
  class_distribution?: Record<string, number>;
  eval_class_distribution?: Record<string, number>;
  per_class?: Record<string, { precision?: number; recall?: number; f1?: number; support?: number }>;
  confusion_matrix?: Record<string, Record<string, number>>;
};

export type ModelExplanation = {
  feature_importance?: Array<{ feature?: string; importance?: number }>;
  permutation_importance?: Array<{ feature?: string; mean_importance?: number; std_importance?: number }>;
  linear_coefficients?: Array<{ feature?: string; coefficient?: number; abs_coefficient?: number }>;
  explanation_warning?: string;
};

export type TrainingArtifact = {
  id?: string;
  type: "model" | "training" | "report" | "dataframe" | "code" | "archive";
  name: string;
  path: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type TrainingPreprocessingPlan = {
  drop_columns?: string[];
  numeric_features?: string[];
  categorical_features?: string[];
};

export type TrainingResult = {
  experiment_id: string;
  status: "completed";
  engine: "baseline" | "sklearn";
  use_gpu: boolean;
  metrics: TrainingMetric;
  runs: Array<{
    model_name: string;
    model: Record<string, unknown> & ModelExplanation;
    metrics: TrainingMetric;
  }>;
  model: Record<string, unknown> & ModelExplanation;
  model_artifact: TrainingArtifact & { type: "model" };
  metrics_artifact: TrainingArtifact & { id: string; type: "training"; created_at: string };
  evaluation_report_artifact?: TrainingArtifact & { id: string; type: "report"; created_at: string };
  prediction_samples_artifact?: TrainingArtifact & { id: string; type: "dataframe"; created_at: string };
  preprocessing_plan_artifact?: TrainingArtifact & { id: string; type: "dataframe"; created_at: string };
  preprocessing_plan?: TrainingPreprocessingPlan;
};

export type EvaluationReportResult = {
  experiment_id: string;
  status: "completed";
  evaluation_report_artifact: TrainingArtifact & { id: string; type: "report"; created_at: string };
  run: ExperimentRun;
};

export type ExportBundleResult = {
  experiment_id: string;
  status: "completed";
  export_bundle_artifact: TrainingArtifact & { id: string; type: "archive"; created_at: string };
  run: ExperimentRun;
};

export type ExperimentRun = {
  experiment_id: string;
  project_id: string;
  status: "completed";
  engine: "baseline" | "sklearn";
  dataset_path: string;
  target_column: string;
  use_gpu: boolean;
  best_model_name: string;
  metrics: TrainingMetric;
  model: Record<string, unknown> & ModelExplanation;
  candidate_runs: Array<{
    model_name: string;
    model?: Record<string, unknown> & ModelExplanation;
    metrics: TrainingMetric;
  }>;
  model_artifact: TrainingArtifact & { type: "model" };
  metrics_artifact: TrainingArtifact & { id: string; type: "training"; created_at: string };
  evaluation_report_artifact?: TrainingArtifact & { id: string; type: "report"; created_at: string };
  prediction_samples_artifact?: TrainingArtifact & { id: string; type: "dataframe"; created_at: string };
  preprocessing_plan_artifact?: TrainingArtifact & { id: string; type: "dataframe"; created_at: string };
  export_bundle_artifact?: TrainingArtifact & { id: string; type: "archive"; created_at: string };
  preprocessing_plan?: TrainingPreprocessingPlan;
  created_at: string;
};

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

export type EvolutionProtocol = {
  id: string;
  source_skill: string;
  name: string;
  purpose: string;
  trigger: string;
  agent_policy: string[];
  inject_into: string[];
  stability: "stable" | "experimental";
};

export type AnalysisReportResult = {
  artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "report";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
};

export type DataQualityProfileResult = {
  profile: {
    row_count: number;
    column_count: number;
    duplicate_rows: number;
    missing_cells: number;
    columns: Array<{
      name: string;
      dtype: string;
      kind: string;
      missing_count: number;
      missing_ratio: number;
      unique_count: number;
      quality_flags: string[];
      summary?: Record<string, number | null>;
      top_values?: Array<{ value: string; count: number }>;
    }>;
    target_candidates: Array<{
      column: string;
      score: number;
      dtype: string;
      unique_count: number;
      missing_ratio: number;
      reasons: string[];
    }>;
    sample: Record<string, unknown>[];
  };
  artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "dataframe";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
};

export type PreprocessingPlanResult = {
  plan: {
    dataset_path: string;
    target_column: string;
    feature_columns: string[];
    drop_columns: string[];
    drop_reasons: Record<string, string>;
    numeric_features: string[];
    categorical_features: string[];
    steps: {
      numeric: { selector: string[]; imputer: string; scaler: string };
      categorical: { selector: string[]; imputer: string; encoder: string };
      target: { column: string; mode: string };
    };
    quality_summary: {
      row_count: number;
      column_count: number;
      missing_cells: number;
      duplicate_rows: number;
    };
    sklearn_pipeline: string;
    output_dataset_path: string;
    sklearn_pipeline_script_path: string;
  };
  plan_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "dataframe";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  pipeline_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "code";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
};

export type ExecutePreprocessingPlanResult = {
  summary: {
    source_dataset_path: string;
    preprocessing_plan_path: string;
    output_dataset_path: string;
    target_column: string;
    input_shape: { rows: number; columns: number };
    output_shape: { rows: number; columns: number };
    drop_columns: string[];
    numeric_features: string[];
    categorical_features: string[];
    encoded_feature_columns: string[];
    transformations: Record<string, unknown>;
    created_at: string;
  };
  transformed_data_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "dataframe";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  summary_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "dataframe";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  report_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "report";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
};

export type CleanDatasetResult = {
  cleaned_data_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "dataframe";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  script_artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "code";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  fill_values: {
    numeric: Record<string, number>;
    categorical: Record<string, string>;
  };
};

export type MlHandoffResult = {
  mode: "machine-learning";
  dataset_path: string;
  recommended_target_column: string;
  target_candidates: Array<{
    column: string;
    score: number;
    dtype: string;
    unique_count: number;
    missing_ratio: number;
    reason: string;
  }>;
  row_count: number;
  column_count: number;
  created_at: string;
  artifact: {
    id: string;
    project_id: string;
    session_id: string;
    type: "training";
    name: string;
    path: string;
    metadata: Record<string, unknown>;
    created_at: string;
  };
};

export type EvolutionRuleMatch = {
  lesson_id: string;
  score: number;
  recommendation: string;
  reason: string;
};

export type EvolutionInjectionLog = {
  session_id: string;
  matched_rules: EvolutionRuleMatch[];
  snippet: string;
  created_at: string;
};

export type AgentSession = {
  id: string;
  project_id: string;
  mode: "analysis" | "machine-learning" | "evolution" | string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type AgentMessage = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DurableTaskState = {
  session_id?: string;
  stage?: string;
  status?: string;
  project_id?: string;
  active_file?: string;
  dataset_path?: string;
  target_column?: string;
  engine?: string;
  experiment_id?: string;
  metrics_path?: string;
  model_path?: string;
  report_path?: string;
  source_type?: string;
  source_id?: string;
  use_gpu?: boolean;
  plan_path?: string;
  preprocessing_plan_path?: string | null;
  retry_count?: number;
  last_error?: string;
  repair_hint?: string;
  stale_check?: string;
  resume_action?: string;
  regenerate_action?: string;
  abandon_action?: string;
  stale_artifact_paths?: string[];
  recovery_policy?: {
    repair_hint?: string;
    stale_check?: string;
    resume_action?: string;
    regenerate_action?: string;
    abandon_action?: string;
    stale_artifact_paths?: string[];
  };
  created_at?: string;
  updated_at?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // Keep the HTTP status text when the response body is not JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function listProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}

export async function createProject(name: string): Promise<Project> {
  return request<Project>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function openLocalProject(path: string, name?: string): Promise<Project> {
  return request<Project>("/api/projects/open-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: name || undefined }),
  });
}

export async function listFiles(projectId: string, path = ""): Promise<FileItem[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const result = await request<{ items: FileItem[] }>(`/api/projects/${projectId}/files${query}`);
  return result.items;
}

export async function searchProjectFiles(projectId: string, query: string): Promise<FileSearchMatch[]> {
  const result = await request<{ items: FileSearchMatch[] }>(
    `/api/projects/${projectId}/files/search?query=${encodeURIComponent(query)}`,
  );
  return result.items;
}

export async function uploadProjectFile(
  projectId: string,
  path: string,
  file: File | Blob,
): Promise<FileItem> {
  const body = new FormData();
  body.set("path", path);
  body.set("file", file);
  return request<FileItem>(`/api/projects/${projectId}/files/upload`, {
    method: "POST",
    body,
  });
}

export async function createProjectFile(
  projectId: string,
  path: string,
  type: "file" | "directory",
  content = "",
): Promise<FileItem> {
  return request<FileItem>(`/api/projects/${projectId}/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, type, content }),
  });
}

export async function renameProjectFile(
  projectId: string,
  path: string,
  newPath: string,
): Promise<FileItem> {
  return request<FileItem>(`/api/projects/${projectId}/files/rename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, new_path: newPath }),
  });
}

export async function deleteProjectFile(
  projectId: string,
  path: string,
): Promise<{ path: string; deleted: boolean }> {
  return request<{ path: string; deleted: boolean }>(
    `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

export function projectFileDownloadUrl(projectId: string, path: string): string {
  return `${API_BASE_URL}/api/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`;
}

export async function readProjectFileContent(
  projectId: string,
  path: string,
): Promise<ProjectFileContent> {
  return request<ProjectFileContent>(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
  );
}

export async function updateProjectFileContent(
  projectId: string,
  path: string,
  content: string,
): Promise<ProjectFileContent> {
  return request<ProjectFileContent>(`/api/projects/${projectId}/files/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function generateAnalysisReport(
  projectId: string,
  datasetPath: string,
  sessionId = "manual-analysis",
): Promise<AnalysisReportResult> {
  return request<AnalysisReportResult>(`/api/projects/${projectId}/analysis/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_path: datasetPath, session_id: sessionId }),
  });
}

export async function generateDataQualityProfile(
  projectId: string,
  datasetPath: string,
  sessionId = "manual-analysis",
): Promise<DataQualityProfileResult> {
  return request<DataQualityProfileResult>(`/api/projects/${projectId}/analysis/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_path: datasetPath, session_id: sessionId }),
  });
}

export async function generatePreprocessingPlan(
  projectId: string,
  datasetPath: string,
  sessionId = "manual-analysis",
): Promise<PreprocessingPlanResult> {
  return request<PreprocessingPlanResult>(`/api/projects/${projectId}/analysis/preprocess-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_path: datasetPath, session_id: sessionId }),
  });
}

export async function executePreprocessingPlan(
  projectId: string,
  datasetPath: string | null | undefined,
  preprocessingPlanPath: string,
  sessionId = "manual-analysis",
): Promise<ExecutePreprocessingPlanResult> {
  return request<ExecutePreprocessingPlanResult>(`/api/projects/${projectId}/analysis/execute-preprocess-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(datasetPath ? { dataset_path: datasetPath } : {}),
      preprocessing_plan_path: preprocessingPlanPath,
      session_id: sessionId,
    }),
  });
}

export async function cleanAnalysisDataset(
  projectId: string,
  datasetPath: string,
  sessionId = "manual-analysis",
): Promise<CleanDatasetResult> {
  return request<CleanDatasetResult>(`/api/projects/${projectId}/analysis/clean`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_path: datasetPath, session_id: sessionId }),
  });
}

export async function handoffDatasetToMl(
  projectId: string,
  datasetPath: string,
  sessionId = "manual-analysis",
): Promise<MlHandoffResult> {
  return request<MlHandoffResult>(`/api/projects/${projectId}/analysis/handoff-to-ml`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_path: datasetPath, session_id: sessionId }),
  });
}

export async function createAgentSession(
  projectId: string,
  payload: { mode: string; title?: string },
): Promise<AgentSession> {
  return request<AgentSession>(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listProjectSessions(projectId: string): Promise<AgentSession[]> {
  const result = await request<{ items: AgentSession[] }>(`/api/projects/${projectId}/sessions`);
  return result.items;
}

export async function listSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const result = await request<{ items: AgentMessage[] }>(`/api/sessions/${sessionId}/messages`);
  return result.items;
}

export async function listSessionEvents(sessionId: string): Promise<unknown[]> {
  const result = await request<{ items: unknown[] }>(`/api/sessions/${sessionId}/events`);
  return result.items;
}

export async function listSessionTaskStates(sessionId: string): Promise<DurableTaskState[]> {
  const result = await request<{ items: DurableTaskState[] }>(`/api/sessions/${sessionId}/task-states`);
  return result.items;
}

export async function abandonTaskState(sessionId: string, stage: string): Promise<{ deleted: boolean }> {
  return request<{ session_id: string; stage: string; deleted: boolean }>(
    `/api/sessions/${sessionId}/task-states/${encodeURIComponent(stage)}`,
    { method: "DELETE" },
  );
}

export function sessionLogDownloadUrl(sessionId: string): string {
  return `${API_BASE_URL}/api/sessions/${sessionId}/log`;
}

export async function trainBaselineModel(
  projectId: string,
  datasetPath: string,
  targetColumn: string,
  sessionId = "manual-training",
): Promise<TrainingResult> {
  return request<TrainingResult>(`/api/projects/${projectId}/ml/train-baseline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_path: datasetPath,
      target_column: targetColumn,
      session_id: sessionId,
    }),
  });
}

export async function trainSklearnModel(
  projectId: string,
  datasetPath: string,
  targetColumn: string,
  sessionId = "manual-training",
  useGpu = false,
  preprocessingPlanPath?: string | null,
): Promise<TrainingResult> {
  return request<TrainingResult>(`/api/projects/${projectId}/ml/train-sklearn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_path: datasetPath,
      target_column: targetColumn,
      session_id: sessionId,
      use_gpu: useGpu,
      ...(preprocessingPlanPath ? { preprocessing_plan_path: preprocessingPlanPath } : {}),
    }),
  });
}

export async function resumeSklearnTraining(
  projectId: string,
  sessionId = "manual-training",
): Promise<TrainingResult> {
  return request<TrainingResult>(`/api/projects/${projectId}/ml/resume-sklearn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function generateEvaluationReport(
  projectId: string,
  experimentId: string,
  sessionId = "manual-training",
): Promise<EvaluationReportResult> {
  return request<EvaluationReportResult>(`/api/projects/${projectId}/ml/runs/${experimentId}/evaluation-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function resumeEvaluationReport(
  projectId: string,
  sessionId = "manual-training",
): Promise<EvaluationReportResult> {
  return request<EvaluationReportResult>(`/api/projects/${projectId}/ml/resume-evaluation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function exportRunBundle(
  projectId: string,
  experimentId: string,
  sessionId = "manual-training",
): Promise<ExportBundleResult> {
  return request<ExportBundleResult>(`/api/projects/${projectId}/ml/runs/${experimentId}/export-bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function resumeExportBundle(
  projectId: string,
  sessionId = "manual-training",
): Promise<ExportBundleResult> {
  return request<ExportBundleResult>(`/api/projects/${projectId}/ml/resume-export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function listTrainingRuns(projectId: string): Promise<ExperimentRun[]> {
  const result = await request<{ items: ExperimentRun[] }>(`/api/projects/${projectId}/ml/runs`);
  return result.items;
}

export async function getTrainingRun(projectId: string, experimentId: string): Promise<ExperimentRun> {
  return request<ExperimentRun>(`/api/projects/${projectId}/ml/runs/${experimentId}`);
}

export async function listLessons(projectId: string): Promise<Lesson[]> {
  const result = await request<{ items: Lesson[] }>(`/api/projects/${projectId}/evolution/lessons`);
  return result.items;
}

export async function listEvolutionProtocols(projectId: string): Promise<EvolutionProtocol[]> {
  const result = await request<{ items: EvolutionProtocol[] }>(`/api/projects/${projectId}/evolution/protocols`);
  return result.items;
}

export async function listEvolutionInjectionLog(projectId: string): Promise<EvolutionInjectionLog[]> {
  const result = await request<{ items: EvolutionInjectionLog[] }>(
    `/api/projects/${projectId}/evolution/injection-log`,
  );
  return result.items;
}

export async function extractLessonsFromSession(projectId: string, sessionId: string): Promise<Lesson[]> {
  const result = await request<{ items: Lesson[] }>(`/api/projects/${projectId}/evolution/lessons/extract-from-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return result.items;
}

export async function resumeLessonExtraction(projectId: string, sessionId: string): Promise<Lesson[]> {
  const result = await request<{ items: Lesson[] }>(`/api/projects/${projectId}/evolution/lessons/resume-extraction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return result.items;
}

export async function extractLesson(
  projectId: string,
  payload: {
    source_type: string;
    source_id: string;
    domain: string[];
    observation: string;
    recommendation: string;
    confidence: number;
    evidence?: Record<string, unknown>;
    title?: string;
    conditions?: Record<string, unknown>;
    expected_benefit?: Record<string, unknown>;
  },
): Promise<Lesson> {
  return request<Lesson>(`/api/projects/${projectId}/evolution/lessons/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function adoptLesson(projectId: string, lessonId: string): Promise<Lesson> {
  return request<Lesson>(`/api/projects/${projectId}/evolution/lessons/${lessonId}/adopt`, {
    method: "POST",
  });
}

export async function rejectLesson(projectId: string, lessonId: string): Promise<Lesson> {
  return request<Lesson>(`/api/projects/${projectId}/evolution/lessons/${lessonId}/reject`, {
    method: "POST",
  });
}

export async function markLessonConflict(
  projectId: string,
  lessonId: string,
  reason: string,
): Promise<Lesson> {
  return request<Lesson>(`/api/projects/${projectId}/evolution/lessons/${lessonId}/conflict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

export type KnowledgeGraphNode = {
  id: string;
  label: string;
  type: "column" | "experiment" | "rule";
  properties: Record<string, unknown>;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: "produces" | "uses" | "triggers" | "supports";
};

export type AdvancedInsight = {
  type: "knowledge_gap" | "surprise_connection";
  title: string;
  description: string;
  meta: Record<string, unknown>;
};

export type KnowledgeGraphResult = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  insights: AdvancedInsight[];
};

export type GPUStatus = {
  status: "idle" | "busy";
  active_task: {
    task_id: string;
    project_id: string;
    started_at: string;
  } | null;
  queue: Array<{
    task_id: string;
    project_id: string;
    requested_at: string;
    position: number;
  }>;
  queue_length: number;
};

export type GPUCancelResult = {
  task_id: string;
  status: "canceled" | "not_found";
  was_active: boolean;
};

export async function getKnowledgeGraph(projectId: string): Promise<KnowledgeGraphResult> {
  return request<KnowledgeGraphResult>(`/api/projects/${projectId}/evolution/graph`);
}

export async function getGPUStatus(projectId: string): Promise<GPUStatus> {
  return request<GPUStatus>(`/api/projects/${projectId}/resources/gpu/status`);
}

export async function cancelGPUTask(projectId: string, taskId: string): Promise<GPUCancelResult> {
  return request<GPUCancelResult>(
    `/api/projects/${projectId}/resources/gpu/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST" },
  );
}
