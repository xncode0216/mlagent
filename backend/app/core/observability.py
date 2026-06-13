"""Request-id middleware and a global exception handler.

Adds production-readiness basics the app lacked (see
``docs/production-readiness-review.md`` P0-3): every response carries an
``X-Request-ID`` header, each request is access-logged with its duration, and
unhandled exceptions return a structured JSON error (without leaking internal
details) instead of an opaque 500.
"""

import uuid
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger, request_id_var

REQUEST_ID_HEADER = "X-Request-ID"

_logger = get_logger("mlagent.request")


def _resolve_request_id(request: Request) -> str:
    return (
        getattr(request.state, "request_id", None)
        or request.headers.get(REQUEST_ID_HEADER)
        or uuid.uuid4().hex
    )


async def _request_context(request: Request, call_next):
    request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
    request.state.request_id = request_id
    token = request_id_var.set(request_id)
    started = perf_counter()
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers[REQUEST_ID_HEADER] = request_id
    _logger.info(
        "%s %s -> %s (%.1f ms)",
        request.method,
        request.url.path,
        response.status_code,
        (perf_counter() - started) * 1000,
    )
    return response


async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    request_id = _resolve_request_id(request)
    _logger.error(
        "Unhandled error on %s %s [req=%s]: %r",
        request.method,
        request.url.path,
        request_id,
        exc,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {"type": exc.__class__.__name__, "message": "Internal server error"},
            "request_id": request_id,
        },
        headers={REQUEST_ID_HEADER: request_id},
    )


def install_observability(app: FastAPI) -> None:
    """Configure logging and attach the request-id middleware + error handler."""

    configure_logging(get_settings().log_level)
    app.add_middleware(BaseHTTPMiddleware, dispatch=_request_context)
    app.add_exception_handler(Exception, _handle_unexpected_error)
