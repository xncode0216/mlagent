from datetime import UTC, datetime, timedelta

import fakeredis
import pytest

from app.core.auth import AuthenticatedUser
from app.core.config import Settings
from app.services.auth_session_service import (
    AuthSessionService,
    BrowserSession,
    InMemoryAuthSessionStore,
    LoginTransaction,
    RedisAuthSessionStore,
    _build_store_from_settings,
)


def _transaction(*, transaction_id: str = "txn-1", state: str = "state-value", ttl: int = 600):
    return LoginTransaction(
        id=transaction_id,
        state=state,
        nonce="nonce-value",
        code_verifier="verifier-value",
        expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
    )


def _session(*, session_id: str = "session-1", ttl: int = 3600):
    return BrowserSession(
        id=session_id,
        user=AuthenticatedUser(id="user-1", workspace_key="usr_abc", auth_mode="oidc"),
        expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
    )


@pytest.fixture(params=["memory", "redis"])
def store(request):
    """Both backends must satisfy the identical AuthSessionStore contract."""
    if request.param == "redis":
        return RedisAuthSessionStore(fakeredis.FakeRedis(decode_responses=True))
    return InMemoryAuthSessionStore()


def test_consume_login_transaction_returns_full_transaction_once(store):
    transaction = _transaction()
    store.put_login_transaction(transaction, 600)

    consumed = store.consume_login_transaction(transaction.id, transaction.state)

    assert consumed is not None
    assert consumed.id == transaction.id
    assert consumed.nonce == transaction.nonce
    assert consumed.code_verifier == transaction.code_verifier
    # One-time consumption: a replay with the same identifiers must fail.
    assert store.consume_login_transaction(transaction.id, transaction.state) is None


def test_consume_login_transaction_rejects_wrong_state_without_consuming(store):
    transaction = _transaction(state="correct-state")
    store.put_login_transaction(transaction, 600)

    assert store.consume_login_transaction(transaction.id, "attacker-state") is None
    # A wrong-state attempt must not burn the still-pending transaction.
    consumed = store.consume_login_transaction(transaction.id, "correct-state")
    assert consumed is not None
    assert consumed.id == transaction.id


def test_consume_missing_login_transaction_returns_none(store):
    assert store.consume_login_transaction("does-not-exist", "state") is None


def test_put_get_and_revoke_session_preserves_user_identity(store):
    session = _session()
    store.put_session(session, 3600)

    loaded = store.get_session(session.id)
    assert loaded is not None
    assert loaded.id == session.id
    assert loaded.user.id == "user-1"
    assert loaded.user.workspace_key == "usr_abc"
    assert loaded.user.auth_mode == "oidc"

    store.revoke_session(session.id)
    assert store.get_session(session.id) is None


def test_get_missing_session_returns_none(store):
    assert store.get_session("missing") is None


def test_clear_removes_transactions_and_sessions(store):
    store.put_login_transaction(_transaction(transaction_id="t1"), 600)
    store.put_session(_session(session_id="s1"), 3600)

    store.clear()

    assert store.consume_login_transaction("t1", "state-value") is None
    assert store.get_session("s1") is None


def test_inmemory_store_expires_transactions_and_sessions_by_wall_clock():
    store = InMemoryAuthSessionStore()
    expired_transaction = LoginTransaction(
        id="old",
        state="s",
        nonce="n",
        code_verifier="v",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    store.put_login_transaction(expired_transaction, 600)
    assert store.consume_login_transaction("old", "s") is None

    expired_session = BrowserSession(
        id="old-session",
        user=AuthenticatedUser(id="u", workspace_key="w", auth_mode="oidc"),
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    store.put_session(expired_session, 3600)
    assert store.get_session("old-session") is None


def test_redis_store_sets_native_ttl_on_writes():
    client = fakeredis.FakeRedis(decode_responses=True)
    store = RedisAuthSessionStore(client)

    store.put_login_transaction(_transaction(transaction_id="t"), 300)
    store.put_session(_session(session_id="s"), 1200)

    assert 0 < client.ttl("mlagent:auth:login:t") <= 300
    assert 0 < client.ttl("mlagent:auth:session:s") <= 1200


def test_service_creates_unique_high_entropy_login_transactions():
    service = AuthSessionService(InMemoryAuthSessionStore())

    first = service.create_login_transaction(600)
    second = service.create_login_transaction(600)

    assert first.id != second.id
    assert first.state != second.state
    assert first.nonce != second.nonce
    assert len(first.code_verifier) >= 43


def test_service_backed_by_redis_store_round_trips_browser_login():
    service = AuthSessionService(RedisAuthSessionStore(fakeredis.FakeRedis(decode_responses=True)))

    transaction = service.create_login_transaction(600)
    consumed = service.consume_login_transaction(transaction.id, transaction.state)

    assert consumed is not None
    assert consumed.code_verifier == transaction.code_verifier
    assert service.consume_login_transaction(transaction.id, transaction.state) is None


def test_build_store_from_settings_selects_backend():
    memory_settings = Settings(auth_session_backend="memory")
    redis_settings = Settings(
        auth_session_backend="redis",
        redis_url="redis://localhost:6379/0",
    )

    assert isinstance(_build_store_from_settings(memory_settings), InMemoryAuthSessionStore)
    assert isinstance(_build_store_from_settings(redis_settings), RedisAuthSessionStore)
