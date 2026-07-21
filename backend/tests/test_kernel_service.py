import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app.services.kernel_service import (
    JupyterKernelService,
    LocalPythonKernelService,
    create_kernel_service,
)
import app.services.kernel_service as kernel_service


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


def test_executes_python_and_returns_stdout():
    service = LocalPythonKernelService()
    result = service.execute("print('hello mlagent')")
    assert result.stdout.strip() == "hello mlagent"
    assert result.stderr == ""
    assert result.status == "ok"


def test_factory_creates_local_service():
    service = create_kernel_service("local")
    assert isinstance(service, LocalPythonKernelService)


def test_local_kernel_uses_current_python_interpreter(monkeypatch):
    captured_command: list[str] = []

    def fake_run(command, **kwargs):
        captured_command.extend(command)

        class Result:
            returncode = 0
            stdout = "ok\n"
            stderr = ""

        return Result()

    monkeypatch.setattr("app.services.kernel_service.subprocess.run", fake_run)

    service = LocalPythonKernelService()
    result = service.execute("print('ok')")

    assert result.status == "ok"
    assert captured_command[:2] == [sys.executable, "-c"]


def test_local_kernel_returns_structured_timeout(monkeypatch):
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(command, timeout=2)

    monkeypatch.setattr("app.services.kernel_service.subprocess.run", fake_run)

    service = LocalPythonKernelService()
    result = service.execute("while True: pass", timeout_seconds=2)

    assert result.status == "timeout"
    assert "timed out after 2 seconds" in result.stderr


def test_factory_creates_docker_kernel_for_jupyter_backend():
    service = create_kernel_service("jupyter")
    assert hasattr(kernel_service, "DockerPythonKernelService")
    assert isinstance(service, kernel_service.DockerPythonKernelService)


def test_docker_kernel_adds_gpu_flag_when_requested(monkeypatch, tmp_path: Path):
    captured_command: list[str] = []

    def fake_run(command, **kwargs):
        captured_command.extend(command)

        class Result:
            returncode = 0
            stdout = "ok\n"
            stderr = ""

        return Result()

    monkeypatch.setattr("app.services.kernel_service.subprocess.run", fake_run)

    service = kernel_service.DockerPythonKernelService(
        image="mlagent-kernel:dev",
        workspace_root=tmp_path,
        docker_executable="docker",
        use_gpu=True,
    )
    result = service.execute("print('ok')")

    assert result.status == "ok"
    assert "--gpus" in captured_command
    assert "all" in captured_command


def test_docker_kernel_applies_resource_limits_and_readonly_workspace(monkeypatch, tmp_path: Path):
    captured_command: list[str] = []

    def fake_run(command, **kwargs):
        captured_command.extend(command)

        class Result:
            returncode = 0
            stdout = "ok\n"
            stderr = ""

        return Result()

    monkeypatch.setattr("app.services.kernel_service.subprocess.run", fake_run)

    service = kernel_service.DockerPythonKernelService(
        image="mlagent-kernel:dev",
        workspace_root=tmp_path,
        docker_executable="docker",
        memory_limit="1g",
        cpu_limit="0.5",
        pids_limit=128,
        workspace_mount_mode="ro",
    )
    result = service.execute("print('ok')")

    assert result.status == "ok"
    assert "--memory" in captured_command
    assert "1g" in captured_command
    assert "--cpus" in captured_command
    assert "0.5" in captured_command
    assert "--pids-limit" in captured_command
    assert "128" in captured_command
    assert "-v" in captured_command
    assert f"{tmp_path.resolve()}:/workspace:ro" in captured_command


def test_docker_kernel_returns_structured_timeout(monkeypatch):
    def fake_run(command, **kwargs):
        raise subprocess.TimeoutExpired(command, timeout=3)

    monkeypatch.setattr("app.services.kernel_service.subprocess.run", fake_run)

    service = kernel_service.DockerPythonKernelService(image="mlagent-kernel:dev")
    result = service.execute("while True: pass", timeout_seconds=3)

    assert result.status == "timeout"
    assert "timed out after 3 seconds" in result.stderr


def test_docker_kernel_rejects_invalid_workspace_mount_mode(tmp_path: Path):
    with pytest.raises(ValueError, match="workspace_mount_mode"):
        kernel_service.DockerPythonKernelService(
            image="mlagent-kernel:dev",
            workspace_root=tmp_path,
            workspace_mount_mode="execute",
        )


@pytest.mark.skipif(
    not is_docker_kernel_available(), reason="Docker kernel image is not available"
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
    not is_docker_kernel_available(), reason="Docker kernel image is not available"
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
