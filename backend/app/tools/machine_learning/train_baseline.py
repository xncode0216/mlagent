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
    best_predictions = [majority for _ in range(len(df))]
    best_accuracy = _accuracy(target.tolist(), best_predictions)

    numeric_features = df[feature_columns].select_dtypes(include="number")
    for feature in numeric_features.columns:
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
            accuracy = _accuracy(target.tolist(), predictions)
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_predictions = predictions
                best_model = {
                    "strategy": "numeric_threshold",
                    "feature": feature,
                    "threshold": round(threshold, 6),
                    "less_equal_class": left_class,
                    "greater_class": right_class,
                }

    labels = sorted({str(value) for value in target.dropna().unique()})
    confusion: dict[str, dict[str, int]] = {
        expected: {predicted: 0 for predicted in labels} for expected in labels
    }
    for expected, predicted in zip(target.tolist(), best_predictions, strict=True):
        expected_key = str(expected)
        predicted_key = str(predicted)
        confusion.setdefault(expected_key, {})
        confusion[expected_key][predicted_key] = confusion[expected_key].get(predicted_key, 0) + 1

    return {
        "task_type": "classification",
        "target_column": target_column,
        "feature_columns": feature_columns,
        "model_name": "baseline_classifier",
        "model": best_model,
        "metrics": {
            "accuracy": best_accuracy,
            "row_count": int(len(df)),
            "class_count": int(target.nunique(dropna=True)),
            "confusion_matrix": confusion,
        },
    }
