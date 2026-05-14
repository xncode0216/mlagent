import json
from pathlib import Path
from typing import Any

from app.services.kernel_service import KernelServiceProtocol

RESULT_MARKER = "__MLAGENT_SKLEARN_RESULT__"


def _resolve_workspace_path(workspace_root: Path, relative_path: str, *, must_exist: bool) -> Path:
    root = workspace_root.resolve()
    resolved = (root / relative_path).resolve()
    if root != resolved and root not in resolved.parents:
        raise ValueError("Path must stay inside the project workspace")
    if must_exist and (not resolved.exists() or not resolved.is_file()):
        raise ValueError("Dataset not found")
    return resolved


def _extract_result(stdout: str) -> dict[str, Any]:
    for line in reversed(stdout.splitlines()):
        if line.startswith(RESULT_MARKER):
            return json.loads(line[len(RESULT_MARKER) :])
    raise RuntimeError("Kernel did not return a sklearn training result")


def _training_code(dataset_path: str, target_column: str, model_output_path: str) -> str:
    dataset_literal = json.dumps(dataset_path)
    target_literal = json.dumps(target_column)
    model_path_literal = json.dumps(model_output_path)
    marker_literal = json.dumps(RESULT_MARKER)
    return f"""
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

dataset_path = Path({dataset_literal})
target_column = {target_literal}
model_output_path = Path({model_path_literal})
marker = {marker_literal}

df = pd.read_csv(dataset_path)
if target_column not in df.columns:
    raise ValueError("Target column was not found")
if df.empty:
    raise ValueError("Training dataset is empty")

features = df.drop(columns=[target_column])
target = df[target_column].astype(str)
feature_columns = list(features.columns)
encoded_features = pd.get_dummies(features, dummy_na=True)
if encoded_features.shape[1] == 0:
    raise ValueError("Training dataset has no feature columns")

can_split = len(df) >= 6 and target.value_counts().min() >= 2 and target.nunique(dropna=True) > 1
if can_split:
    X_train, X_eval, y_train, y_eval = train_test_split(
        encoded_features,
        target,
        test_size=0.3,
        random_state=42,
        stratify=target,
    )
else:
    X_train, X_eval, y_train, y_eval = encoded_features, encoded_features, target, target

estimators = [
    ("majority_class", DummyClassifier(strategy="most_frequent")),
    ("logistic_regression", LogisticRegression(max_iter=500, random_state=42)),
    ("random_forest", RandomForestClassifier(n_estimators=80, random_state=42)),
]

runs = []
best = None
best_estimator = None
labels = sorted(target.unique().tolist())
for model_name, estimator in estimators:
    estimator.fit(X_train, y_train)
    predictions = estimator.predict(X_eval)
    metrics = {{
        "accuracy": round(float(accuracy_score(y_eval, predictions)), 4),
        "f1_weighted": round(float(f1_score(y_eval, predictions, average="weighted", zero_division=0)), 4),
        "row_count": int(len(df)),
        "eval_row_count": int(len(y_eval)),
        "class_count": int(target.nunique(dropna=True)),
        "confusion_matrix": {{
            label: {{predicted: int(value) for predicted, value in zip(labels, row)}}
            for label, row in zip(labels, confusion_matrix(y_eval, predictions, labels=labels))
        }},
    }}
    model = {{
        "algorithm": model_name,
        "feature_count": int(encoded_features.shape[1]),
    }}
    if hasattr(estimator, "feature_importances_"):
        importances = sorted(
            zip(encoded_features.columns, estimator.feature_importances_),
            key=lambda item: float(item[1]),
            reverse=True,
        )[:10]
        model["feature_importance"] = [
            {{"feature": str(feature), "importance": round(float(importance), 6)}}
            for feature, importance in importances
        ]
    run = {{"model_name": model_name, "model": model, "metrics": metrics}}
    runs.append(run)
    if best is None or (metrics["accuracy"], metrics["f1_weighted"]) > (
        best["metrics"]["accuracy"],
        best["metrics"]["f1_weighted"],
    ):
        best = run
        best_estimator = estimator

model_output_path.parent.mkdir(parents=True, exist_ok=True)
joblib.dump(best_estimator, model_output_path)

result = {{
    "engine": "sklearn",
    "task_type": "classification",
    "target_column": target_column,
    "feature_columns": feature_columns,
    "encoded_feature_count": int(encoded_features.shape[1]),
    "model_name": best["model_name"],
    "model": best["model"],
    "metrics": best["metrics"],
    "runs": sorted(runs, key=lambda run: (run["metrics"]["accuracy"], run["metrics"]["f1_weighted"]), reverse=True),
    "model_path": str(model_output_path).replace("\\\\", "/"),
}}
print(marker + json.dumps(result, ensure_ascii=False))
""".strip()


def train_sklearn_classifier(
    *,
    workspace_root: Path,
    dataset_path: str,
    target_column: str,
    model_output_path: str,
    kernel_service: KernelServiceProtocol,
) -> dict[str, Any]:
    _resolve_workspace_path(workspace_root, dataset_path, must_exist=True)
    _resolve_workspace_path(workspace_root, model_output_path, must_exist=False)

    result = kernel_service.execute(
        _training_code(dataset_path, target_column, model_output_path),
        timeout_seconds=120,
    )
    if result.status != "ok":
        raise RuntimeError(result.stderr or result.stdout or "Kernel training failed")
    return _extract_result(result.stdout)
