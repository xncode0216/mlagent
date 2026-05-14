import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class KernelExecutionResult:
    status: str
    stdout: str
    stderr: str


class KernelServiceProtocol(Protocol):
    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        pass


class LocalPythonKernelService:
    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        process = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return KernelExecutionResult(
            status="ok" if process.returncode == 0 else "error",
            stdout=process.stdout,
            stderr=process.stderr,
        )


class DockerPythonKernelService:
    """Runs Python code inside the configured Docker kernel image.

    The service keeps the same interface as the local spike. It executes one
    isolated container per call, which is slower than a persistent kernel pool
    but gives us the correct sandbox boundary now.
    """

    def __init__(
        self,
        image: str = "mlagent-kernel:dev",
        workspace_root: Path | None = None,
        docker_executable: str = "docker",
        use_gpu: bool = False,
    ):
        self.image = image
        self.workspace_root = workspace_root.resolve() if workspace_root else None
        self.docker_executable = docker_executable
        self.use_gpu = use_gpu

    def execute(self, code: str, timeout_seconds: int = 60) -> KernelExecutionResult:
        command = [
            self.docker_executable,
            "run",
            "--rm",
            "--network",
            "none",
        ]
        if self.use_gpu:
            command.extend(["--gpus", "all"])
        if self.workspace_root is not None:
            command.extend(
                [
                    "-v",
                    f"{self.workspace_root}:/workspace",
                    "-w",
                    "/workspace",
                ]
            )
        command.extend([self.image, "python", "-c", code])
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return KernelExecutionResult(
            status="ok" if process.returncode == 0 else "error",
            stdout=process.stdout,
            stderr=process.stderr,
        )


JupyterKernelService = DockerPythonKernelService


def create_kernel_service(
    backend: str = "local",
    image: str = "mlagent-kernel:dev",
    workspace_root: Path | None = None,
    docker_executable: str = "docker",
    use_gpu: bool = False,
) -> KernelServiceProtocol:
    if backend == "local":
        return LocalPythonKernelService()
    if backend == "jupyter":
        return DockerPythonKernelService(
            image=image,
            workspace_root=workspace_root,
            docker_executable=docker_executable,
            use_gpu=use_gpu,
        )
    raise ValueError(f"Unsupported kernel backend: {backend}")
