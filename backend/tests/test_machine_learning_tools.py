from pathlib import Path

import pytest

from app.tools.machine_learning.train_baseline import train_baseline_classifier


def test_train_baseline_classifier_finds_numeric_threshold(tmp_path: Path):
    csv_path = tmp_path / "training.csv"
    csv_path.write_text(
        "score,age,churn\n0.1,25,no\n0.2,30,no\n0.8,45,yes\n0.9,50,yes\n",
        encoding="utf-8",
    )

    result = train_baseline_classifier(csv_path, target_column="churn")

    assert result["model"]["strategy"] == "numeric_threshold"
    assert result["model"]["feature"] == "score"
    assert result["metrics"]["accuracy"] == 1.0
    assert result["metrics"]["row_count"] == 4
    assert result["target_column"] == "churn"
    assert [run["model_name"] for run in result["runs"]] == [
        "majority_class",
        "numeric_threshold:score",
        "numeric_threshold:age",
    ]
    assert result["runs"][0]["metrics"]["accuracy"] == 0.5
    assert result["runs"][1]["metrics"]["accuracy"] == 1.0
    assert result["runs"][2]["metrics"]["accuracy"] == 1.0


def test_train_baseline_classifier_rejects_missing_target(tmp_path: Path):
    csv_path = tmp_path / "training.csv"
    csv_path.write_text("score,label\n0.1,no\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Target column was not found"):
        train_baseline_classifier(csv_path, target_column="churn")
