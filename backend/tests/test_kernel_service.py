from app.services.kernel_service import LocalPythonKernelService


def test_executes_python_and_returns_stdout():
    service = LocalPythonKernelService()
    result = service.execute("print('hello mlagent')")
    assert result.stdout.strip() == "hello mlagent"
    assert result.stderr == ""
    assert result.status == "ok"
