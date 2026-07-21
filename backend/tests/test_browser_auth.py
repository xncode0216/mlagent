import logging
from base64 import b64decode
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import jwt
import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.api.auth import OidcTokenResponse
from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app
from app.services.auth_session_service import auth_session_service


OIDC_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _id_token(
    subject: str,
    nonce: str,
    *,
    audience: str | list[str] = "mlagent-browser",
    authorized_party: str | None = None,
) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "iss": "https://idp.example.test",
        "aud": audience,
        "nonce": nonce,
    }
    if authorized_party is not None:
        claims["azp"] = authorized_party
    return jwt.encode(
        claims,
        OIDC_PRIVATE_KEY,
        algorithm="RS256",
        headers={"kid": "browser-key-1"},
    )


@pytest.fixture
def browser_auth_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_AUTH_MODE", "oidc")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_ISSUER", "https://idp.example.test")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_AUDIENCE", "mlagent-api")
    monkeypatch.setenv(
        "MLAGENT_AUTH_OIDC_JWKS_URL",
        "https://idp.example.test/.well-known/jwks.json",
    )
    monkeypatch.setenv(
        "MLAGENT_AUTH_OIDC_AUTHORIZATION_URL",
        "https://idp.example.test/oauth2/authorize",
    )
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_TOKEN_URL", "https://idp.example.test/oauth2/token")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_CLIENT_ID", "mlagent-browser")
    monkeypatch.setenv(
        "MLAGENT_AUTH_OIDC_REDIRECT_URI",
        "https://mlagent.example.test/api/auth/callback",
    )
    monkeypatch.setenv("MLAGENT_AUTH_BROWSER_RETURN_URL", "https://mlagent.example.test/")
    monkeypatch.setenv("MLAGENT_CORS_ORIGINS", '["https://mlagent.example.test"]')
    monkeypatch.setattr(
        "app.core.auth._get_oidc_signing_key",
        lambda _token, _settings: OIDC_PRIVATE_KEY.public_key(),
    )
    get_settings.cache_clear()
    auth_session_service.clear()
    PROJECTS.clear()
    yield TestClient(app, base_url="https://mlagent.example.test", follow_redirects=False), tmp_path
    PROJECTS.clear()
    auth_session_service.clear()
    get_settings.cache_clear()


def test_login_redirect_uses_oidc_code_flow_pkce_and_hardened_cookie(browser_auth_client):
    client, _ = browser_auth_client
    response = client.get("/api/auth/login")

    assert response.status_code == 307
    location = urlparse(response.headers["location"])
    query = parse_qs(location.query)
    assert f"{location.scheme}://{location.netloc}{location.path}" == (
        "https://idp.example.test/oauth2/authorize"
    )
    assert query["response_type"] == ["code"]
    assert query["client_id"] == ["mlagent-browser"]
    assert query["redirect_uri"] == ["https://mlagent.example.test/api/auth/callback"]
    assert query["scope"] == ["openid"]
    assert len(query["state"][0]) >= 32
    assert len(query["nonce"][0]) >= 32
    assert query["code_challenge_method"] == ["S256"]
    assert 43 <= len(query["code_challenge"][0]) <= 128

    cookie = response.headers["set-cookie"].lower()
    assert "mlagent_login=" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=lax" in cookie
    assert "path=/api/auth/callback" in cookie


def test_callback_creates_revocable_browser_session_for_protected_api(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    authorization_query = parse_qs(urlparse(login_response.headers["location"]).query)
    exchanged: dict[str, str] = {}

    async def exchange(code, transaction, _settings):
        exchanged["code"] = code
        exchanged["verifier"] = transaction.code_verifier
        return OidcTokenResponse(id_token=_id_token("browser-user", transaction.nonce))

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)

    callback_response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": authorization_query["state"][0]},
    )

    assert callback_response.status_code == 303
    assert callback_response.headers["location"] == "https://mlagent.example.test/"
    assert exchanged["code"] == "authorization-code"
    assert len(exchanged["verifier"]) >= 43
    cookie = callback_response.headers["set-cookie"].lower()
    assert "mlagent_session=" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=strict" in cookie

    session_response = client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json() == {
        "authenticated": True,
        "user_id": "browser-user",
        "auth_mode": "oidc",
        "org_id": None,
        "roles": [],
    }

    project_response = client.post(
        "/api/projects",
        headers={"Origin": "https://mlagent.example.test"},
        json={"name": "Browser project"},
    )
    assert project_response.status_code == 200
    assert project_response.json()["owner_id"] == "browser-user"

    logout_response = client.post(
        "/api/auth/logout",
        headers={"Origin": "https://mlagent.example.test"},
    )
    assert logout_response.status_code == 204
    cleared_cookie = logout_response.headers["set-cookie"].lower()
    assert "mlagent_session=" in cleared_cookie
    assert "max-age=0" in cleared_cookie
    assert client.get("/api/projects").status_code == 401


def test_callback_rejects_wrong_state_without_exchanging_code(browser_auth_client, monkeypatch):
    client, _ = browser_auth_client
    client.get("/api/auth/login")

    async def unexpected_exchange(*_args):
        pytest.fail("A callback with an invalid state must not exchange its code")

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", unexpected_exchange)
    response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": "attacker-state"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid authentication transaction"


def test_callback_rejects_nonce_mismatch_without_creating_session(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]

    async def exchange(_code, _transaction, _settings):
        return OidcTokenResponse(id_token=_id_token("browser-user", "wrong-nonce"))

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)
    response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid identity token"
    assert client.get("/api/projects").status_code == 401


def test_callback_rejects_multiple_audiences_without_matching_authorized_party(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]

    async def exchange(_code, transaction, _settings):
        token = _id_token(
            "browser-user",
            transaction.nonce,
            audience=["mlagent-browser", "another-client"],
        )
        return OidcTokenResponse(id_token=token)

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)
    response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid identity token"


def test_callback_transaction_is_consumed_once(browser_auth_client, monkeypatch):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]
    login_cookie = client.cookies.get("mlagent_login")
    exchange_count = 0

    async def exchange(_code, transaction, _settings):
        nonlocal exchange_count
        exchange_count += 1
        return OidcTokenResponse(id_token=_id_token("browser-user", transaction.nonce))

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)
    first = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )
    replay_client = TestClient(
        app,
        base_url="https://mlagent.example.test",
        follow_redirects=False,
    )
    replay_client.cookies.set(
        "mlagent_login",
        login_cookie,
        domain="mlagent.example.test",
        path="/api/auth/callback",
    )
    replay = replay_client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )

    assert first.status_code == 303
    assert replay.status_code == 400
    assert exchange_count == 1


def test_cookie_authenticated_write_requires_an_allowed_origin(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]

    async def exchange(_code, transaction, _settings):
        return OidcTokenResponse(id_token=_id_token("browser-user", transaction.nonce))

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)
    assert client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    ).status_code == 303

    response = client.post("/api/projects", json={"name": "CSRF attempt"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid browser request origin"


def test_callback_token_exchange_sends_pkce_form_and_validates_response(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_CLIENT_SECRET", "provider-client-secret")
    get_settings.cache_clear()
    login_response = client.get("/api/auth/login")
    authorization_query = parse_qs(urlparse(login_response.headers["location"]).query)
    state = authorization_query["state"][0]
    nonce = authorization_query["nonce"][0]
    received_form: dict[str, list[str]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://idp.example.test/oauth2/token"
        assert request.headers["content-type"].startswith("application/x-www-form-urlencoded")
        scheme, encoded_credentials = request.headers["authorization"].split(" ", maxsplit=1)
        assert scheme == "Basic"
        assert b64decode(encoded_credentials).decode("utf-8") == (
            "mlagent-browser:provider-client-secret"
        )
        received_form.update(parse_qs(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "id_token": _id_token("browser-user", nonce),
                "access_token": "must-not-become-a-browser-cookie",
                "token_type": "Bearer",
            },
        )

    monkeypatch.setattr(
        "app.api.auth._oidc_http_client",
        lambda _settings: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )

    assert response.status_code == 303
    assert received_form["grant_type"] == ["authorization_code"]
    assert received_form["code"] == ["authorization-code"]
    assert "client_id" not in received_form
    assert received_form["redirect_uri"] == [
        "https://mlagent.example.test/api/auth/callback"
    ]
    assert len(received_form["code_verifier"][0]) >= 43
    assert "client_secret" not in received_form
    assert "must-not-become-a-browser-cookie" not in response.headers["set-cookie"]


def test_callback_maps_malformed_provider_response_to_generic_bad_gateway(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]

    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"token": "no-id"}))
    monkeypatch.setattr(
        "app.api.auth._oidc_http_client",
        lambda _settings: httpx.AsyncClient(transport=transport),
    )
    response = client.get(
        "/api/auth/callback",
        params={"code": "authorization-code", "state": state},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Identity provider token exchange failed"
    assert "id_token" not in response.text


def test_login_fails_closed_for_insecure_authorization_endpoint(
    browser_auth_client,
    monkeypatch,
):
    client, _ = browser_auth_client
    monkeypatch.setenv(
        "MLAGENT_AUTH_OIDC_AUTHORIZATION_URL",
        "http://idp.example.test/oauth2/authorize",
    )
    get_settings.cache_clear()

    response = client.get("/api/auth/login")

    assert response.status_code == 503
    assert response.json()["detail"] == "OIDC browser authentication is not configured"


def _complete_login(client, monkeypatch, *, subject: str = "browser-user"):
    login_response = client.get("/api/auth/login")
    state = parse_qs(urlparse(login_response.headers["location"]).query)["state"][0]

    async def exchange(_code, transaction, _settings):
        return OidcTokenResponse(id_token=_id_token(subject, transaction.nonce))

    monkeypatch.setattr("app.api.auth._exchange_code_for_tokens", exchange)
    return client.get("/api/auth/callback", params={"code": "authorization-code", "state": state})


def test_successful_login_is_audited(browser_auth_client, monkeypatch, caplog):
    client, _ = browser_auth_client

    with caplog.at_level(logging.INFO, logger="mlagent.audit"):
        response = _complete_login(client, monkeypatch)

    assert response.status_code == 303
    assert "event=login.success" in caplog.text
    assert "outcome=success" in caplog.text
    assert "subject=browser-user" in caplog.text


def test_rejected_login_is_audited_without_exchanging_code(browser_auth_client, caplog):
    client, _ = browser_auth_client
    client.get("/api/auth/login")

    with caplog.at_level(logging.INFO, logger="mlagent.audit"):
        response = client.get(
            "/api/auth/callback",
            params={"code": "authorization-code", "state": "attacker-state"},
        )

    assert response.status_code == 400
    assert "event=login.callback" in caplog.text
    assert "outcome=failure" in caplog.text
    assert "reason=invalid_transaction" in caplog.text


def test_logout_is_audited(browser_auth_client, monkeypatch, caplog):
    client, _ = browser_auth_client
    assert _complete_login(client, monkeypatch).status_code == 303

    with caplog.at_level(logging.INFO, logger="mlagent.audit"):
        logout_response = client.post(
            "/api/auth/logout",
            headers={"Origin": "https://mlagent.example.test"},
        )

    assert logout_response.status_code == 204
    assert "event=logout" in caplog.text
    assert "subject=browser-user" in caplog.text
