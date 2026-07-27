import json
from datetime import UTC, datetime
from pathlib import Path

from app.schemas.project import ProjectRead


class ProjectRegistryService:
    def __init__(self, workspace_root: Path, user_id: str, workspace_key: str | None = None):
        self.workspace_root = workspace_root.resolve()
        self.user_id = user_id
        self.workspace_key = workspace_key or user_id
        self.user_root = self.workspace_root / self.workspace_key
        self.registry_path = self.user_root / "projects.json"

    def load_projects(self) -> dict[str, ProjectRead]:
        if not self.registry_path.exists():
            return {}
        payload = json.loads(self.registry_path.read_text(encoding="utf-8"))
        projects = payload.get("projects", [])
        normalized = []
        for item in projects:
            now = datetime.now(UTC).isoformat()
            item.setdefault("created_at", now)
            item.setdefault("updated_at", item["created_at"])
            project = ProjectRead(**item)
            if project.owner_id == self.user_id:
                normalized.append(project)
        return {project.id: project for project in normalized}

    def save_project(self, project: ProjectRead) -> None:
        if project.owner_id != self.user_id:
            raise ValueError("Project owner does not match registry owner")
        projects = self.load_projects()
        projects[project.id] = project
        self.user_root.mkdir(parents=True, exist_ok=True)
        payload = {
            "user_id": self.user_id,
            "projects": [project.model_dump() for project in projects.values()],
        }
        self.registry_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
