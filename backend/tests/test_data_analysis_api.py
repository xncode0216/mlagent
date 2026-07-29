import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_generate_analysis_report_writes_markdown_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,,0\n55,91.0,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/report",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "report-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"]["type"] == "report"
    assert payload["artifact"]["path"] == "results/report-session/analysis_report.md"
    assert payload["artifact"]["metadata"]["dataset_path"] == "data/customer_churn.csv"
    report_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    report = report_path.read_text(encoding="utf-8")
    assert "# 数据分析报告" in report
    assert "data/customer_churn.csv" in report
    assert "行数: 3" in report
    assert "列数: 3" in report
    assert "monthly_charges" in report


def test_generate_analysis_report_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/report",
        json={"dataset_path": "../escape.csv", "session_id": "report-session"},
    )

    assert response.status_code == 400


def test_generate_data_profile_writes_quality_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,monthly_charges,churn\n42,70.7,1\n37,,0\n55,91.0,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/profile",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "profile-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["artifact"]["type"] == "dataframe"
    assert payload["artifact"]["path"] == "results/profile-session/data_quality_profile.json"
    assert payload["artifact"]["metadata"]["profile_type"] == "data_quality"
    assert payload["profile"]["row_count"] == 3
    assert payload["profile"]["missing_cells"] == 1
    assert payload["profile"]["target_candidates"][0]["column"] == "churn"

    profile_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    profile = profile_path.read_text(encoding="utf-8")
    assert "data_quality" not in profile
    assert "monthly_charges" in profile


def test_generate_preprocessing_plan_writes_plan_and_pipeline_script(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "customer_id,age,contract,churn\n"
        "c1,42,Month-to-month,No\n"
        "c2,,One year,Yes\n"
        "c3,55,,No\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plan"]["target_column"] == "churn"
    assert payload["plan"]["drop_columns"] == ["customer_id"]
    assert payload["plan"]["numeric_features"] == ["age"]
    assert payload["plan"]["categorical_features"] == ["contract"]
    assert payload["plan_artifact"]["path"] == "results/feature-session/preprocessing_plan.json"
    assert payload["pipeline_artifact"]["path"] == "notebooks/feature-session_preprocessing_pipeline.py"

    plan_path = Path(project["workspace_path"]) / payload["plan_artifact"]["path"]
    plan = plan_path.read_text(encoding="utf-8")
    assert "ColumnTransformer" in plan
    assert "customer_id" in plan

    script_path = Path(project["workspace_path"]) / payload["pipeline_artifact"]["path"]
    script = script_path.read_text(encoding="utf-8")
    assert "SimpleImputer(strategy='median')" in script
    assert "OneHotEncoder(handle_unknown='ignore'" in script
    assert "customer_churn_preprocessed.csv" in script


def test_generate_preprocessing_plan_applies_a_feature_selection(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,contract,churn\n"
        "42,86000,Month-to-month,No\n"
        "37,72000,One year,Yes\n"
        "55,91000,Two year,No\n"
        "29,64000,Month-to-month,Yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "feature-session",
            "selected_features": ["age", "contract"],
        },
    )

    assert response.status_code == 200
    plan = response.json()["plan"]
    assert plan["feature_columns"] == ["age", "contract"]
    assert plan["drop_columns"] == ["income"]
    assert plan["drop_reasons"]["income"] == "deselected"

    # 重新生成的脚本必须与计划一致，否则执行与训练会用上不同的特征集
    script_path = Path(project["workspace_path"]) / "notebooks/feature-session_preprocessing_pipeline.py"
    script = script_path.read_text(encoding="utf-8")
    assert "numeric_features = ['age']" in script
    assert "categorical_features = ['contract']" in script


def test_generate_preprocessing_plan_applies_an_explicit_target_column(tmp_path, monkeypatch):
    """推断只是启发式，猜错时用户要能纠正——而纠正必须重算整份计划。

    `churn` 名字命中目标提示又在末列，推断必然选它；这里改选 `contract`，
    于是 churn 反过来变成一个普通特征，drop/feature/steps 全部跟着重算。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,contract,churn\n"
        "42,86000,Month-to-month,No\n"
        "37,72000,One year,Yes\n"
        "55,91000,Two year,No\n"
        "29,64000,Month-to-month,Yes\n",
        encoding="utf-8",
    )

    inferred = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "inferred-session"},
    )
    assert inferred.json()["plan"]["target_column"] == "churn"

    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "target-session",
            "target_column": "contract",
        },
    )

    assert response.status_code == 200
    plan = response.json()["plan"]
    assert plan["target_column"] == "contract"
    assert plan["steps"]["target"]["column"] == "contract"
    assert "churn" in plan["feature_columns"]
    assert "contract" not in plan["feature_columns"]

    # 派生产物必须跟着走，否则执行与训练会用上和计划不一致的目标列
    script = (Path(project["workspace_path"]) / "notebooks/target-session_preprocessing_pipeline.py").read_text(
        encoding="utf-8"
    )
    assert "target_column = 'contract'" in script


def test_generate_preprocessing_plan_rejects_a_target_column_the_dataset_lacks(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text("age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n", encoding="utf-8")

    # 放行只会把失败推迟到训练时，那里的报错离用户更远
    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "target-session",
            "target_column": "not_a_column",
        },
    )

    assert response.status_code == 400
    assert "not_a_column" in response.json()["detail"]


def test_generate_preprocessing_plan_rejects_an_empty_feature_selection(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n",
        encoding="utf-8",
    )

    # 空选择会让训练侧的“无计划特征则用全部列”回退悄悄改用全部特征，必须直接拒绝
    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "feature-session",
            "selected_features": [],
        },
    )

    assert response.status_code == 400
    assert "feature" in response.json()["detail"].lower()


def test_generate_preprocessing_plan_keeps_default_sample_features(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "age,income,churn\n42,86000,1\n37,72000,0\n55,91000,0\n",
        encoding="utf-8",
    )

    plan_response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )
    plan_path = plan_response.json()["plan_artifact"]["path"]
    execute_response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={"preprocessing_plan_path": plan_path, "session_id": "feature-session"},
    )

    assert plan_response.status_code == 200
    assert plan_response.json()["plan"]["feature_columns"] == ["age", "income"]
    assert execute_response.status_code == 200
    assert execute_response.json()["summary"]["encoded_feature_columns"] == ["age", "income"]


def test_planned_strategies_actually_change_the_transformed_dataset(tmp_path, monkeypatch):
    """策略必须真的被执行器消费，而不只是写在计划里。

    此前 `steps` 四个策略字段只有 `scaler` 有消费方：改 `imputer` 不会改变任何行为，
    而变换报告仍回报硬编码的 `median`——计划在说谎。这里用同一份数据跑两种策略，
    断言产出的数值确实不同。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    root = Path(project["workspace_path"])
    # age 的中位数 30、均值 40：两种填充策略给出的结果必然不同
    (root / "data" / "customer_churn.csv").write_text(
        "age,contract,churn\n10,a,No\n30,b,Yes\n80,a,No\n,b,Yes\n",
        encoding="utf-8",
    )

    def plan_and_execute(session: str, **strategies: str) -> list[str]:
        plan = client.post(
            f"/api/projects/{project['id']}/analysis/preprocess-plan",
            json={"dataset_path": "data/customer_churn.csv", "session_id": session, **strategies},
        )
        assert plan.status_code == 200, plan.text
        executed = client.post(
            f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
            json={
                "dataset_path": "data/customer_churn.csv",
                "preprocessing_plan_path": plan.json()["plan_artifact"]["path"],
                "session_id": session,
            },
        )
        assert executed.status_code == 200, executed.text
        transformed = (root / executed.json()["transformed_data_artifact"]["path"]).read_text(encoding="utf-8")
        header, *rows = transformed.splitlines()
        age_index = header.split(",").index("age")
        return [row.split(",")[age_index] for row in rows]

    # 均值填充 + 不缩放：缺失的 age 被填成 40，其余原样保留
    unscaled = plan_and_execute("mean-session", numeric_imputer="mean", numeric_scaler="none")
    assert unscaled == ["10.0", "30.0", "80.0", "40.0"]

    # 中位数填充 + minmax：缺失填 30，再线性压到 [0, 1]
    scaled = plan_and_execute("minmax-session", numeric_imputer="median", numeric_scaler="minmax")
    assert scaled[0] == "0.0" and scaled[2] == "1.0"
    assert scaled != unscaled

    # 报告回报的必须是真正用上的策略，而不是常量
    report = json.loads(
        (root / "results" / "mean-session" / "preprocessing_transform_report.json").read_text(encoding="utf-8")
    )
    assert report["transformations"]["numeric"]["age"] == {
        "imputer": "mean",
        "fill_value": 40.0,
        "scaler": "none",
        "mean": 40.0,
        "std": pytest.approx(25.495, rel=1e-3),
    }


def test_generate_preprocessing_plan_rejects_an_unsupported_strategy(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (Path(project["workspace_path"]) / "data" / "customer_churn.csv").write_text(
        "age,churn\n42,1\n37,0\n55,0\n", encoding="utf-8"
    )

    # 静默忽略不认识的策略会让计划与实际行为不一致，这正是本轮要消灭的谎报
    response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "bad-strategy",
            "numeric_imputer": "magic",
        },
    )

    assert response.status_code == 400
    assert "magic" in response.json()["detail"]


def test_pipeline_script_follows_the_planned_strategies(tmp_path, monkeypatch):
    """脚本是"可复现"的凭据，它必须与计划一致，否则用户拿到的脚本跑出来是另一回事。"""
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    (Path(project["workspace_path"]) / "data" / "customer_churn.csv").write_text(
        "age,contract,churn\n42,a,1\n37,b,0\n55,a,0\n", encoding="utf-8"
    )

    client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "session_id": "script-session",
            "numeric_imputer": "zero",
            "numeric_scaler": "none",
            "categorical_imputer": "constant",
        },
    )

    script = (
        Path(project["workspace_path"]) / "notebooks" / "script-session_preprocessing_pipeline.py"
    ).read_text(encoding="utf-8")
    assert "SimpleImputer(strategy='constant', fill_value=0)" in script
    assert "SimpleImputer(strategy='constant', fill_value='__missing__')" in script
    # scaler 选 none 时不该留下一个空转的缩放步骤
    assert "StandardScaler()" not in script
    assert "MinMaxScaler()" not in script


def test_execute_preprocessing_plan_writes_dataset_summary_and_report(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "customer_id,age,contract,churn\n"
        "c1,42,Month-to-month,No\n"
        "c2,,One year,Yes\n"
        "c3,55,,No\n",
        encoding="utf-8",
    )
    plan_response = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "feature-session"},
    )
    plan_path = plan_response.json()["plan_artifact"]["path"]

    response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "preprocessing_plan_path": plan_path,
            "session_id": "feature-session",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["target_column"] == "churn"
    assert payload["summary"]["preprocessing_plan_path"] == plan_path
    assert payload["transformed_data_artifact"]["path"] == "results/feature-session/customer_churn_planned.csv"
    assert payload["transformed_data_artifact"]["metadata"]["artifact_role"] == "preprocessed_dataset"
    assert payload["summary_artifact"]["path"] == "results/feature-session/preprocessing_transform_report.json"
    assert payload["report_artifact"]["path"] == "results/feature-session/preprocessing_transform_report.md"

    transformed_path = Path(project["workspace_path"]) / payload["transformed_data_artifact"]["path"]
    transformed = transformed_path.read_text(encoding="utf-8")
    assert "customer_id" not in transformed
    assert "age" in transformed
    assert "contract_Month-to-month" in transformed
    assert "churn" in transformed

    report_path = Path(project["workspace_path"]) / payload["report_artifact"]["path"]
    report = report_path.read_text(encoding="utf-8")
    assert "# Preprocessing Transformation Report" in report
    assert "customer_churn_planned.csv" in report
    assert plan_path in report


def test_execute_preprocessing_plan_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={
            "dataset_path": "../escape.csv",
            "preprocessing_plan_path": "results/plan/preprocessing_plan.json",
            "session_id": "feature-session",
        },
    )

    assert response.status_code == 400


def test_clean_dataset_writes_cleaned_csv_and_script(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn.csv"
    dataset_path.write_text(
        "id,age,contract,churn\n1,42,Month-to-month,1\n2,,One year,0\n3,55,,0\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/clean",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "clean-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cleaned_data_artifact"]["path"] == "results/clean-session/customer_churn_cleaned.csv"
    assert payload["cleaned_data_artifact"]["metadata"]["dataset_path"] == "data/customer_churn.csv"
    assert payload["cleaned_data_artifact"]["metadata"]["fill_values"]["numeric"]["age"] == 48.5
    assert payload["script_artifact"]["path"] == "notebooks/clean-session_cleaning.py"

    cleaned_path = Path(project["workspace_path"]) / payload["cleaned_data_artifact"]["path"]
    cleaned = cleaned_path.read_text(encoding="utf-8")
    assert ",48.5," in cleaned
    assert "Month-to-month" in cleaned
    assert ",0\n" in cleaned

    script_path = Path(project["workspace_path"]) / payload["script_artifact"]["path"]
    script = script_path.read_text(encoding="utf-8")
    assert "fillna" in script
    assert "customer_churn_cleaned.csv" in script


def test_clean_dataset_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/clean",
        json={"dataset_path": "../escape.csv", "session_id": "clean-session"},
    )

    assert response.status_code == 400


def test_handoff_dataset_to_ml_writes_handoff_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    dataset_path = Path(project["workspace_path"]) / "data" / "customer_churn_cleaned.csv"
    dataset_path.write_text(
        "customer_id,monthly_charges,total_charges,churn\n1,29.85,100.0,No\n2,56.95,300.0,Yes\n",
        encoding="utf-8",
    )

    response = client.post(
        f"/api/projects/{project['id']}/analysis/handoff-to-ml",
        json={"dataset_path": "data/customer_churn_cleaned.csv", "session_id": "handoff-session"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "machine-learning"
    assert payload["dataset_path"] == "data/customer_churn_cleaned.csv"
    assert payload["recommended_target_column"] == "churn"
    assert payload["artifact"]["path"] == "results/handoff-session/ml_handoff.json"

    handoff_path = Path(project["workspace_path"]) / payload["artifact"]["path"]
    handoff = handoff_path.read_text(encoding="utf-8")
    assert "customer_churn_cleaned.csv" in handoff
    assert "churn" in handoff


def test_handoff_dataset_to_ml_rejects_path_escape(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/analysis/handoff-to-ml",
        json={"dataset_path": "../escape.csv", "session_id": "handoff-session"},
    )

    assert response.status_code == 400


def test_preview_preprocessing_plan_matches_execution_without_writing_the_dataset(tmp_path, monkeypatch):
    """预览的全部价值是「批准前如实知道会发生什么」，所以它必须与执行说同一套话。

    两者共用同一段变换计算；一旦分成两份实现，预览就会开始说谎，而那时说谎比没有预览
    更糟——用户是照着预览做的批准决定。
    """
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    root = Path(project["workspace_path"])
    (root / "data" / "customer_churn.csv").write_text(
        "customer_id,age,contract,churn\nc1,42,Month-to-month,No\nc2,,One year,Yes\nc3,55,,No\n",
        encoding="utf-8",
    )
    plan_path = client.post(
        f"/api/projects/{project['id']}/analysis/preprocess-plan",
        json={"dataset_path": "data/customer_churn.csv", "session_id": "preview-session"},
    ).json()["plan_artifact"]["path"]

    previewed = client.post(
        f"/api/projects/{project['id']}/analysis/preview-preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "preprocessing_plan_path": plan_path,
            "session_id": "preview-session",
        },
    )
    assert previewed.status_code == 200, previewed.text
    preview = previewed.json()["preview"]

    # 预览不产出数据集；写上 output_dataset_path 就是谎报
    assert preview["preview"] is True
    assert "output_dataset_path" not in preview
    assert not (root / "results" / "preview-session" / "customer_churn_planned.csv").exists()

    executed = client.post(
        f"/api/projects/{project['id']}/analysis/execute-preprocess-plan",
        json={
            "dataset_path": "data/customer_churn.csv",
            "preprocessing_plan_path": plan_path,
            "session_id": "preview-session",
        },
    )
    assert executed.status_code == 200, executed.text
    summary = executed.json()["summary"]

    # 逐字段比对：预览说的每一件事，执行都要照做
    for field in (
        "target_column",
        "input_shape",
        "output_shape",
        "drop_columns",
        "numeric_features",
        "categorical_features",
        "encoded_feature_columns",
        "transformations",
    ):
        assert preview[field] == summary[field], f"预览与执行在 {field} 上不一致"


def test_preview_preprocessing_plan_reports_a_plan_it_cannot_apply(tmp_path, monkeypatch):
    """计划不可执行时预览必须当场说清楚——这正是它该拦住的情形。"""
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)
    project = client.post("/api/projects", json={"name": "sales_churn_analysis"}).json()
    root = Path(project["workspace_path"])
    (root / "data" / "customer_churn.csv").write_text("age,churn\n42,1\n37,0\n", encoding="utf-8")
    plan_file = root / "results" / "broken" / "preprocessing_plan.json"
    plan_file.parent.mkdir(parents=True, exist_ok=True)
    plan_file.write_text(json.dumps({"dataset_path": "data/customer_churn.csv"}), encoding="utf-8")

    response = client.post(
        f"/api/projects/{project['id']}/analysis/preview-preprocess-plan",
        json={"preprocessing_plan_path": "results/broken/preprocessing_plan.json", "session_id": "broken"},
    )

    assert response.status_code == 400
    assert "target column" in response.json()["detail"].lower()
