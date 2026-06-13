from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.observability import REQUEST_ID_HEADER, install_observability
from app.main import app


def test_response_carries_request_id_header():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get(REQUEST_ID_HEADER)


def test_request_id_is_echoed_when_supplied():
    client = TestClient(app)
    response = client.get("/health", headers={REQUEST_ID_HEADER: "trace-abc-123"})
    assert response.headers.get(REQUEST_ID_HEADER) == "trace-abc-123"


def test_unhandled_exception_returns_structured_error_without_leaking_details():
    boom_app = FastAPI()
    install_observability(boom_app)

    @boom_app.get("/boom")
    def _boom():
        raise RuntimeError("super secret stacktrace detail")

    client = TestClient(boom_app, raise_server_exceptions=False)
    response = client.get("/boom")

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["type"] == "RuntimeError"
    assert body["error"]["message"] == "Internal server error"
    assert body["request_id"]
    assert response.headers.get(REQUEST_ID_HEADER)
    # Internal exception text must never reach the client.
    assert "super secret stacktrace detail" not in response.text
