from pathlib import Path
import os
import shutil

import pytest

from app.services.kernel_service import KernelExecutionResult
from app.services.kernel_service import JupyterKernelService
from app.tools.machine_learning.train_sklearn import train_sklearn_classifier


class FakeKernelService:
    def __init__(self, result: KernelExecutionResult):
        self.result = result
        self.code = ""
        self.timeout_seconds = 0

    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        self.code = code
        self.timeout_seconds = timeout_seconds
        return self.result


def test_train_sklearn_classifier_executes_inside_kernel_and_parses_result(tmp_path: Path):
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir()
    dataset_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.3,31,no\n0.4,35,no\n"
        "0.7,44,yes\n0.8,45,yes\n0.9,50,yes\n1.0,55,yes\n",
        encoding="utf-8",
    )
    kernel = FakeKernelService(
        KernelExecutionResult(
            status="ok",
            stdout=(
                "training logs\n"
                '__MLAGENT_SKLEARN_RESULT__{"engine":"sklearn","task_type":"classification",'
                '"target_column":"churn","feature_columns":["score","age"],'
                '"model":{"algorithm":"random_forest"},"metrics":{"accuracy":1.0,'
                '"f1_weighted":1.0,"row_count":8,"class_count":2},'
                '"runs":[{"model_name":"random_forest","metrics":{"accuracy":1.0}}],'
                '"model_path":"models/sklearn_churn_model.joblib"}\n'
            ),
            stderr="",
        )
    )

    result = train_sklearn_classifier(
        workspace_root=tmp_path,
        dataset_path="data/training.csv",
        target_column="churn",
        model_output_path="models/sklearn_churn_model.joblib",
        kernel_service=kernel,
    )

    assert result["engine"] == "sklearn"
    assert result["model"]["algorithm"] == "random_forest"
    assert result["metrics"]["accuracy"] == 1.0
    assert "sklearn.ensemble" in kernel.code
    assert "data/training.csv" in kernel.code
    assert "models/sklearn_churn_model.joblib" in kernel.code
    assert kernel.timeout_seconds == 120


def test_train_sklearn_classifier_rejects_kernel_errors(tmp_path: Path):
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir()
    dataset_path.write_text("score,churn\n0.1,no\n", encoding="utf-8")
    kernel = FakeKernelService(KernelExecutionResult(status="error", stdout="", stderr="boom"))

    with pytest.raises(RuntimeError, match="boom"):
        train_sklearn_classifier(
            workspace_root=tmp_path,
            dataset_path="data/training.csv",
            target_column="churn",
            model_output_path="models/sklearn_churn_model.joblib",
            kernel_service=kernel,
        )


@pytest.mark.skipif(
    shutil.which("docker") is None and not os.environ.get("MLAGENT_DOCKER_EXE"),
    reason="Docker CLI is not available",
)
def test_train_sklearn_classifier_runs_in_docker_kernel(tmp_path: Path):
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir()
    dataset_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.3,31,no\n0.4,35,no\n"
        "0.7,44,yes\n0.8,45,yes\n0.9,50,yes\n1.0,55,yes\n",
        encoding="utf-8",
    )
    kernel = JupyterKernelService(
        image=os.environ.get("MLAGENT_KERNEL_IMAGE", "mlagent-kernel:dev"),
        workspace_root=tmp_path,
        docker_executable=os.environ.get("MLAGENT_DOCKER_EXE", "docker"),
    )

    result = train_sklearn_classifier(
        workspace_root=tmp_path,
        dataset_path="data/training.csv",
        target_column="churn",
        model_output_path="models/sklearn_churn_model.joblib",
        kernel_service=kernel,
    )

    assert result["engine"] == "sklearn"
    assert result["metrics"]["row_count"] == 8
    assert result["model_path"] == "models/sklearn_churn_model.joblib"
    assert (tmp_path / "models" / "sklearn_churn_model.joblib").exists()
