from pathlib import Path

import pandas as pd

from app.tools.data_analysis.correlation_matrix import correlation_matrix
from app.tools.data_analysis.detect_missing import detect_missing
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
