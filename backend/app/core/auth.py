from collections.abc import AsyncIterator
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
from hmac import compare_digest
from typing import Annotated
from urllib.parse import urlparse

import jwt
from fastapi import Depends, HTTPException, status
from jwt import InvalidTokenError, PyJWK, PyJWKClient, PyJWKClientError
from starlette.requests import HTTPConnection

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    workspace_key: str
    auth_mode: str


_current_user: ContextVar[AuthenticatedUser | None] = ContextVar(
    "mlagent_current_user",
    default=None,
)


def _jwt_workspace_key(subject: str) -> str:
    digest = sha256(subject.encode("utf-8")).hexdigest()
    return f"usr_{digest[:32]}"


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _development_user(settings: Settings) -> AuthenticatedUser:
    user_id = settings.dev_user_id.strip()
    if not user_id or "/" in user_id or "\\" in user_id or user_id in {".", ".."}:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Development authentication is not configured safely",
        )
    return AuthenticatedUser(
        id=user_id,
        workspace_key=user_id,
        auth_mode="development",
    )


@lru_cache(maxsize=16)
def _oidc_jwks_client(
    jwks_url: str,
    cache_seconds: int,
    timeout_seconds: float,
) -> PyJWKClient:
    return PyJWKClient(
        jwks_url,
        cache_keys=True,
        max_cached_keys=16,
        cache_jwk_set=True,
        lifespan=cache_seconds,
        timeout=timeout_seconds,
    )


def _get_oidc_signing_key(token: str, settings: Settings) -> PyJWK:
    return _oidc_jwks_client(
        settings.auth_oidc_jwks_url,
        settings.auth_oidc_jwks_cache_seconds,
        settings.auth_oidc_jwks_timeout_seconds,
    ).get_signing_key_from_jwt(token)


def _validate_oidc_token_header(token: str) -> None:
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise _unauthorized() from exc
    kid = header.get("kid")
    if (
        header.get("alg") != "RS256"
        or not isinstance(kid, str)
        or not kid
        or len(kid) > 128
        or any(ord(character) < 32 for character in kid)
    ):
        raise _unauthorized()


def _is_secure_oidc_url(raw_url: str, *, allow_query: bool) -> bool:
    if not raw_url or raw_url != raw_url.strip():
        return False
    parsed = urlparse(raw_url)
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None
        and not parsed.fragment
        and (allow_query or not parsed.query)
    )


def _validate_oidc_configuration(settings: Settings) -> None:
    if (
        not _is_secure_oidc_url(settings.auth_oidc_issuer, allow_query=False)
        or not settings.auth_oidc_audience
        or not _is_secure_oidc_url(settings.auth_oidc_jwks_url, allow_query=True)
        or not 0 < settings.auth_oidc_jwks_cache_seconds <= 86_400
        or not 0 < settings.auth_oidc_jwks_timeout_seconds <= 30
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC authentication is not configured",
        )


def _authenticated_user_from_claims(claims: dict[str, object], auth_mode: str) -> AuthenticatedUser:
    subject = claims.get("sub")
    if (
        not isinstance(subject, str)
        or not subject.strip()
        or len(subject) > 255
        or any(ord(character) < 32 for character in subject)
    ):
        raise _unauthorized()
    subject = subject.strip()
    return AuthenticatedUser(
        id=subject,
        workspace_key=_jwt_workspace_key(subject),
        auth_mode=auth_mode,
    )


def decode_oidc_token(
    token: str,
    settings: Settings,
    *,
    audience: str | None = None,
    nonce: str | None = None,
) -> dict[str, object]:
    _validate_oidc_configuration(settings)
    try:
        _validate_oidc_token_header(token)
        signing_key = _get_oidc_signing_key(token, settings)
        required_claims = ["exp", "sub", "iss", "aud"]
        if nonce is not None:
            required_claims.append("nonce")
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=audience or settings.auth_oidc_audience,
            issuer=settings.auth_oidc_issuer,
            leeway=settings.auth_jwt_leeway_seconds,
            options={"require": required_claims},
        )
    except (InvalidTokenError, PyJWKClientError) as exc:
        raise _unauthorized() from exc
    token_nonce = claims.get("nonce")
    if nonce is not None and (
        not isinstance(token_nonce, str) or not compare_digest(token_nonce, nonce)
    ):
        raise _unauthorized()
    expected_audience = audience or settings.auth_oidc_audience
    authorized_party = claims.get("azp")
    if authorized_party is not None and (
        not isinstance(authorized_party, str)
        or not compare_digest(authorized_party, expected_audience)
    ):
        raise _unauthorized()
    token_audience = claims.get("aud")
    if isinstance(token_audience, list) and len(token_audience) > 1:
        if not isinstance(authorized_party, str) or not compare_digest(
            authorized_party,
            expected_audience,
        ):
            raise _unauthorized()
    return claims


def _browser_return_origin(settings: Settings) -> str:
    parsed = urlparse(settings.auth_browser_return_url)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def validate_browser_request_origin(connection: HTTPConnection, settings: Settings) -> None:
    method = connection.scope.get("method", "GET").upper()
    if connection.scope.get("type") != "websocket" and method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = connection.headers.get("origin", "").rstrip("/")
    allowed_origins = {configured.rstrip("/") for configured in settings.cors_origins}
    return_origin = _browser_return_origin(settings)
    if return_origin:
        allowed_origins.add(return_origin)
    if not origin or origin not in allowed_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid browser request origin",
        )


def authenticate_request(connection: HTTPConnection, settings: Settings) -> AuthenticatedUser:
    if settings.auth_mode == "development":
        return _development_user(settings)

    secret = ""
    if settings.auth_mode == "jwt":
        secret = settings.auth_jwt_secret.get_secret_value()
        if len(secret.encode("utf-8")) < 32:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="JWT authentication is not configured",
            )
    else:
        _validate_oidc_configuration(settings)

    authorization = connection.headers.get("authorization", "")
    if not authorization and settings.auth_mode == "oidc":
        from app.services.auth_session_service import auth_session_service

        session_id = connection.cookies.get("mlagent_session", "")
        session = auth_session_service.get_session(session_id) if session_id else None
        if session is None:
            raise _unauthorized()
        validate_browser_request_origin(connection, settings)
        return session.user

    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized()

    try:
        if settings.auth_mode == "jwt":
            claims = jwt.decode(
                token.strip(),
                secret,
                algorithms=["HS256"],
                audience=settings.auth_jwt_audience or None,
                issuer=settings.auth_jwt_issuer or None,
                leeway=settings.auth_jwt_leeway_seconds,
                options={
                    "require": ["exp", "sub"],
                    "verify_aud": bool(settings.auth_jwt_audience),
                    "verify_iss": bool(settings.auth_jwt_issuer),
                },
            )
        else:
            claims = decode_oidc_token(token.strip(), settings)
    except (InvalidTokenError, PyJWKClientError) as exc:
        raise _unauthorized() from exc

    return _authenticated_user_from_claims(claims, settings.auth_mode)


def get_current_user(
    connection: HTTPConnection,
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthenticatedUser:
    return authenticate_request(connection, settings)


async def bind_current_user(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
) -> AsyncIterator[None]:
    token = _current_user.set(user)
    try:
        yield
    finally:
        _current_user.reset(token)


def current_user() -> AuthenticatedUser:
    user = _current_user.get()
    if user is not None:
        return user
    settings = get_settings()
    if settings.auth_mode != "development":
        raise RuntimeError("Authenticated user context is required")
    return _development_user(settings)
