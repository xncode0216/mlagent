import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from app.tools.data_analysis.preprocessing_strategies import (
    CATEGORICAL_FILL_VALUE,
    strategies_from_steps,
)


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


def _numeric_fill_value(numeric: pd.Series, imputer: str) -> float:
    if imputer == "zero":
        return 0.0
    value = numeric.mean() if imputer == "mean" else numeric.median()
    return 0.0 if pd.isna(value) else float(value)


def _numeric_transform(series: pd.Series, *, imputer: str, scaler: str) -> tuple[pd.Series, dict[str, Any]]:
    numeric = pd.to_numeric(series, errors="coerce")
    fill_value = _numeric_fill_value(numeric, imputer)
    filled = numeric.fillna(fill_value)
    mean = float(filled.mean()) if len(filled) else 0.0
    std = float(filled.std(ddof=0)) if len(filled) else 0.0
    minimum = float(filled.min()) if len(filled) else 0.0
    maximum = float(filled.max()) if len(filled) else 0.0
    if scaler == "standard":
        # 常量列的标准差为 0，按定义整列归零；除以 0 会得到 NaN 并污染下游训练。
        transformed = (filled - mean) / std if std > 0 else filled * 0
    elif scaler == "minmax":
        span = maximum - minimum
        transformed = (filled - minimum) / span if span > 0 else filled * 0
    else:
        transformed = filled
    return transformed, {
        "imputer": imputer,
        "fill_value": fill_value,
        "scaler": scaler,
        "mean": mean,
        "std": std,
        **({"min": minimum, "max": maximum} if scaler == "minmax" else {}),
    }


def _categorical_transform(series: pd.Series, *, imputer: str) -> tuple[pd.Series, dict[str, Any]]:
    if imputer == "constant":
        fill_value = CATEGORICAL_FILL_VALUE
    else:
        mode = series.mode(dropna=True)
        # 整列皆空时没有众数可用，退回占位值——否则 fillna 会拿到 NaN 而什么都没填上
        fill_value = str(mode.iloc[0]) if not mode.empty else CATEGORICAL_FILL_VALUE
    transformed = series.fillna(fill_value).astype(str)
    return transformed, {
        "imputer": imputer,
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

    # 策略从计划里取，取值非法直接抛错。此前只有 scaler 被读取，imputer/encoder 是
    # 有声明无消费方——改计划里的 imputer 不会改变任何行为，而变换报告仍回报硬编码值。
    strategies = strategies_from_steps(plan.get("steps"))
    for column in numeric_features:
        transformed, summary = _numeric_transform(
            df[column],
            imputer=strategies.numeric_imputer,
            scaler=strategies.numeric_scaler,
        )
        output[column] = transformed
        transformations["numeric"][column] = summary

    categorical_frame = pd.DataFrame(index=df.index)
    for column in categorical_features:
        transformed, summary = _categorical_transform(df[column], imputer=strategies.categorical_imputer)
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
