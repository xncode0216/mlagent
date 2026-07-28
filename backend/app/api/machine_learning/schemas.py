"""训练/评估/导出接口的请求模型。"""

from pydantic import BaseModel, Field


class TrainBaselineRequest(BaseModel):
    dataset_path: str = Field(min_length=1)
    target_column: str = Field(min_length=1)
    session_id: str = "manual-training"


class TrainSklearnRequest(TrainBaselineRequest):
    use_gpu: bool = False
    preprocessing_plan_path: str | None = None


class ResumeSklearnTrainingRequest(BaseModel):
    session_id: str = "manual-training"


class EvaluationReportRequest(BaseModel):
    session_id: str = "manual-training"


class ResumeEvaluationReportRequest(BaseModel):
    session_id: str = "manual-training"


class ExportBundleRequest(BaseModel):
    session_id: str = "manual-training"


class ResumeExportBundleRequest(BaseModel):
    session_id: str = "manual-training"
