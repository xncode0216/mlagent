from pathlib import Path
from typing import Any

import pandas as pd


def _accuracy(y_true: list[Any], y_pred: list[Any]) -> float:
    if not y_true:
        return 0.0
    correct = sum(1 for expected, predicted in zip(y_true, y_pred, strict=True) if expected == predicted)
    return round(correct / len(y_true), 4)


def _majority_class(values: pd.Series) -> Any:
    modes = values.mode(dropna=True)
    if modes.empty:
        return None
    return modes.iloc[0]


def _candidate_thresholds(values: pd.Series) -> list[float]:
    unique_values = sorted(float(value) for value in values.dropna().unique())
    return [
        (left + right) / 2
        for left, right in zip(unique_values, unique_values[1:], strict=False)
        if left != right
    ]


def _confusion_matrix(y_true: list[Any], y_pred: list[Any]) -> dict[str, dict[str, int]]:
    labels = sorted({str(value) for value in y_true if pd.notna(value)})
    confusion: dict[str, dict[str, int]] = {
        expected: {predicted: 0 for predicted in labels} for expected in labels
    }
    for expected, predicted in zip(y_true, y_pred, strict=True):
        expected_key = str(expected)
        predicted_key = str(predicted)
        confusion.setdefault(expected_key, {})
        confusion[expected_key][predicted_key] = confusion[expected_key].get(predicted_key, 0) + 1
    return confusion


def _metrics(y_true: list[Any], y_pred: list[Any]) -> dict[str, Any]:
    target = pd.Series(y_true)
    return {
        "accuracy": _accuracy(y_true, y_pred),
        "row_count": int(len(y_true)),
        "class_count": int(target.nunique(dropna=True)),
        "confusion_matrix": _confusion_matrix(y_true, y_pred),
    }


def train_baseline_classifier(csv_path: Path, target_column: str) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    if target_column not in df.columns:
        raise ValueError("Target column was not found")
    if df.empty:
        raise ValueError("Training dataset is empty")

    target = df[target_column]
    feature_columns = [column for column in df.columns if column != target_column]
    majority = _majority_class(target)
    best_model: dict[str, Any] = {
        "strategy": "majority_class",
        "prediction": majority,
    }
    y_true = target.tolist()
    best_predictions = [majority for _ in range(len(df))]
    best_accuracy = _accuracy(y_true, best_predictions)
    runs: list[dict[str, Any]] = [
        {
            "model_name": "majority_class",
            "model": best_model,
            "metrics": _metrics(y_true, best_predictions),
        }
    ]

    numeric_features = df[feature_columns].select_dtypes(include="number")
    for feature in numeric_features.columns:
        best_feature_run: dict[str, Any] | None = None
        for threshold in _candidate_thresholds(numeric_features[feature]):
            left_target = target[numeric_features[feature] <= threshold]
            right_target = target[numeric_features[feature] > threshold]
            if left_target.empty or right_target.empty:
                continue
            left_class = _majority_class(left_target)
            right_class = _majority_class(right_target)
            predictions = [
                left_class if float(value) <= threshold else right_class
                for value in numeric_features[feature]
            ]
            accuracy = _accuracy(y_true, predictions)
            candidate_model = {
                "strategy": "numeric_threshold",
                "feature": feature,
                "threshold": round(threshold, 6),
                "less_equal_class": left_class,
                "greater_class": right_class,
            }
            candidate_run = {
                "model_name": f"numeric_threshold:{feature}",
                "model": candidate_model,
                "metrics": _metrics(y_true, predictions),
            }
            if best_feature_run is None or accuracy > best_feature_run["metrics"]["accuracy"]:
                best_feature_run = candidate_run
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_predictions = predictions
                best_model = candidate_model
        if best_feature_run is not None:
            runs.append(best_feature_run)

    return {
        "task_type": "classification",
        "target_column": target_column,
        "feature_columns": feature_columns,
        "model_name": "baseline_classifier",
        "model": best_model,
        "metrics": _metrics(y_true, best_predictions),
        "runs": sorted(runs, key=lambda run: run["metrics"]["accuracy"]),
    }
