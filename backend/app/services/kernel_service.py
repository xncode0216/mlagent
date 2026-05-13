import subprocess
from dataclasses import dataclass


@dataclass
class KernelExecutionResult:
    status: str
    stdout: str
    stderr: str


class LocalPythonKernelService:
    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        process = subprocess.run(
            ["python", "-c", code],
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
