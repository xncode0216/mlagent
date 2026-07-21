"""Authentication audit trail.

Emits structured, greppable auth lifecycle events (login success/failure,
logout) to a dedicated ``mlagent.audit`` logger. Records inherit the active
request id through the shared logging filter (see ``app.core.logging``). This
is deliberately scoped to discrete browser-auth actions; high-volume per-request
bearer-token outcomes stay in the access log rather than the audit trail.

Security: never pass tokens, cookies, PKCE verifiers, or client secrets here.
The subject (the authenticated identity) is logged on purpose — attributing who
did what is the point of an audit trail.
"""

from collections.abc import Sequence

from app.core.logging import get_logger

_audit_logger = get_logger("mlagent.audit")


def _format_value(value: object) -> str:
    text = str(value)
    if text == "" or any(character.isspace() for character in text) or '"' in text:
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def record_auth_event(
    event: str,
    *,
    outcome: str = "success",
    subject: str | None = None,
    auth_mode: str | None = None,
    org_id: str | None = None,
    roles: Sequence[str] = (),
    reason: str | None = None,
) -> None:
    """Record one authentication event as a stable ``key=value`` audit line."""
    fields: list[tuple[str, object]] = [("event", event), ("outcome", outcome)]
    if subject is not None:
        fields.append(("subject", subject))
    if auth_mode is not None:
        fields.append(("auth_mode", auth_mode))
    if org_id is not None:
        fields.append(("org", org_id))
    if roles:
        fields.append(("roles", ",".join(roles)))
    if reason is not None:
        fields.append(("reason", reason))
    rendered = " ".join(f"{key}={_format_value(value)}" for key, value in fields)
    _audit_logger.info("auth_event %s", rendered)
