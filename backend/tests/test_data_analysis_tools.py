from pathlib import Path

import pandas as pd

from app.tools.data_analysis.correlation_matrix import correlation_matrix
from app.tools.data_analysis.data_quality_profile import data_quality_profile
from app.tools.data_analysis.detect_missing import detect_missing
from app.tools.data_analysis.execute_preprocessing_plan import execute_preprocessing_plan
from app.tools.data_analysis.plot_distribution import plot_distribution
from app.tools.data_analysis.preprocessing_plan import preprocessing_plan
from app.tools.data_analysis.profile_dataset import profile_dataset


def write_sample_csv(path: Path):
    df = pd.DataFrame(
        {
            "age": [20, 30, None],
            "monthly_charges": [50.0, 80.0, 90.0],
            "churn": [0, 1, 1],
        }
    )
    df.to_csv(path, index=False)


def test_profile_dataset(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = profile_dataset(csv_path)
    assert result["row_count"] == 3
    assert result["column_count"] == 3
    assert result["columns"]["age"]["dtype"] in {"float64", "Float64"}


def test_data_quality_profile_summarizes_columns_and_targets(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = data_quality_profile(csv_path)
    age_profile = next(column for column in result["columns"] if column["name"] == "age")
    churn_candidate = result["target_candidates"][0]

    assert result["row_count"] == 3
    assert result["missing_cells"] == 1
    assert age_profile["kind"] == "numeric"
    assert age_profile["missing_count"] == 1
    assert "has_missing" in age_profile["quality_flags"]
    assert churn_candidate["column"] == "churn"
    assert "name_matches_target_hint" in churn_candidate["reasons"]


def test_preprocessing_plan_builds_reproducible_sklearn_strategy(tmp_path: Path):
    csv_path = tmp_path / "customer_churn.csv"
    pd.DataFrame(
        {
            "customer_id": ["c1", "c2", "c3", "c4"],
            "age": [20, None, 42, 55],
            "contract": ["monthly", "annual", None, "monthly"],
            "churn": ["no", "yes", "no", "yes"],
        }
    ).to_csv(csv_path, index=False)

    result = preprocessing_plan(csv_path)

    assert result["target_column"] == "churn"
    assert result["feature_columns"] == ["age", "contract"]
    assert result["drop_columns"] == ["customer_id"]
    assert result["numeric_features"] == ["age"]
    assert result["categorical_features"] == ["contract"]
    assert result["steps"]["numeric"]["imputer"] == "median"
    assert result["steps"]["categorical"]["encoder"] == "one_hot_ignore_unknown"
    assert "ColumnTransformer" in result["sklearn_pipeline"]


def test_preprocessing_plan_keeps_unique_small_sample_numeric_features(tmp_path: Path):
    csv_path = tmp_path / "customer_churn.csv"
    pd.DataFrame(
        {
            "age": [42, 37, 55],
            "income": [86000, 72000, 91000],
            "churn": [1, 0, 0],
        }
    ).to_csv(csv_path, index=False)

    result = preprocessing_plan(csv_path)

    assert result["target_column"] == "churn"
    assert result["feature_columns"] == ["age", "income"]
    assert result["drop_columns"] == []
    assert result["numeric_features"] == ["age", "income"]


def test_execute_preprocessing_plan_writes_transformed_dataset(tmp_path: Path):
    csv_path = tmp_path / "customer_churn.csv"
    csv_path.write_text(
        "customer_id,age,contract,churn\n"
        "c1,20,monthly,no\n"
        "c2,,annual,yes\n"
        "c3,40,,no\n",
        encoding="utf-8",
    )
    plan_path = tmp_path / "preprocessing_plan.json"
    plan_path.write_text(
        """{
  "target_column": "churn",
  "drop_columns": ["customer_id"],
  "drop_reasons": {"customer_id": "identifier_like"},
  "numeric_features": ["age"],
  "categorical_features": ["contract"],
  "steps": {
    "numeric": {"imputer": "median", "scaler": "standard"},
    "categorical": {"imputer": "most_frequent", "encoder": "one_hot_ignore_unknown"}
  }
}""",
        encoding="utf-8",
    )
    output_path = tmp_path / "results" / "customer_churn_planned.csv"

    summary = execute_preprocessing_plan(
        csv_path=csv_path,
        plan_path=plan_path,
        output_path=output_path,
        dataset_path="data/customer_churn.csv",
        plan_project_path="results/session/preprocessing_plan.json",
        output_project_path="results/session/customer_churn_planned.csv",
    )

    transformed = pd.read_csv(output_path)
    assert summary["source_dataset_path"] == "data/customer_churn.csv"
    assert summary["output_dataset_path"] == "results/session/customer_churn_planned.csv"
    assert summary["drop_columns"] == ["customer_id"]
    assert summary["output_shape"]["rows"] == 3
    assert "customer_id" not in transformed.columns
    assert "age" in transformed.columns
    assert "contract_monthly" in transformed.columns
    assert "contract_annual" in transformed.columns
    assert transformed["churn"].tolist() == ["no", "yes", "no"]


def test_detect_missing(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = detect_missing(csv_path)
    assert result["columns"]["age"]["missing_count"] == 1


def test_correlation_matrix(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = correlation_matrix(csv_path)
    assert "monthly_charges" in result["columns"]
    assert len(result["matrix"]) == 3


def test_plot_distribution_returns_histogram_bins(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = plot_distribution(csv_path, column="monthly_charges", bins=2)
    assert result["chart_type"] == "histogram"
    assert result["column"] == "monthly_charges"
    assert len(result["bins"]) == 2
    assert sum(bin_item["count"] for bin_item in result["bins"]) == 3
    assert result["summary"]["non_null_count"] == 3
