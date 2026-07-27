type TraceFields = {
  trace_id?: string;
};

export type WorkflowStageId =
  | "ingest"
  | "profile"
  | "clean"
  | "transform"
  | "train"
  | "evaluate"
  | "diagnose"
  | "iterate"
  | "export"
  | "learn";

export type AgentComponentKind =
  | "dataset_summary"
  | "data_quality"
  | "preprocessing_plan"
  | "planned_dataset"
  | "transformation_report"
  | "training_config"
  | "model_comparison"
  | "evaluation_report"
  | "error_analysis"
  | "prediction_samples"
  | "iteration_proposal"
  | "export_bundle"
  | "provenance_graph"
  | "lesson_review";

export type AgentCommandPayload = {
  intent: string;
  dataset_path?: string | null;
  dataset_version_id?: string | null;
  target_column?: string | null;
  selected_run_id?: string | null;
  selected_artifacts?: string[];
  missing_context?: string[];
  risk_level?: "low" | "medium" | "high" | string;
  planned_steps?: WorkflowStageId[] | string[];
  proposed_tools?: string[];
  approval_required?: boolean;
  component_requests?: string[];
  candidate_runs?: Array<Record<string, unknown>>;
  candidate_datasets?: Array<Record<string, unknown>>;
  diagnosis_summary?: Record<string, unknown>;
  bundle_ready?: boolean;
  missing_required_artifacts?: string[];
  source_session_id?: string | null;
  source_event_count?: number;
  candidate_count?: number;
  high_confidence_count?: number;
  has_extractable_candidates?: boolean;
};

export type AgentStreamEvent =
  | ({ type: "message_delta"; message_id: string; delta: string } & TraceFields)
  | ({
      type: "agent_command";
      task_id: string;
      command: AgentCommandPayload;
      resolved_context?: Record<string, unknown>;
    } & TraceFields)
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
  | ({
      type: "tool_started";
      call_id: string;
      tool: string;
      args?: Record<string, unknown>;
      task_id?: string;
      stage?: WorkflowStageId;
      started_at?: string;
    } & TraceFields)
  | ({ type: "kernel_output"; stream: "stdout" | "stderr"; text: string } & TraceFields)
  | ({ type: "artifact_created"; artifact: Artifact } & TraceFields)
  | ({ type: "task_progress"; task_id: string; progress: number; label: string } & TraceFields)
  | ({ type: "stage_started"; task_id: string; stage: WorkflowStageId; label?: string; started_at?: string } & TraceFields)
  | ({ type: "stage_completed"; task_id: string; stage: WorkflowStageId; label?: string; completed_at?: string } & TraceFields)
  | ({
      type: "approval_required";
      task_id: string;
      approval_id: string;
      stage: WorkflowStageId;
      title: string;
      description?: string;
      artifact_path?: string;
      options?: string[];
      // "local" 表示该审批由前端本地流程发起，后端没有对应的待办记录，
      // 因此批准必须在本地执行，不能发往只认识自己审批的编排器。
      origin?: "local";
    } & TraceFields)
  | ({
      type: "approval_resolved";
      task_id: string;
      approval_id: string;
      stage: WorkflowStageId;
      decision: string;
      resolved_at?: string;
    } & TraceFields)
  | ({
      type: "component_requested";
      task_id?: string;
      stage: WorkflowStageId;
      component: AgentComponentKind | string;
      title?: string;
      artifact_path?: string;
      props?: Record<string, unknown>;
    } & TraceFields)
  | ({
      type: "step_failed";
      task_id: string;
      stage?: WorkflowStageId;
      label: string;
      error: string;
      retryable?: boolean;
      resume_stage?: WorkflowStageId;
      retry_count?: number;
    } & TraceFields)
  | ({
      type: "step_completed";
      task_id: string;
      stage?: WorkflowStageId;
      label: string;
      artifact_path?: string;
    } & TraceFields)
  | ({ type: "task_resumed"; task_id: string; stage?: WorkflowStageId; label?: string; retry_count?: number } & TraceFields)
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
  type: "dataframe" | "chart" | "code" | "markdown" | "report" | "log" | "training" | "model" | "archive";
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
