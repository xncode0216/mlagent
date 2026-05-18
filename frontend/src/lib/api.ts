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

export type TrainingResult = {
  experiment_id: string;
  status: "completed";
  engine: "baseline" | "sklearn";
  use_gpu: boolean;
  metrics: {
    accuracy: number;
    f1_weighted?: number;
    row_count: number;
    eval_row_count?: number;
    class_count: number;
    confusion_matrix: Record<string, Record<string, number>>;
  };
  runs: Array<{
    model_name: string;
    model: Record<string, unknown>;
    metrics: {
      accuracy: number;
      f1_weighted?: number;
      row_count: number;
      eval_row_count?: number;
      class_count: number;
      confusion_matrix: Record<string, Record<string, number>>;
    };
  }>;
  model: Record<string, unknown>;
  model_artifact: {
    type: "model";
    name: string;
    path: string;
  };
  metrics_artifact: {
    id: string;
    type: "training";
    name: string;
    path: string;
    created_at: string;
  };
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
  metrics: {
    accuracy: number;
    f1_weighted?: number;
    row_count: number;
    eval_row_count?: number;
    class_count: number;
    confusion_matrix?: Record<string, Record<string, number>>;
  };
  model: Record<string, unknown>;
  candidate_runs: Array<{
    model_name: string;
    model?: Record<string, unknown>;
    metrics: {
      accuracy: number;
      f1_weighted?: number;
      row_count?: number;
      eval_row_count?: number;
      class_count?: number;
    };
  }>;
  model_artifact: {
    type: "model";
    name: string;
    path: string;
  };
  metrics_artifact: {
    id: string;
    type: "training";
    name: string;
    path: string;
    created_at: string;
  };
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

const API_BASE_URL = "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
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

export async function listFiles(projectId: string, path = ""): Promise<FileItem[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const result = await request<{ items: FileItem[] }>(`/api/projects/${projectId}/files${query}`);
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

export async function readProjectFileContent(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return request<{ path: string; content: string }>(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
  );
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
): Promise<TrainingResult> {
  return request<TrainingResult>(`/api/projects/${projectId}/ml/train-sklearn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_path: datasetPath,
      target_column: targetColumn,
      session_id: sessionId,
      use_gpu: useGpu,
    }),
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
