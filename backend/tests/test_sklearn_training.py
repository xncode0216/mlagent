import io
import json
import os
import shutil
import subprocess
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from app.services.kernel_service import JupyterKernelService, KernelExecutionResult
from app.tools.machine_learning.train_sklearn import train_sklearn_classifier


def is_docker_kernel_available() -> bool:
    docker_exe = os.environ.get("MLAGENT_DOCKER_EXE", "docker")
    if not shutil.which(docker_exe):
        return False
    image = os.environ.get("MLAGENT_KERNEL_IMAGE", "mlagent-kernel:dev")
    try:
        res = subprocess.run(
            [docker_exe, "image", "inspect", image],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return res.returncode == 0
    except Exception:
        return False


class FakeKernelService:
    def __init__(self, result: KernelExecutionResult):
        self.result = result
        self.code = ""
        self.timeout_seconds = 0

    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        self.code = code
        self.timeout_seconds = timeout_seconds
        return self.result


class LocalExecKernelService:
    """真的把生成的代码跑起来，而不是当字符串收下就算数。

    `FakeKernelService` 只记录代码从不执行，于是"生成的脚本是不是合法 Python"在测试里
    完全没人管：`preprocessing_plan_path=None` 曾被 `json.dumps` 写成 JSON 的 `null`
    注入 Python 源码，**任何不带预处理计划的训练都必然 NameError**，而全部单测照样绿。
    唯一会跑真实内核的用例（`..._runs_in_docker_kernel`）需要 Docker，本机与 CI 上恒被跳过。

    脚本用相对路径读写工作区，所以执行前切到 workspace_root——真实内核也是这么挂载的。
    """

    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root
        self.code = ""

    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        self.code = code
        buffer = io.StringIO()
        previous_cwd = Path.cwd()
        try:
            os.chdir(self.workspace_root)
            with redirect_stdout(buffer):
                exec(compile(code, "<generated-training-code>", "exec"), {"__name__": "__main__"})
        except Exception as exc:  # noqa: BLE001 - 生成代码的任何失败都要如实报给调用方
            return KernelExecutionResult(status="error", stdout=buffer.getvalue(), stderr=repr(exc))
        finally:
            os.chdir(previous_cwd)
        return KernelExecutionResult(status="ok", stdout=buffer.getvalue(), stderr="")


def test_train_sklearn_classifier_executes_inside_kernel_and_parses_result(tmp_path: Path):
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir()
    dataset_path.write_text(
        "score,age,churn\n0.1,,no\n0.2,30,no\n0.3,31,no\n0.4,35,no\n"
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
                '"model":{"algorithm":"random_forest",'
                '"feature_importance":[{"feature":"score","importance":0.72}],'
                '"permutation_importance":[{"feature":"score","mean_importance":0.2,"std_importance":0.05}]},'
                '"metrics":{"accuracy":1.0,'
                '"f1_weighted":1.0,"row_count":8,"train_row_count":5,"eval_row_count":3,'
                '"class_count":2,"holdout_strategy":"stratified_holdout",'
                '"class_distribution":{"no":4,"yes":4},'
                '"eval_class_distribution":{"no":1,"yes":2},'
                '"per_class":{"no":{"precision":1.0,"recall":1.0,"f1":1.0,"support":1},'
                '"yes":{"precision":1.0,"recall":1.0,"f1":1.0,"support":2}}},'
                '"runs":[{"model_name":"random_forest","metrics":{"accuracy":1.0}}],'
                '"prediction_samples":[{"row_index":2,"actual":"no","predicted":"yes",'
                '"is_error":true,"features":{"score":0.3,"age":31}}],'
                '"model_path":"models/sklearn_churn_model.pkl"}\n'
            ),
            stderr="",
        )
    )

    result = train_sklearn_classifier(
        workspace_root=tmp_path,
        dataset_path="data/training.csv",
        target_column="churn",
        model_output_path="models/sklearn_churn_model.pkl",
        kernel_service=kernel,
    )

    assert result["engine"] == "sklearn"
    assert result["model"]["algorithm"] == "random_forest"
    assert result["metrics"]["accuracy"] == 1.0
    assert result["metrics"]["holdout_strategy"] == "stratified_holdout"
    assert result["metrics"]["per_class"]["yes"]["support"] == 2
    assert result["prediction_samples"][0]["is_error"] is True
    assert result["prediction_samples"][0]["features"]["score"] == 0.3
    assert result["model"]["permutation_importance"][0]["feature"] == "score"
    assert "import pickle" in kernel.code
    assert "joblib" not in kernel.code
    assert "fillna" in kernel.code
    assert "median" in kernel.code
    assert "sklearn.ensemble" in kernel.code
    assert "sklearn.inspection" in kernel.code
    assert "permutation_importance" in kernel.code
    assert "precision_recall_fscore_support" in kernel.code
    assert "holdout_strategy" in kernel.code
    assert "prediction_samples" in kernel.code
    assert "eval_feature_rows" in kernel.code
    assert "data/training.csv" in kernel.code
    assert "models/sklearn_churn_model.pkl" in kernel.code
    assert kernel.timeout_seconds == 120


def test_train_sklearn_classifier_can_apply_preprocessing_plan(tmp_path: Path):
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir()
    dataset_path.write_text(
        "customer_id,score,age,contract,churn\n"
        "c-1,0.1,25,month,no\n"
        "c-2,0.2,,month,no\n"
        "c-3,0.8,45,year,yes\n"
        "c-4,0.9,50,year,yes\n",
        encoding="utf-8",
    )
    plan_path = tmp_path / "results" / "plan" / "preprocessing_plan.json"
    plan_path.parent.mkdir(parents=True)
    plan_path.write_text(
        json.dumps(
            {
                "target_column": "churn",
                "drop_columns": ["customer_id"],
                "numeric_features": ["score", "age"],
                "categorical_features": ["contract"],
            }
        ),
        encoding="utf-8",
    )
    kernel = FakeKernelService(
        KernelExecutionResult(
            status="ok",
            stdout=(
                '__MLAGENT_SKLEARN_RESULT__{"engine":"sklearn","task_type":"classification",'
                '"target_column":"churn","feature_columns":["score","age","contract"],'
                '"preprocessing_plan_path":"results/plan/preprocessing_plan.json",'
                '"preprocessing_plan":{"drop_columns":["customer_id"],'
                '"numeric_features":["score","age"],"categorical_features":["contract"]},'
                '"model":{"algorithm":"logistic_regression"},'
                '"metrics":{"accuracy":1.0,"f1_weighted":1.0,"row_count":4},'
                '"runs":[{"model_name":"logistic_regression","metrics":{"accuracy":1.0}}],'
                '"model_path":"models/sklearn_churn_model.pkl"}\n'
            ),
            stderr="",
        )
    )

    result = train_sklearn_classifier(
        workspace_root=tmp_path,
        dataset_path="data/training.csv",
        target_column="churn",
        model_output_path="models/sklearn_churn_model.pkl",
        preprocessing_plan_path="results/plan/preprocessing_plan.json",
        kernel_service=kernel,
    )

    assert result["preprocessing_plan_path"] == "results/plan/preprocessing_plan.json"
    assert result["preprocessing_plan"]["drop_columns"] == ["customer_id"]
    assert "preprocessing_plan_path" in kernel.code
    assert "results/plan/preprocessing_plan.json" in kernel.code
    assert "drop_columns" in kernel.code
    assert "numeric_features" in kernel.code
    assert "categorical_features" in kernel.code


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
            model_output_path="models/sklearn_churn_model.pkl",
            kernel_service=kernel,
        )


def _write_training_dataset(tmp_path: Path) -> None:
    dataset_path = tmp_path / "data" / "training.csv"
    dataset_path.parent.mkdir(parents=True, exist_ok=True)
    dataset_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.3,31,no\n0.4,35,no\n"
        "0.7,44,yes\n0.8,45,yes\n0.9,50,yes\n1.0,55,yes\n",
        encoding="utf-8",
    )


@pytest.mark.parametrize("with_plan", [False, True], ids=["无预处理计划", "有预处理计划"])
def test_generated_training_code_actually_runs(tmp_path: Path, with_plan: bool):
    """生成的脚本必须能真的跑起来——两种分支都要跑。

    `preprocessing_plan_path` 可空，两个分支产出的字面量不同（`None` 与带引号的路径），
    只测其中一个等于没测。此前恰恰是可空的那支坏掉的。
    """
    _write_training_dataset(tmp_path)
    plan_path: str | None = None
    if with_plan:
        plan_file = tmp_path / "results" / "plan" / "preprocessing_plan.json"
        plan_file.parent.mkdir(parents=True, exist_ok=True)
        plan_file.write_text(
            json.dumps(
                {
                    "drop_columns": [],
                    "numeric_features": ["score", "age"],
                    "categorical_features": [],
                    "target_column": "churn",
                }
            ),
            encoding="utf-8",
        )
        plan_path = "results/plan/preprocessing_plan.json"

    kernel = LocalExecKernelService(tmp_path)
    result = train_sklearn_classifier(
        workspace_root=tmp_path,
        dataset_path="data/training.csv",
        target_column="churn",
        model_output_path="models/sklearn_churn_model.pkl",
        preprocessing_plan_path=plan_path,
        kernel_service=kernel,
    )

    assert result["engine"] == "sklearn"
    assert result["target_column"] == "churn"
    assert result["metrics"]["row_count"] == 8
    # 没有计划时结果里不带这个键，而不是带一个 None
    assert result.get("preprocessing_plan_path") == plan_path
    assert (tmp_path / "models" / "sklearn_churn_model.pkl").exists()


def test_generated_training_code_reports_a_missing_target_column(tmp_path: Path):
    """目标列不在数据集里时，报错必须说的是目标列。

    此前这条路径先撞上 `null` 的 NameError，用户看到的是 `name 'null' is not defined`,
    与真实原因毫不相干。
    """
    _write_training_dataset(tmp_path)
    kernel = LocalExecKernelService(tmp_path)

    with pytest.raises(RuntimeError, match="Target column was not found"):
        train_sklearn_classifier(
            workspace_root=tmp_path,
            dataset_path="data/training.csv",
            target_column="not_a_column",
            model_output_path="models/sklearn_churn_model.pkl",
            kernel_service=kernel,
        )


@pytest.mark.skipif(
    not is_docker_kernel_available(), reason="Docker kernel image is not available"
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
        model_output_path="models/sklearn_churn_model.pkl",
        kernel_service=kernel,
    )

    assert result["engine"] == "sklearn"
    assert result["metrics"]["row_count"] == 8
    assert result["model_path"] == "models/sklearn_churn_model.pkl"
    assert (tmp_path / "models" / "sklearn_churn_model.pkl").exists()
