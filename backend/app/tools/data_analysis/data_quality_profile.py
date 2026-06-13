from pathlib import Path
from typing import Any

import pandas as pd


TARGET_HINTS = {"target", "label", "churn", "default", "fraud", "y"}


def _series_kind(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    return "categorical"


def _target_score(column: str, unique_count: int, row_count: int, index: int, column_count: int) -> tuple[float, list[str]]:
    lower_name = column.lower()
    reasons: list[str] = []
    score = 0.0

    if lower_name in TARGET_HINTS:
        score += 0.7
        reasons.append("name_matches_target_hint")
    if any(hint in lower_name for hint in TARGET_HINTS - {"y"}):
        score += 0.25
        reasons.append("name_contains_target_hint")
    if 1 < unique_count <= max(20, row_count * 0.2):
        score += 0.2
        reasons.append("supervised_cardinality")
    if index == column_count - 1:
        score += 0.15
        reasons.append("last_column")
    if lower_name.endswith(("_id", "id")):
        score -= 0.4
        reasons.append("identifier_like")

    return round(max(0.0, min(score, 1.0)), 4), reasons


def data_quality_profile(csv_path: Path, sample_rows: int = 20) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    row_count = int(len(df))
    column_count = int(len(df.columns))
    duplicate_rows = int(df.duplicated().sum())
    columns: list[dict[str, Any]] = []
    target_candidates: list[dict[str, Any]] = []

    for index, column in enumerate(df.columns):
        series = df[column]
        missing_count = int(series.isna().sum())
        missing_ratio = float(series.isna().mean()) if row_count else 0.0
        unique_count = int(series.nunique(dropna=True))
        kind = _series_kind(series)
        quality_flags: list[str] = []

        if missing_ratio > 0:
            quality_flags.append("has_missing")
        if missing_ratio >= 0.4:
            quality_flags.append("high_missing")
        if unique_count <= 1:
            quality_flags.append("constant")
        if unique_count == row_count and row_count > 1:
            quality_flags.append("unique_identifier_candidate")

        column_profile: dict[str, Any] = {
            "name": column,
            "dtype": str(series.dtype),
            "kind": kind,
            "missing_count": missing_count,
            "missing_ratio": missing_ratio,
            "unique_count": unique_count,
            "quality_flags": quality_flags,
        }

        if kind == "numeric":
            numeric = pd.to_numeric(series, errors="coerce")
            column_profile["summary"] = {
                "min": None if numeric.dropna().empty else float(numeric.min()),
                "max": None if numeric.dropna().empty else float(numeric.max()),
                "mean": None if numeric.dropna().empty else float(numeric.mean()),
                "median": None if numeric.dropna().empty else float(numeric.median()),
            }
        else:
            top_values = series.dropna().astype(str).value_counts().head(5)
            column_profile["top_values"] = [
                {"value": value, "count": int(count)}
                for value, count in top_values.items()
            ]

        score, reasons = _target_score(column, unique_count, row_count, index, column_count)
        if score > 0:
            target_candidates.append(
                {
                    "column": column,
                    "score": score,
                    "dtype": str(series.dtype),
                    "unique_count": unique_count,
                    "missing_ratio": missing_ratio,
                    "reasons": reasons,
                }
            )

        columns.append(column_profile)

    target_candidates.sort(key=lambda item: item["score"], reverse=True)
    return {
        "row_count": row_count,
        "column_count": column_count,
        "duplicate_rows": duplicate_rows,
        "missing_cells": int(df.isna().sum().sum()),
        "columns": columns,
        "target_candidates": target_candidates,
        "sample": df.head(sample_rows).to_dict(orient="records"),
    }
