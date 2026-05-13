export type AgentStreamEvent =
  | { type: "message_delta"; message_id: string; delta: string }
  | { type: "tool_call_started"; call_id: string; tool: string; args: Record<string, unknown> }
  | {
      type: "tool_call_finished";
      call_id: string;
      status: "success" | "error";
      result_ref?: string;
      error?: string;
    }
  | { type: "kernel_output"; stream: "stdout" | "stderr"; text: string }
  | { type: "artifact_created"; artifact: Artifact }
  | { type: "task_progress"; task_id: string; progress: number; label: string }
  | { type: "error"; code: string; message: string };

export type Artifact = {
  id: string;
  project_id: string;
  session_id: string;
  type: "dataframe" | "chart" | "code" | "markdown" | "log" | "training" | "model";
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
