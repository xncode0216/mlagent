from pathlib import Path

from app.services.artifact_service import ArtifactService


def test_writes_json_artifact(tmp_path: Path):
    service = ArtifactService(tmp_path)
    artifact = service.write_json(
        project_id="project-1",
        session_id="session-1",
        artifact_type="dataframe",
        name="profile.json",
        payload={"row_count": 3},
    )
    assert artifact.path.exists()
    assert artifact.metadata["type"] == "dataframe"
