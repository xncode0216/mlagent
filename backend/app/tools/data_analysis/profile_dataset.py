from pathlib import Path
from typing import Any

import pandas as pd


def profile_dataset(csv_path: Path, sample_rows: int = 20) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    return {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": {
            column: {
                "dtype": str(df[column].dtype),
                "missing_count": int(df[column].isna().sum()),
                "missing_ratio": float(df[column].isna().mean()),
            }
            for column in df.columns
        },
        "sample": df.head(sample_rows).to_dict(orient="records"),
    }
