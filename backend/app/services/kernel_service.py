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
        try:
            process = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return KernelExecutionResult(
                status="timeout",
                stdout="",
                stderr=f"Kernel execution timed out after {timeout_seconds} seconds.",
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
        memory_limit: str | None = "2g",
        cpu_limit: str | None = "2",
        pids_limit: int | None = 512,
        workspace_mount_mode: str = "rw",
    ):
        if workspace_mount_mode not in {"rw", "ro"}:
            raise ValueError("workspace_mount_mode must be 'rw' or 'ro'")
        if pids_limit is not None and pids_limit <= 0:
            raise ValueError("pids_limit must be positive")

        self.image = image
        self.workspace_root = workspace_root.resolve() if workspace_root else None
        self.docker_executable = docker_executable
        self.use_gpu = use_gpu
        self.memory_limit = memory_limit
        self.cpu_limit = cpu_limit
        self.pids_limit = pids_limit
        self.workspace_mount_mode = workspace_mount_mode

    def execute(self, code: str, timeout_seconds: int = 60) -> KernelExecutionResult:
        command = [
            self.docker_executable,
            "run",
            "--rm",
            "--network",
            "none",
        ]
        if self.memory_limit:
            command.extend(["--memory", self.memory_limit])
        if self.cpu_limit:
            command.extend(["--cpus", self.cpu_limit])
        if self.pids_limit is not None:
            command.extend(["--pids-limit", str(self.pids_limit)])
        if self.use_gpu:
            command.extend(["--gpus", "all"])
        if self.workspace_root is not None:
            command.extend(
                [
                    "-v",
                    f"{self.workspace_root}:/workspace:{self.workspace_mount_mode}",
                    "-w",
                    "/workspace",
                ]
            )
        command.extend([self.image, "python", "-c", code])
        try:
            process = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return KernelExecutionResult(
                status="timeout",
                stdout="",
                stderr=f"Kernel execution timed out after {timeout_seconds} seconds.",
            )
        except FileNotFoundError as exc:
            return KernelExecutionResult(
                status="error",
                stdout="",
                stderr=f"Docker executable not found: {exc.filename}",
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
    memory_limit: str | None = "2g",
    cpu_limit: str | None = "2",
    pids_limit: int | None = 512,
    workspace_mount_mode: str = "rw",
) -> KernelServiceProtocol:
    if backend == "local":
        return LocalPythonKernelService()
    if backend == "jupyter":
        return DockerPythonKernelService(
            image=image,
            workspace_root=workspace_root,
            docker_executable=docker_executable,
            use_gpu=use_gpu,
            memory_limit=memory_limit,
            cpu_limit=cpu_limit,
            pids_limit=pids_limit,
            workspace_mount_mode=workspace_mount_mode,
        )
    raise ValueError(f"Unsupported kernel backend: {backend}")
