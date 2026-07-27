"""Structured logging setup with request-id propagation.

The application had no logging before this module (see
``docs/production-readiness-review.md`` P0-3). ``configure_logging`` installs a
single stdout handler whose format always carries the current request id, which
is stored in a context variable so any logger in the request path can emit it
without threading the id through call signatures.
"""

import logging
import sys
from contextvars import ContextVar

# Current request id, defaulting to "-" outside of an HTTP request.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

_configured = False


class _RequestIdFilter(logging.Filter):
    """Inject the active request id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging once. Safe to call multiple times."""

    global _configured
    if _configured:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s [req=%(request_id)s] %(message)s")
    )
    handler.addFilter(_RequestIdFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
