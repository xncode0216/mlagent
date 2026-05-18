from pathlib import Path


class WorkspaceService:
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root.resolve()

    def ensure_project_root(self, user_id: str, project_id: str) -> Path:
        root = (self.workspace_root / user_id / project_id).resolve()
        self.ensure_project_structure(root)
        return root

    def ensure_project_structure(self, root: Path) -> Path:
        root.mkdir(parents=True, exist_ok=True)
        for child in ["data", "notebooks", "results", "models", "agent_schema", "evolution", "logs"]:
            (root / child).mkdir(exist_ok=True)
        return root

    def resolve_project_path(self, project_root: Path, relative_path: str) -> Path:
        root = project_root.resolve()
        candidate = (root / relative_path).resolve()
        if root != candidate and root not in candidate.parents:
            raise ValueError(f"Path escapes project workspace: {relative_path}")
        return candidate
