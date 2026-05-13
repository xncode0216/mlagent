import os
import shutil
from pathlib import Path

import pytest

from app.services.kernel_service import JupyterKernelService, LocalPythonKernelService, create_kernel_service


def test_executes_python_and_returns_stdout():
    service = LocalPythonKernelService()
    result = service.execute("print('hello mlagent')")
    assert result.stdout.strip() == "hello mlagent"
    assert result.stderr == ""
    assert result.status == "ok"


def test_factory_creates_local_service():
    service = create_kernel_service("local")
    assert isinstance(service, LocalPythonKernelService)


@pytest.mark.skipif(
    shutil.which("docker") is None and not os.environ.get("MLAGENT_DOCKER_EXE"),
    reason="Docker CLI is not available",
)
def test_jupyter_kernel_service_executes_in_docker(tmp_path: Path):
    docker_executable = os.environ.get("MLAGENT_DOCKER_EXE", "docker")
    service = JupyterKernelService(
        image=os.environ.get("MLAGENT_KERNEL_IMAGE", "mlagent-kernel:dev"),
        workspace_root=tmp_path,
        docker_executable=docker_executable,
    )
    result = service.execute("import pandas, sklearn, matplotlib; print('hello docker kernel')")
    assert result.status == "ok", result.stderr
    assert result.stdout.strip() == "hello docker kernel"


@pytest.mark.skipif(
    shutil.which("docker") is None and not os.environ.get("MLAGENT_DOCKER_EXE"),
    reason="Docker CLI is not available",
)
def test_jupyter_kernel_service_reads_workspace_csv(tmp_path: Path):
    docker_executable = os.environ.get("MLAGENT_DOCKER_EXE", "docker")
    (tmp_path / "data.csv").write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
    service = JupyterKernelService(
        image=os.environ.get("MLAGENT_KERNEL_IMAGE", "mlagent-kernel:dev"),
        workspace_root=tmp_path,
        docker_executable=docker_executable,
    )
    result = service.execute(
        "import pandas as pd; df = pd.read_csv('/workspace/data.csv'); print(df.shape)"
    )
    assert result.status == "ok", result.stderr
    assert result.stdout.strip() == "(2, 2)"
