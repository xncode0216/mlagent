import json
from pathlib import Path

from app.schemas.project import ProjectRead


class ProjectRegistryService:
    def __init__(self, workspace_root: Path, user_id: str):
        self.workspace_root = workspace_root.resolve()
        self.user_id = user_id
        self.user_root = self.workspace_root / self.user_id
        self.registry_path = self.user_root / "projects.json"

    def load_projects(self) -> dict[str, ProjectRead]:
        if not self.registry_path.exists():
            return {}
        payload = json.loads(self.registry_path.read_text(encoding="utf-8"))
        projects = payload.get("projects", [])
        return {item["id"]: ProjectRead(**item) for item in projects}

    def save_project(self, project: ProjectRead) -> None:
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
