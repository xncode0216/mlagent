import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4


@dataclass
class ArtifactRecord:
    id: str
    path: Path
    metadata: dict[str, Any]


class ArtifactService:
    def __init__(self, project_root: Path):
        self.project_root = project_root

    def write_json(
        self,
        project_id: str,
        session_id: str,
        artifact_type: str,
        name: str,
        payload: dict[str, Any],
    ) -> ArtifactRecord:
        artifact_id = uuid4().hex
        artifact_dir = self.project_root / "results" / session_id
        artifact_dir.mkdir(parents=True, exist_ok=True)
        path = artifact_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return ArtifactRecord(
            id=artifact_id,
            path=path,
            metadata={
                "id": artifact_id,
                "project_id": project_id,
                "session_id": session_id,
                "type": artifact_type,
                "name": name,
            },
        )
