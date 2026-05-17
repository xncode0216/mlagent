import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


class SessionService:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.sessions_dir = self.project_root / "sessions"
        self.index_path = self.sessions_dir / "index.json"

    def create_session(
        self,
        *,
        project_id: str,
        mode: str = "analysis",
        title: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        sessions = self._load_sessions()
        now = datetime.now(UTC).isoformat()
        resolved_id = session_id or uuid4().hex
        if resolved_id in sessions:
            return sessions[resolved_id]

        record = {
            "id": resolved_id,
            "project_id": project_id,
            "mode": mode,
            "title": title or self._default_title(mode),
            "created_at": now,
            "updated_at": now,
            "message_count": 0,
        }
        sessions[resolved_id] = record
        self._save_sessions(sessions)
        (self.sessions_dir / resolved_id).mkdir(parents=True, exist_ok=True)
        return record

    def ensure_session(
        self,
        *,
        project_id: str,
        session_id: str,
        mode: str = "analysis",
        title: str | None = None,
    ) -> dict[str, Any]:
        return self.create_session(
            project_id=project_id,
            mode=mode,
            title=title,
            session_id=session_id,
        )

    def list_sessions(self) -> list[dict[str, Any]]:
        return sorted(
            self._load_sessions().values(),
            key=lambda record: record["updated_at"],
            reverse=True,
        )

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self._load_sessions().get(session_id)

    def append_message(
        self,
        *,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sessions = self._load_sessions()
        if session_id not in sessions:
            raise KeyError(f"Unknown session: {session_id}")

        now = datetime.now(UTC).isoformat()
        message = {
            "id": uuid4().hex,
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "created_at": now,
        }
        session_dir = self.sessions_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        messages_path = session_dir / "messages.jsonl"
        with messages_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(message, ensure_ascii=False) + "\n")

        sessions[session_id]["updated_at"] = now
        sessions[session_id]["message_count"] = sessions[session_id].get("message_count", 0) + 1
        self._save_sessions(sessions)
        return message

    def append_event(
        self,
        *,
        session_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if self.get_session(session_id) is None:
            raise KeyError(f"Unknown session: {session_id}")
        event = {
            "id": uuid4().hex,
            "session_id": session_id,
            "type": event_type,
            "payload": payload,
            "created_at": datetime.now(UTC).isoformat(),
        }
        session_dir = self.sessions_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        with (session_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    def list_messages(self, session_id: str) -> list[dict[str, Any]]:
        messages_path = self.sessions_dir / session_id / "messages.jsonl"
        if not messages_path.exists():
            return []
        return [
            json.loads(line)
            for line in messages_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def _load_sessions(self) -> dict[str, dict[str, Any]]:
        if not self.index_path.exists():
            return {}
        payload = json.loads(self.index_path.read_text(encoding="utf-8"))
        return {record["id"]: record for record in payload.get("sessions", [])}

    def _save_sessions(self, sessions: dict[str, dict[str, Any]]) -> None:
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        payload = {"sessions": list(sessions.values())}
        self.index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _default_title(mode: str) -> str:
        labels = {
            "analysis": "数据分析会话",
            "machine-learning": "机器学习会话",
            "evolution": "自进化知识会话",
        }
        return labels.get(mode, "Agent 会话")
