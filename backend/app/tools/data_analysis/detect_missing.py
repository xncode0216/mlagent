from pathlib import Path
from typing import Any

import pandas as pd


def detect_missing(csv_path: Path) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    columns = {}
    for column in df.columns:
        missing_count = int(df[column].isna().sum())
        columns[column] = {
            "missing_count": missing_count,
            "missing_ratio": float(missing_count / len(df)) if len(df) else 0.0,
        }
    return {"columns": columns}
