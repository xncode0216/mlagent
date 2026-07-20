from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hmac import compare_digest
from secrets import token_urlsafe
from threading import Lock

from app.core.auth import AuthenticatedUser


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


class AuthSessionService:
    """Process-local, revocable browser auth state with opaque cookie identifiers."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._login_transactions: dict[str, LoginTransaction] = {}
        self._sessions: dict[str, BrowserSession] = {}

    def create_login_transaction(self, ttl_seconds: int) -> LoginTransaction:
        transaction = LoginTransaction(
            id=token_urlsafe(32),
            state=token_urlsafe(32),
            nonce=token_urlsafe(32),
            code_verifier=token_urlsafe(64),
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )
        with self._lock:
            self._purge_expired_locked()
            self._login_transactions[transaction.id] = transaction
        return transaction

    def consume_login_transaction(
        self,
        transaction_id: str,
        state: str,
    ) -> LoginTransaction | None:
        with self._lock:
            self._purge_expired_locked()
            transaction = self._login_transactions.get(transaction_id)
            if transaction is None or not compare_digest(transaction.state, state):
                return None
            return self._login_transactions.pop(transaction_id)

    def create_session(self, user: AuthenticatedUser, ttl_seconds: int) -> BrowserSession:
        session = BrowserSession(
            id=token_urlsafe(32),
            user=user,
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
        )
        with self._lock:
            self._purge_expired_locked()
            self._sessions[session.id] = session
        return session

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


auth_session_service = AuthSessionService()
