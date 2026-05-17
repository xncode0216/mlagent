from pathlib import Path
from typing import Any

import pandas as pd


def plot_distribution(csv_path: Path, column: str | None = None, bins: int = 10) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    numeric_df = df.select_dtypes(include="number")
    if numeric_df.empty:
        return {
            "chart_type": "histogram",
            "column": None,
            "bins": [],
            "summary": {},
            "message": "No numeric columns available for distribution plot.",
        }

    target_column = column if column in numeric_df.columns else str(numeric_df.columns[0])
    series = numeric_df[target_column].dropna()
    if series.empty:
        return {
            "chart_type": "histogram",
            "column": target_column,
            "bins": [],
            "summary": {
                "missing_count": int(numeric_df[target_column].isna().sum()),
                "non_null_count": 0,
            },
            "message": "Selected numeric column has no non-null values.",
        }

    counts = pd.cut(series, bins=min(bins, max(1, int(series.nunique()))), include_lowest=True).value_counts().sort_index()
    histogram_bins = [
        {
            "start": float(interval.left),
            "end": float(interval.right),
            "count": int(count),
        }
        for interval, count in counts.items()
    ]
    return {
        "chart_type": "histogram",
        "column": target_column,
        "bins": histogram_bins,
        "summary": {
            "min": float(series.min()),
            "max": float(series.max()),
            "mean": float(series.mean()),
            "median": float(series.median()),
            "missing_count": int(numeric_df[target_column].isna().sum()),
            "non_null_count": int(series.count()),
        },
    }
