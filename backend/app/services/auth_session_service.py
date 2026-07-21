import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hmac import compare_digest
from secrets import token_urlsafe
from threading import Lock
from typing import Protocol

from redis import Redis
from redis.exceptions import WatchError

from app.core.auth import AuthenticatedUser
from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class LoginTransaction:
    id: str
    state: str
    nonce: str
    code_verifier: str
    expires_at: datetime


@dataclass(frozen=True)
class BrowserSession:
    id: str
    user: AuthenticatedUser
    expires_at: datetime


class AuthSessionStore(Protocol):
    """Persistence contract for revocable browser auth state.

    Implementations must guarantee that ``consume_login_transaction`` returns a
    given transaction at most once even under concurrent callers, so a stolen or
    replayed authorization callback cannot establish a second session.
    """

    def put_login_transaction(self, transaction: LoginTransaction, ttl_seconds: int) -> None: ...

    def consume_login_transaction(
        self, transaction_id: str, state: str
    ) -> LoginTransaction | None: ...

    def put_session(self, session: BrowserSession, ttl_seconds: int) -> None: ...

    def get_session(self, session_id: str) -> BrowserSession | None: ...

    def revoke_session(self, session_id: str) -> None: ...

    def clear(self) -> None: ...


class InMemoryAuthSessionStore:
    """Process-local store; correct for a single worker, not shared across instances."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._login_transactions: dict[str, LoginTransaction] = {}
        self._sessions: dict[str, BrowserSession] = {}

    def put_login_transaction(self, transaction: LoginTransaction, ttl_seconds: int) -> None:
        with self._lock:
            self._purge_expired_locked()
            self._login_transactions[transaction.id] = transaction

    def consume_login_transaction(
        self, transaction_id: str, state: str
    ) -> LoginTransaction | None:
        with self._lock:
            self._purge_expired_locked()
            transaction = self._login_transactions.get(transaction_id)
            if transaction is None or not compare_digest(transaction.state, state):
                return None
            return self._login_transactions.pop(transaction_id)

    def put_session(self, session: BrowserSession, ttl_seconds: int) -> None:
        with self._lock:
            self._purge_expired_locked()
            self._sessions[session.id] = session

    def get_session(self, session_id: str) -> BrowserSession | None:
        with self._lock:
            self._purge_expired_locked()
            return self._sessions.get(session_id)

    def revoke_session(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def clear(self) -> None:
        with self._lock:
            self._login_transactions.clear()
            self._sessions.clear()

    def _purge_expired_locked(self) -> None:
        now = datetime.now(UTC)
        self._login_transactions = {
            key: value
            for key, value in self._login_transactions.items()
            if value.expires_at > now
        }
        self._sessions = {
            key: value for key, value in self._sessions.items() if value.expires_at > now
        }


class RedisAuthSessionStore:
    """Redis-backed store sharing auth state across workers with native key TTLs."""

    def __init__(self, client: Redis, *, key_prefix: str = "mlagent:auth:") -> None:
        self._client = client
        self._login_prefix = f"{key_prefix}login:"
        self._session_prefix = f"{key_prefix}session:"

    def put_login_transaction(self, transaction: LoginTransaction, ttl_seconds: int) -> None:
        self._client.set(
            self._login_key(transaction.id),
            _serialize_login_transaction(transaction),
            ex=max(1, ttl_seconds),
        )

    def consume_login_transaction(
        self, transaction_id: str, state: str
    ) -> LoginTransaction | None:
        key = self._login_key(transaction_id)
        with self._client.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if raw is None:
                        pipe.unwatch()
                        return None
                    transaction = _deserialize_login_transaction(raw)
                    if transaction is None or not compare_digest(transaction.state, state):
                        pipe.unwatch()
                        return None
                    # WATCH + MULTI makes the delete atomic: a racing consumer that
                    # already removed the key aborts EXEC, so only one caller wins.
                    pipe.multi()
                    pipe.delete(key)
                    pipe.execute()
                    return transaction
                except WatchError:
                    continue

    def put_session(self, session: BrowserSession, ttl_seconds: int) -> None:
        self._client.set(
            self._session_key(session.id),
            _serialize_session(session),
            ex=max(1, ttl_seconds),
        )

    def get_session(self, session_id: str) -> BrowserSession | None:
        raw = self._client.get(self._session_key(session_id))
        if raw is None:
            return None
        return _deserialize_session(raw)

    def revoke_session(self, session_id: str) -> None:
        self._client.delete(self._session_key(session_id))

    def clear(self) -> None:
        for prefix in (self._login_prefix, self._session_prefix):
            for key in self._client.scan_iter(match=f"{prefix}*"):
                self._client.delete(key)

    def _login_key(self, transaction_id: str) -> str:
        return f"{self._login_prefix}{transaction_id}"

    def _session_key(self, session_id: str) -> str:
        return f"{self._session_prefix}{session_id}"


def _serialize_login_transaction(transaction: LoginTransaction) -> str:
    return json.dumps(
        {
            "id": transaction.id,
            "state": transaction.state,
            "nonce": transaction.nonce,
            "code_verifier": transaction.code_verifier,
            "expires_at": transaction.expires_at.isoformat(),
        }
    )


def _deserialize_login_transaction(raw: str) -> LoginTransaction | None:
    try:
        data = json.loads(raw)
        return LoginTransaction(
            id=data["id"],
            state=data["state"],
            nonce=data["nonce"],
            code_verifier=data["code_verifier"],
            expires_at=datetime.fromisoformat(data["expires_at"]),
        )
    except (ValueError, KeyError, TypeError):
        return None


def _serialize_session(session: BrowserSession) -> str:
    return json.dumps(
        {
            "id": session.id,
            "user": {
                "id": session.user.id,
                "workspace_key": session.user.workspace_key,
                "auth_mode": session.user.auth_mode,
                "org_id": session.user.org_id,
                "roles": list(session.user.roles),
            },
            "expires_at": session.expires_at.isoformat(),
        }
    )


def _deserialize_session(raw: str) -> BrowserSession | None:
    try:
        data = json.loads(raw)
        user = data["user"]
        return BrowserSession(
            id=data["id"],
            user=AuthenticatedUser(
                id=user["id"],
                workspace_key=user["workspace_key"],
                auth_mode=user["auth_mode"],
                org_id=user.get("org_id"),
                roles=tuple(user.get("roles", ())),
            ),
            expires_at=datetime.fromisoformat(data["expires_at"]),
        )
    except (ValueError, KeyError, TypeError):
        return None


class AuthSessionService:
    """Issues opaque, revocable browser auth state and delegates storage to a backend."""

    def __init__(self, store: AuthSessionStore) -> None:
        self._store = store

    def create_login_transaction(self, ttl_seconds: int) -> LoginTransaction:
        transaction = LoginTransaction(
            id=token_urlsafe(32),
            state=token_urlsafe(32),
            nonce=token_urlsafe(32),
            code_verifier=token_urlsafe(64),
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )
        self._store.put_login_transaction(transaction, ttl_seconds)
        return transaction

    def consume_login_transaction(
        self, transaction_id: str, state: str
    ) -> LoginTransaction | None:
        return self._store.consume_login_transaction(transaction_id, state)

    def create_session(self, user: AuthenticatedUser, ttl_seconds: int) -> BrowserSession:
        session = BrowserSession(
            id=token_urlsafe(32),
            user=user,
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )
        self._store.put_session(session, ttl_seconds)
        return session

    def get_session(self, session_id: str) -> BrowserSession | None:
        return self._store.get_session(session_id)

    def revoke_session(self, session_id: str) -> None:
        self._store.revoke_session(session_id)

    def clear(self) -> None:
        self._store.clear()


def _build_store_from_settings(settings: Settings) -> AuthSessionStore:
    if settings.auth_session_backend == "redis":
        return RedisAuthSessionStore(Redis.from_url(settings.redis_url, decode_responses=True))
    return InMemoryAuthSessionStore()


auth_session_service = AuthSessionService(_build_store_from_settings(get_settings()))
