import type { PredictionSample } from "./trainingDiagnostics";

export type TrainingEngine = "baseline" | "sklearn";

export type PanelActionFeedback = {
  kind: "info" | "success" | "warning" | "error";
  message: string;
};

export type PredictionSamplesPreview = {
  experiment_id?: string;
  sample_source?: string;
  samples?: PredictionSample[];
};

export type PreprocessingPlanPreviewValue = {
  target_column?: string;
  feature_columns?: string[];
  drop_columns?: string[];
  numeric_features?: string[];
  categorical_features?: string[];
  output_dataset_path?: string;
  sklearn_pipeline_script_path?: string;
  steps?: {
    numeric?: { imputer?: string; scaler?: string };
    categorical?: { imputer?: string; encoder?: string };
  };
  quality_summary?: { missing_cells?: number };
};
