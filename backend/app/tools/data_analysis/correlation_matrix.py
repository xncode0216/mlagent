from pathlib import Path
from typing import Any

import pandas as pd


def correlation_matrix(csv_path: Path) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    numeric_df = df.select_dtypes(include="number")
    corr = numeric_df.corr(numeric_only=True).fillna(0)
    return {
        "columns": list(corr.columns),
        "matrix": corr.round(4).values.tolist(),
    }
