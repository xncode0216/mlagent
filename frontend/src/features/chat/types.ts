type TraceFields = {
  trace_id?: string;
};

export type AgentStreamEvent =
  | ({ type: "message_delta"; message_id: string; delta: string } & TraceFields)
  | ({
      type: "tool_call_started";
      call_id: string;
      tool: string;
      args: Record<string, unknown>;
      started_at?: string;
    } & TraceFields)
  | {
      type: "tool_call_finished";
      call_id: string;
      status: "success" | "error";
      result_ref?: string;
      error?: string;
      finished_at?: string;
      duration_ms?: number;
    } & TraceFields
  | ({ type: "kernel_output"; stream: "stdout" | "stderr"; text: string } & TraceFields)
  | ({ type: "artifact_created"; artifact: Artifact } & TraceFields)
  | ({ type: "task_progress"; task_id: string; progress: number; label: string } & TraceFields)
  | ({ type: "lesson_extracted"; lesson_id: string; confidence: number } & TraceFields)
  | ({
      type: "rules_matched";
      matched_rules: Array<{
        lesson_id: string;
        score: number;
        recommendation: string;
        reason: string;
      }>;
      prompt_snippet: string;
    } & TraceFields)
  | ({ type: "error"; code: string; message: string } & TraceFields);

export type Artifact = {
  id: string;
  project_id: string;
  session_id: string;
  type: "dataframe" | "chart" | "code" | "markdown" | "report" | "log" | "training" | "model";
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
