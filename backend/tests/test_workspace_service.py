from pathlib import Path

import pytest

from app.services.workspace_service import WorkspaceService


def test_project_root_is_created_under_workspace(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    assert root == tmp_path / "user-1" / "project-1"
    assert root.exists()


def test_safe_path_allows_nested_project_file(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    path = service.resolve_project_path(root, "data/example.csv")
    assert path == root / "data" / "example.csv"


def test_safe_path_blocks_parent_escape(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    with pytest.raises(ValueError, match="escapes project workspace"):
        service.resolve_project_path(root, "../secret.txt")
