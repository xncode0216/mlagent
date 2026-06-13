import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


def _ordered_existing_columns(df: pd.DataFrame, columns: list[Any], *, exclude: set[str]) -> list[str]:
    result: list[str] = []
    for column in columns:
        name = str(column)
        if name in df.columns and name not in exclude and name not in result:
            result.append(name)
    return result


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _numeric_transform(series: pd.Series, *, scale: bool) -> tuple[pd.Series, dict[str, Any]]:
    numeric = pd.to_numeric(series, errors="coerce")
    median = numeric.median()
    if pd.isna(median):
        median = 0.0
    filled = numeric.fillna(float(median))
    mean = float(filled.mean()) if len(filled) else 0.0
    std = float(filled.std(ddof=0)) if len(filled) else 0.0
    if scale and std > 0:
        transformed = (filled - mean) / std
    elif scale:
        transformed = filled * 0
    else:
        transformed = filled
    return transformed, {
        "imputer": "median",
        "fill_value": float(median),
        "scaler": "standard" if scale else "none",
        "mean": mean,
        "std": std,
    }


def _categorical_transform(series: pd.Series) -> tuple[pd.Series, dict[str, Any]]:
    mode = series.mode(dropna=True)
    fill_value = str(mode.iloc[0]) if not mode.empty else "__missing__"
    transformed = series.fillna(fill_value).astype(str)
    return transformed, {
        "imputer": "most_frequent",
        "fill_value": fill_value,
        "encoder": "one_hot_ignore_unknown",
    }


def execute_preprocessing_plan(
    *,
    csv_path: Path,
    plan_path: Path,
    output_path: Path,
    dataset_path: str | None = None,
    plan_project_path: str | None = None,
    output_project_path: str | None = None,
) -> dict[str, Any]:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    df = pd.read_csv(csv_path)

    target_column = str(plan.get("target_column") or "")
    if not target_column:
        raise ValueError("Preprocessing plan does not define a target column")
    if target_column not in df.columns:
        raise ValueError("Target column from preprocessing plan was not found in the dataset")

    drop_columns = _ordered_existing_columns(
        df,
        list(plan.get("drop_columns") or []),
        exclude={target_column},
    )
    excluded = {target_column, *drop_columns}
    numeric_features = _ordered_existing_columns(
        df,
        list(plan.get("numeric_features") or []),
        exclude=excluded,
    )
    categorical_features = _ordered_existing_columns(
        df,
        list(plan.get("categorical_features") or []),
        exclude={target_column, *drop_columns, *numeric_features},
    )
    planned_features = [*numeric_features, *categorical_features]
    if not planned_features:
        planned_features = [column for column in df.columns if column not in excluded]
        numeric_features = [
            column for column in planned_features if pd.api.types.is_numeric_dtype(df[column])
        ]
        categorical_features = [column for column in planned_features if column not in numeric_features]

    output = pd.DataFrame(index=df.index)
    transformations: dict[str, Any] = {
        "dropped": {column: plan.get("drop_reasons", {}).get(column, "planned_drop") for column in drop_columns},
        "numeric": {},
        "categorical": {},
    }

    numeric_step = plan.get("steps", {}).get("numeric", {}) if isinstance(plan.get("steps"), dict) else {}
    scale_numeric = numeric_step.get("scaler") == "standard"
    for column in numeric_features:
        transformed, summary = _numeric_transform(df[column], scale=scale_numeric)
        output[column] = transformed
        transformations["numeric"][column] = summary

    categorical_frame = pd.DataFrame(index=df.index)
    for column in categorical_features:
        transformed, summary = _categorical_transform(df[column])
        transformations["categorical"][column] = summary
        categorical_frame[column] = transformed
    if not categorical_frame.empty:
        encoded = pd.get_dummies(categorical_frame, columns=categorical_features, dtype=int)
        output = pd.concat([output, encoded], axis=1)

    if output.shape[1] == 0:
        raise ValueError("Preprocessing plan produced no feature columns")

    output[target_column] = df[target_column].reset_index(drop=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(output_path, index=False)

    return {
        "source_dataset_path": dataset_path or str(csv_path),
        "preprocessing_plan_path": plan_project_path or str(plan_path),
        "output_dataset_path": output_project_path or str(output_path),
        "target_column": target_column,
        "input_shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
        "output_shape": {"rows": int(output.shape[0]), "columns": int(output.shape[1])},
        "drop_columns": drop_columns,
        "numeric_features": numeric_features,
        "categorical_features": categorical_features,
        "encoded_feature_columns": [column for column in output.columns if column != target_column],
        "transformations": _json_safe(transformations),
        "created_at": datetime.now(UTC).isoformat(),
    }
