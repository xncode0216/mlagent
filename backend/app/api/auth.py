from base64 import urlsafe_b64encode
from hashlib import sha256
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.audit import record_auth_event
from app.core.auth import (
    _authenticated_user_from_claims,
    _is_secure_oidc_url,
    _validate_oidc_configuration,
    authenticate_request,
    decode_oidc_token,
    validate_browser_request_origin,
)
from app.core.config import Settings, get_settings
from app.services.auth_session_service import LoginTransaction, auth_session_service


router = APIRouter(prefix="/api/auth", tags=["auth"])


class OidcTokenResponse(BaseModel):
    id_token: str = Field(min_length=1, max_length=16_384)

    model_config = ConfigDict(extra="ignore")


class BrowserSessionResponse(BaseModel):
    authenticated: bool
    user_id: str | None
    auth_mode: str
    org_id: str | None = None
    roles: list[str] = []


def _validate_browser_auth_configuration(settings: Settings) -> None:
    if settings.auth_mode != "oidc":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC browser authentication is not configured",
        )
    try:
        _validate_oidc_configuration(settings)
    except HTTPException as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC browser authentication is not configured",
        ) from exc
    if (
        not _is_secure_oidc_url(settings.auth_oidc_authorization_url, allow_query=False)
        or not _is_secure_oidc_url(settings.auth_oidc_token_url, allow_query=False)
        or not settings.auth_oidc_client_id.strip()
        or settings.auth_oidc_client_id != settings.auth_oidc_client_id.strip()
        or len(settings.auth_oidc_client_id) > 255
        or any(ord(character) < 32 for character in settings.auth_oidc_client_id)
        or not _is_secure_oidc_url(settings.auth_oidc_redirect_uri, allow_query=False)
        or not _is_secure_oidc_url(settings.auth_browser_return_url, allow_query=True)
        or not 0 < settings.auth_oidc_token_timeout_seconds <= 30
        or not 60 <= settings.auth_login_transaction_ttl_seconds <= 600
        or not 300 <= settings.auth_session_ttl_seconds <= 86_400
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC browser authentication is not configured",
        )


def _oidc_http_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=settings.auth_oidc_token_timeout_seconds)


async def _exchange_code_for_tokens(
    code: str,
    transaction: LoginTransaction,
    settings: Settings,
) -> OidcTokenResponse:
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.auth_oidc_redirect_uri,
        "client_id": settings.auth_oidc_client_id,
        "code_verifier": transaction.code_verifier,
    }
    client_secret = settings.auth_oidc_client_secret.get_secret_value()
    client_auth: httpx.BasicAuth | None = None
    if client_secret:
        form.pop("client_id")
        client_auth = httpx.BasicAuth(settings.auth_oidc_client_id, client_secret)
    try:
        async with _oidc_http_client(settings) as client:
            response = await client.post(settings.auth_oidc_token_url, data=form, auth=client_auth)
            response.raise_for_status()
        if len(response.content) > 65_536:
            raise ValueError("OIDC token response is too large")
        return OidcTokenResponse.model_validate(response.json())
    except (httpx.HTTPError, ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Identity provider token exchange failed",
        ) from exc


@router.get("/login", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
def login(settings: Annotated[Settings, Depends(get_settings)]) -> RedirectResponse:
    _validate_browser_auth_configuration(settings)
    transaction = auth_session_service.create_login_transaction(
        settings.auth_login_transaction_ttl_seconds
    )
    challenge = urlsafe_b64encode(sha256(transaction.code_verifier.encode()).digest()).rstrip(b"=")
    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.auth_oidc_client_id,
            "redirect_uri": settings.auth_oidc_redirect_uri,
            "scope": "openid",
            "state": transaction.state,
            "nonce": transaction.nonce,
            "code_challenge": challenge.decode("ascii"),
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(f"{settings.auth_oidc_authorization_url}?{query}")
    response.set_cookie(
        "mlagent_login",
        transaction.id,
        max_age=settings.auth_login_transaction_ttl_seconds,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api/auth/callback",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/callback", status_code=status.HTTP_303_SEE_OTHER)
async def callback(
    request: Request,
    code: Annotated[str, Query(min_length=1, max_length=4096)],
    state_value: Annotated[
        str,
        Query(alias="state", min_length=1, max_length=512),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RedirectResponse:
    _validate_browser_auth_configuration(settings)
    transaction_id = request.cookies.get("mlagent_login", "")
    transaction = auth_session_service.consume_login_transaction(transaction_id, state_value)
    if transaction is None:
        record_auth_event(
            "login.callback", outcome="failure", auth_mode="oidc", reason="invalid_transaction"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid authentication transaction",
        )
    try:
        token_response = await _exchange_code_for_tokens(code, transaction, settings)
    except HTTPException:
        record_auth_event(
            "login.callback", outcome="failure", auth_mode="oidc", reason="token_exchange_failed"
        )
        raise
    try:
        claims = decode_oidc_token(
            token_response.id_token,
            settings,
            audience=settings.auth_oidc_client_id,
            nonce=transaction.nonce,
        )
        user = _authenticated_user_from_claims(claims, "oidc", settings)
    except HTTPException as exc:
        record_auth_event(
            "login.callback", outcome="failure", auth_mode="oidc", reason="invalid_id_token"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid identity token",
        ) from exc
    session = auth_session_service.create_session(user, settings.auth_session_ttl_seconds)
    record_auth_event(
        "login.success",
        outcome="success",
        subject=user.id,
        auth_mode="oidc",
        org_id=user.org_id,
        roles=user.roles,
    )
    response = RedirectResponse(settings.auth_browser_return_url, status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(
        "mlagent_login",
        path="/api/auth/callback",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        "mlagent_session",
        session.id,
        max_age=settings.auth_session_ttl_seconds,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/session", response_model=BrowserSessionResponse)
def session_status(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> BrowserSessionResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        user = authenticate_request(request, settings)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_401_UNAUTHORIZED:
            raise
        return BrowserSessionResponse(
            authenticated=False,
            user_id=None,
            auth_mode=settings.auth_mode,
        )
    return BrowserSessionResponse(
        authenticated=True,
        user_id=user.id,
        auth_mode=user.auth_mode,
        org_id=user.org_id,
        roles=list(user.roles),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    session_id = request.cookies.get("mlagent_session", "")
    if session_id:
        try:
            validate_browser_request_origin(request, settings)
        except HTTPException:
            record_auth_event("logout", outcome="failure", auth_mode="oidc", reason="invalid_origin")
            raise
        session = auth_session_service.get_session(session_id)
        auth_session_service.revoke_session(session_id)
        record_auth_event(
            "logout",
            outcome="success",
            subject=session.user.id if session else None,
            auth_mode="oidc",
        )
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        "mlagent_session",
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return response
