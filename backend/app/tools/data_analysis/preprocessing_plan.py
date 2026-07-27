from pathlib import Path
from typing import Any

from app.tools.data_analysis.data_quality_profile import data_quality_profile


def _is_identifier_name(name: str) -> bool:
    normalized = name.lower().replace("-", "_").replace(" ", "_")
    compact = normalized.replace("_", "")
    return (
        normalized == "id"
        or normalized.endswith("_id")
        or normalized.endswith("_uuid")
        or normalized.endswith("_guid")
        or compact
        in {
            "accountid",
            "clientid",
            "customerid",
            "guid",
            "recordid",
            "rowid",
            "sessionid",
            "transactionid",
            "userid",
            "uuid",
        }
    )


def _best_target(profile: dict[str, Any]) -> str:
    candidates = profile.get("target_candidates", [])
    if isinstance(candidates, list) and candidates:
        candidate = candidates[0]
        if isinstance(candidate, dict) and isinstance(candidate.get("column"), str):
            return candidate["column"]
    columns = profile.get("columns", [])
    if isinstance(columns, list) and columns:
        last = columns[-1]
        if isinstance(last, dict) and isinstance(last.get("name"), str):
            return last["name"]
    return ""


def _column_names(columns: list[dict[str, Any]], kind: str, *, exclude: set[str]) -> list[str]:
    return [
        column["name"]
        for column in columns
        if column.get("kind") == kind
        and isinstance(column.get("name"), str)
        and column["name"] not in exclude
    ]


def _drop_reason(column: dict[str, Any], target_column: str, *, row_count: int) -> str | None:
    name = column.get("name")
    if not isinstance(name, str) or name == target_column:
        return None
    flags = set(column.get("quality_flags") or [])
    if _is_identifier_name(name):
        return "identifier_like"
    if (
        "unique_identifier_candidate" in flags
        and row_count >= 20
        and column.get("kind") != "numeric"
    ):
        return "identifier_like"
    if "constant" in flags:
        return "constant"
    if float(column.get("missing_ratio") or 0.0) >= 0.8:
        return "very_high_missing"
    return None


def _render_pipeline_script(
    *,
    dataset_path: str,
    output_path: str,
    target_column: str,
    numeric_features: list[str],
    categorical_features: list[str],
    drop_columns: list[str],
) -> str:
    return "\n".join(
        [
            "import pandas as pd",
            "from sklearn.compose import ColumnTransformer",
            "from sklearn.impute import SimpleImputer",
            "from sklearn.pipeline import Pipeline",
            "from sklearn.preprocessing import OneHotEncoder, StandardScaler",
            "",
            f"dataset_path = {dataset_path!r}",
            f"output_path = {output_path!r}",
            f"target_column = {target_column!r}",
            f"numeric_features = {numeric_features!r}",
            f"categorical_features = {categorical_features!r}",
            f"drop_columns = {drop_columns!r}",
            "",
            "df = pd.read_csv(dataset_path)",
            "target = df[target_column] if target_column in df.columns else None",
            "features = df.drop(columns=[target_column, *drop_columns], errors='ignore')",
            "",
            "numeric_pipeline = Pipeline(",
            "    steps=[",
            "        ('imputer', SimpleImputer(strategy='median')),",
            "        ('scaler', StandardScaler()),",
            "    ]",
            ")",
            "categorical_pipeline = Pipeline(",
            "    steps=[",
            "        ('imputer', SimpleImputer(strategy='most_frequent')),",
            "        ('encoder', OneHotEncoder(handle_unknown='ignore', sparse_output=False)),",
            "    ]",
            ")",
            "preprocessor = ColumnTransformer(",
            "    transformers=[",
            "        ('numeric', numeric_pipeline, numeric_features),",
            "        ('categorical', categorical_pipeline, categorical_features),",
            "    ],",
            "    remainder='drop',",
            ")",
            "",
            "transformed = preprocessor.fit_transform(features)",
            "feature_names = preprocessor.get_feature_names_out()",
            "output = pd.DataFrame(transformed, columns=feature_names)",
            "if target is not None:",
            "    output[target_column] = target.reset_index(drop=True)",
            "output.to_csv(output_path, index=False)",
            "",
        ]
    )


def preprocessing_plan(
    csv_path: Path,
    dataset_path: str | None = None,
    selected_features: list[str] | None = None,
) -> dict[str, Any]:
    """构建可复现的预处理计划。

    ``selected_features`` 让调用方显式指定参与训练的特征。给定时，未选中的非目标列
    以 ``deselected`` 理由进入 drop_columns，自动质量丢弃规则不再适用于选中的列；
    未给定时保持原有的自动丢弃行为。特征选择必须经由本函数落到计划里，
    才能让 drop/steps/pipeline_script 等派生字段保持一致。
    """
    profile = data_quality_profile(csv_path)
    row_count = int(profile.get("row_count") or 0)
    columns = [
        column
        for column in profile.get("columns", [])
        if isinstance(column, dict) and isinstance(column.get("name"), str)
    ]
    target_column = _best_target(profile)
    if selected_features is None:
        drop_reasons = {
            column["name"]: reason
            for column in columns
            if (reason := _drop_reason(column, target_column, row_count=row_count)) is not None
        }
    else:
        kept = {
            name
            for name in selected_features
            if isinstance(name, str)
            and name != target_column
            and any(column["name"] == name for column in columns)
        }
        drop_reasons = {
            column["name"]: "deselected"
            for column in columns
            if column["name"] != target_column and column["name"] not in kept
        }
    excluded = {target_column, *drop_reasons.keys()}
    numeric_features = _column_names(columns, "numeric", exclude=excluded)
    categorical_features = [
        column
        for column in [
            *_column_names(columns, "categorical", exclude=excluded),
            *_column_names(columns, "boolean", exclude=excluded),
        ]
        if column not in numeric_features
    ]
    source_path = dataset_path or str(csv_path)
    output_path = str(Path("results") / "manual-analysis" / f"{csv_path.stem}_preprocessed.csv")

    return {
        "dataset_path": source_path,
        "target_column": target_column,
        "feature_columns": [*numeric_features, *categorical_features],
        "drop_columns": sorted(drop_reasons),
        "drop_reasons": drop_reasons,
        "numeric_features": numeric_features,
        "categorical_features": categorical_features,
        "steps": {
            "numeric": {
                "selector": numeric_features,
                "imputer": "median",
                "scaler": "standard",
            },
            "categorical": {
                "selector": categorical_features,
                "imputer": "most_frequent",
                "encoder": "one_hot_ignore_unknown",
            },
            "target": {
                "column": target_column,
                "mode": "passthrough",
            },
        },
        "quality_summary": {
            "row_count": profile.get("row_count", 0),
            "column_count": profile.get("column_count", 0),
            "missing_cells": profile.get("missing_cells", 0),
            "duplicate_rows": profile.get("duplicate_rows", 0),
        },
        "sklearn_pipeline": "ColumnTransformer(numeric=median+standard, categorical=most_frequent+one_hot_ignore_unknown)",
        "pipeline_script": _render_pipeline_script(
            dataset_path=source_path,
            output_path=output_path,
            target_column=target_column,
            numeric_features=numeric_features,
            categorical_features=categorical_features,
            drop_columns=sorted(drop_reasons),
        ),
    }
