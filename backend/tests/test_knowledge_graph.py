from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.services.evolution_service import EvolutionService
from app.services.experiment_service import ExperimentService


def test_knowledge_graph_and_advanced_insights(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    # 1. Create a project
    project = client.post("/api/projects", json={"name": "test_graph_project"}).json()
    project_id = project["id"]
    project_root = tmp_path / "dev-user" / project_id

    # Create dummy dataset CSV to test column detection
    data_dir = project_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    csv_file = data_dir / "sales.csv"
    csv_file.write_text(
        "monthly_charges,tenure,churn\n100,12,0\n50,24,0\n150,6,1\n",
        encoding="utf-8"
    )

    # 2. Record a high-accuracy Sklearn experiment run
    exp_service = ExperimentService(project_root)
    exp_service.record_run(
        project_id=project_id,
        experiment_id="exp_999",
        engine="sklearn",
        dataset_path="data/sales.csv",
        target_column="churn",
        use_gpu=False,
        metrics={"accuracy": 0.95},
        model={"algorithm": "random_forest", "feature_columns": ["monthly_charges", "tenure"]},
        candidate_runs=[],
        model_artifact={"type": "model", "name": "rf.pkl", "path": "models/rf.pkl"},
        metrics_artifact={"id": "artifact_metrics", "type": "training", "name": "metrics.json", "path": "results/metrics.json"}
    )

    # 3. Create a self-evolution rule that is ADOPTED (should trigger surprise connection)
    evo_service = EvolutionService(project_root)
    lesson = evo_service.create_lesson(
        source_type="session",
        source_id="session_123",
        domain=["monthly_charges"],
        observation="Monthly charges is extremely predictive.",
        recommendation="Use monthly charges as a core feature.",
        confidence=0.9,
        title="Predictive Monthly Charges"
    )
    evo_service.adopt_lesson(lesson.id)

    # 4. Request the knowledge graph API
    response = client.get(f"/api/projects/{project_id}/evolution/graph")
    assert response.status_code == 200
    graph = response.json()

    # 5. Assert nodes
    nodes = graph["nodes"]
    node_ids = [node["id"] for node in nodes]
    node_types = [node["type"] for node in nodes]

    # Verify column nodes
    assert "col_monthly_charges" in node_ids
    assert "col_tenure" in node_ids
    assert "col_churn" in node_ids
    assert "column" in node_types

    # Verify experiment nodes
    assert "exp_exp_999" in node_ids
    assert "experiment" in node_types

    # Verify rule nodes
    assert f"rule_{lesson.id}" in node_ids
    assert "rule" in node_types

    # 6. Assert edges
    edges = graph["edges"]
    assert len(edges) > 0
    edge_sources = [edge["source"] for edge in edges]
    edge_targets = [edge["target"] for edge in edges]

    # Verify model predictive direction
    assert "exp_exp_999" in edge_sources
    assert "col_churn" in edge_targets

    # Verify features point to experiment
    assert "col_monthly_charges" in edge_sources
    assert "exp_exp_999" in edge_targets

    # 7. Assert Advanced Insights
    insights = graph["insights"]
    assert len(insights) > 0

    insight_types = [insight["type"] for insight in insights]

    # 'churn' target has adopted rule (Predictive Monthly Charges has domain monthly_charges which doesn't equal churn)
    # We should have a Knowledge Gap for 'churn' target columns with no adopted rules referencing 'churn'
    assert "knowledge_gap" in insight_types
    churn_gap = next(i for i in insights if i["type"] == "knowledge_gap")
    assert "churn" in churn_gap["title"]

    # 'monthly_charges' was adopted, and monthly_charges is a feature in a >0.8 acc experiment (Acc = 0.95)
    # This should trigger a Surprise Connection
    assert "surprise_connection" in insight_types
    surprise = next(i for i in insights if i["type"] == "surprise_connection")
    assert "monthly_charges" in surprise["description"]
