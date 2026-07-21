from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt import PyJWKClientError
from starlette.testclient import WebSocketDenialResponse

from app.api.projects import PROJECTS
from app.core.config import get_settings
from app.main import app


JWT_SECRET = "test-secret-that-is-long-enough-for-hs256"
OIDC_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(
    subject: str,
    *,
    expires_in: timedelta = timedelta(minutes=5),
    extra: dict[str, object] | None = None,
) -> str:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "sub": subject,
        "iat": now,
        "exp": now + expires_in,
        "iss": "https://issuer.test",
        "aud": "mlagent-api",
    }
    if extra:
        claims.update(extra)
    return jwt.encode(claims, JWT_SECRET, algorithm="HS256")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _oidc_token(
    subject: str,
    *,
    algorithm: str = "RS256",
    key: object = OIDC_PRIVATE_KEY,
    kid: str | None = "key-1",
    issuer: str = "https://idp.example.test",
    audience: str = "mlagent-api",
) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": subject,
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "iss": issuer,
            "aud": audience,
        },
        key,
        algorithm=algorithm,
        headers={"kid": kid} if kid is not None else None,
    )


@pytest.fixture
def jwt_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_AUTH_MODE", "jwt")
    monkeypatch.setenv("MLAGENT_AUTH_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("MLAGENT_AUTH_JWT_ISSUER", "https://issuer.test")
    monkeypatch.setenv("MLAGENT_AUTH_JWT_AUDIENCE", "mlagent-api")
    get_settings.cache_clear()
    PROJECTS.clear()
    yield TestClient(app), tmp_path
    PROJECTS.clear()
    get_settings.cache_clear()


@pytest.fixture
def oidc_client(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setenv("MLAGENT_AUTH_MODE", "oidc")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_ISSUER", "https://idp.example.test")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_AUDIENCE", "mlagent-api")
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_JWKS_URL", "https://idp.example.test/.well-known/jwks.json")
    monkeypatch.setattr(
        "app.core.auth._get_oidc_signing_key",
        lambda _token, _settings: OIDC_PRIVATE_KEY.public_key(),
        raising=False,
    )
    get_settings.cache_clear()
    PROJECTS.clear()
    yield TestClient(app, raise_server_exceptions=False), tmp_path
    PROJECTS.clear()
    get_settings.cache_clear()


def test_oidc_mode_accepts_valid_rs256_token(oidc_client):
    client, _ = oidc_client

    response = client.post(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a")),
        json={"name": "OIDC project"},
    )

    assert response.status_code == 200
    assert response.json()["owner_id"] == "oidc-user-a"


def test_oidc_mode_rejects_missing_kid_before_jwks_lookup(oidc_client, monkeypatch):
    client, _ = oidc_client

    def unexpected_lookup(_token, _settings):
        pytest.fail("JWKS lookup must not run without a validated kid")

    monkeypatch.setattr("app.core.auth._get_oidc_signing_key", unexpected_lookup)

    response = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a", kid=None)),
    )

    assert response.status_code == 401


def test_oidc_mode_fails_closed_for_insecure_issuer_url(oidc_client, monkeypatch):
    client, _ = oidc_client
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_ISSUER", "http://idp.example.test")
    get_settings.cache_clear()

    response = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a")),
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "OIDC authentication is not configured"


def test_oidc_mode_fails_closed_for_invalid_jwks_timeout(oidc_client, monkeypatch):
    client, _ = oidc_client
    monkeypatch.setenv("MLAGENT_AUTH_OIDC_JWKS_TIMEOUT_SECONDS", "0")
    get_settings.cache_clear()

    response = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a")),
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "OIDC authentication is not configured"


def test_oidc_mode_rejects_symmetric_algorithm_before_jwks_lookup(oidc_client, monkeypatch):
    client, _ = oidc_client

    def unexpected_lookup(_token, _settings):
        pytest.fail("JWKS lookup must not run for a non-RS256 token")

    monkeypatch.setattr("app.core.auth._get_oidc_signing_key", unexpected_lookup)

    response = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a", algorithm="HS256", key=JWT_SECRET)),
    )

    assert response.status_code == 401


def test_oidc_mode_maps_unknown_kid_to_generic_unauthorized(oidc_client, monkeypatch):
    client, _ = oidc_client

    def unknown_key(_token, _settings):
        raise PyJWKClientError("internal JWKS key lookup detail")

    monkeypatch.setattr("app.core.auth._get_oidc_signing_key", unknown_key)

    response = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a")),
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired authentication token"
    assert "JWKS" not in response.text


def test_oidc_mode_binds_token_to_configured_issuer_and_audience(oidc_client):
    client, _ = oidc_client

    wrong_issuer = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a", issuer="https://attacker.example")),
    )
    wrong_audience = client.get(
        "/api/projects",
        headers=_auth(_oidc_token("oidc-user-a", audience="different-api")),
    )

    assert wrong_issuer.status_code == 401
    assert wrong_audience.status_code == 401


def test_jwt_mode_rejects_missing_token(jwt_client):
    client, _ = jwt_client

    response = client.get("/api/projects")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_jwt_mode_fails_closed_when_secret_is_not_configured(jwt_client, monkeypatch):
    client, _ = jwt_client
    monkeypatch.setenv("MLAGENT_AUTH_JWT_SECRET", "short")
    get_settings.cache_clear()

    response = client.get("/api/projects", headers=_auth(_token("tenant-a")))

    assert response.status_code == 503
    assert response.json()["detail"] == "JWT authentication is not configured"


def test_jwt_mode_rejects_tampered_and_expired_tokens(jwt_client):
    client, _ = jwt_client
    tampered = f"{_token('tenant-a')}x"
    expired = _token("tenant-a", expires_in=timedelta(minutes=-1))

    tampered_response = client.get("/api/projects", headers=_auth(tampered))
    expired_response = client.get("/api/projects", headers=_auth(expired))

    assert tampered_response.status_code == 401
    assert expired_response.status_code == 401
    assert tampered_response.json()["detail"] == "Invalid or expired authentication token"
    assert expired_response.json()["detail"] == "Invalid or expired authentication token"


def test_project_and_files_are_isolated_by_authenticated_subject(jwt_client):
    client, workspace_root = jwt_client
    tenant_a = _auth(_token("tenant-a"))
    tenant_b = _auth(_token("tenant-b"))

    create_response = client.post(
        "/api/projects",
        headers=tenant_a,
        json={"name": "Tenant A project"},
    )
    project = create_response.json()

    assert create_response.status_code == 200
    assert project["owner_id"] == "tenant-a"
    assert workspace_root.resolve() in Path(project["workspace_path"]).parents
    assert client.get("/api/projects", headers=tenant_a).json() == [project]
    assert client.get(f"/api/projects/{project['id']}/files", headers=tenant_a).status_code == 200
    session_response = client.post(
        f"/api/projects/{project['id']}/sessions",
        headers=tenant_a,
        json={"mode": "analysis", "title": "Tenant A session"},
    )
    session_id = session_response.json()["id"]
    assert session_response.status_code == 200
    assert client.get(f"/api/sessions/{session_id}/messages", headers=tenant_a).status_code == 200

    assert client.get("/api/projects", headers=tenant_b).json() == []
    assert client.get(f"/api/projects/{project['id']}", headers=tenant_b).status_code == 404
    assert client.get(f"/api/projects/{project['id']}/files", headers=tenant_b).status_code == 404
    assert client.get(f"/api/sessions/{session_id}/messages", headers=tenant_b).status_code == 404
    assert (
        client.get(f"/api/projects/{project['id']}/resources/gpu/status", headers=tenant_b).status_code
        == 404
    )


def test_jwt_mode_disables_server_local_project_registration(jwt_client, tmp_path):
    client, _ = jwt_client
    local_root = tmp_path / "server-local"
    local_root.mkdir()

    response = client.post(
        "/api/projects/open-local",
        headers=_auth(_token("tenant-a")),
        json={"path": str(local_root)},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Opening server-local paths is disabled in JWT mode"


def test_jwt_mode_protects_websocket_handshake(jwt_client):
    client, _ = jwt_client

    with pytest.raises(WebSocketDenialResponse) as denied:
        with client.websocket_connect("/ws/sessions/test-session"):
            pass

    assert denied.value.status_code == 401

    with client.websocket_connect(
        "/ws/sessions/test-session",
        headers=_auth(_token("tenant-a")),
    ) as websocket:
        websocket.send_json({"type": "unsupported"})
        assert websocket.receive_json()["code"] == "bad_event"


def test_session_endpoint_exposes_roles_and_org_from_jwt_claims(jwt_client):
    client, _ = jwt_client
    token = _token("tenant-a", extra={"roles": ["admin", "member"], "org_id": "acme"})

    body = client.get("/api/auth/session", headers=_auth(token)).json()

    assert body["authenticated"] is True
    assert body["user_id"] == "tenant-a"
    assert body["org_id"] == "acme"
    assert body["roles"] == ["admin", "member"]


def test_single_string_role_claim_becomes_one_role(jwt_client):
    client, _ = jwt_client
    body = client.get(
        "/api/auth/session", headers=_auth(_token("tenant-a", extra={"roles": "admin"}))
    ).json()
    assert body["roles"] == ["admin"]


def test_malformed_role_entries_are_dropped_and_deduped(jwt_client):
    client, _ = jwt_client
    token = _token("tenant-a", extra={"roles": ["ok", 5, "", "   ", "ok"]})

    body = client.get("/api/auth/session", headers=_auth(token)).json()

    assert body["roles"] == ["ok"]


def test_missing_role_and_org_claims_default_to_empty(jwt_client):
    client, _ = jwt_client
    body = client.get("/api/auth/session", headers=_auth(_token("tenant-a"))).json()
    assert body["roles"] == []
    assert body["org_id"] is None


def test_nested_and_custom_claim_paths_are_supported(jwt_client, monkeypatch):
    client, _ = jwt_client
    monkeypatch.setenv("MLAGENT_AUTH_ROLES_CLAIM", "realm_access.roles")
    monkeypatch.setenv("MLAGENT_AUTH_ORG_CLAIM", "https://mlagent.example/org")
    get_settings.cache_clear()
    token = _token(
        "tenant-a",
        extra={
            "realm_access": {"roles": ["ops"]},
            "https://mlagent.example/org": "acme",
        },
    )

    body = client.get("/api/auth/session", headers=_auth(token)).json()

    assert body["roles"] == ["ops"]
    assert body["org_id"] == "acme"


def test_require_roles_allows_a_matching_role_and_blocks_others():
    from fastapi import HTTPException

    from app.core.auth import AuthenticatedUser, require_roles

    guard = require_roles("admin", "owner")
    admin = AuthenticatedUser(id="u", workspace_key="w", auth_mode="jwt", roles=("member", "admin"))
    assert guard(user=admin) is admin

    member = AuthenticatedUser(id="u", workspace_key="w", auth_mode="jwt", roles=("member",))
    with pytest.raises(HTTPException) as denied:
        guard(user=member)
    assert denied.value.status_code == 403
