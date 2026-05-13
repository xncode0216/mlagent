export type Project = {
  id: string;
  owner_id: string;
  name: string;
  workspace_path: string;
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
  metrics: {
    accuracy: number;
    row_count: number;
    class_count: number;
    confusion_matrix: Record<string, Record<string, number>>;
  };
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
