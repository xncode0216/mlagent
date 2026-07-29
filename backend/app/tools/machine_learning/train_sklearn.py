import json
from pathlib import Path
from typing import Any

from app.services.kernel_service import KernelServiceProtocol

RESULT_MARKER = "__MLAGENT_SKLEARN_RESULT__"


def _resolve_workspace_path(
    workspace_root: Path,
    relative_path: str,
    *,
    must_exist: bool,
    missing_detail: str = "Dataset not found",
) -> Path:
    root = workspace_root.resolve()
    resolved = (root / relative_path).resolve()
    if root != resolved and root not in resolved.parents:
        raise ValueError("Path must stay inside the project workspace")
    if must_exist and (not resolved.exists() or not resolved.is_file()):
        raise ValueError(missing_detail)
    return resolved


def _extract_result(stdout: str) -> dict[str, Any]:
    for line in reversed(stdout.splitlines()):
        if line.startswith(RESULT_MARKER):
            return json.loads(line[len(RESULT_MARKER) :])
    raise RuntimeError("Kernel did not return a sklearn training result")


def _training_code(
    dataset_path: str,
    target_column: str,
    model_output_path: str,
    preprocessing_plan_path: str | None = None,
) -> str:
    dataset_literal = json.dumps(dataset_path)
    target_literal = json.dumps(target_column)
    model_path_literal = json.dumps(model_output_path)
    # 这些字面量会被拼进 Python 源码执行。`json.dumps` 处理字符串没问题（顺带把非 ASCII
    # 转义掉，路径含中文也安全），但 None 会变成 JSON 的 `null`——Python 里没有这个名字，
    # 脚本在赋值那一行就 NameError，且报错内容与真实原因毫不相干。可空的这个单独处理。
    preprocessing_plan_literal = "None" if preprocessing_plan_path is None else json.dumps(preprocessing_plan_path)
    marker_literal = json.dumps(RESULT_MARKER)
    return f"""
import json
import pickle
from pathlib import Path

import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

dataset_path = Path({dataset_literal})
target_column = {target_literal}
model_output_path = Path({model_path_literal})
preprocessing_plan_path_literal = {preprocessing_plan_literal}
preprocessing_plan_path = Path(preprocessing_plan_path_literal) if preprocessing_plan_path_literal else None
marker = {marker_literal}

df = pd.read_csv(dataset_path)
if target_column not in df.columns:
    raise ValueError("Target column was not found")
if df.empty:
    raise ValueError("Training dataset is empty")

preprocessing_plan = None
drop_columns = []
numeric_features = []
categorical_features = []
if preprocessing_plan_path is not None:
    if not preprocessing_plan_path.exists() or not preprocessing_plan_path.is_file():
        raise ValueError("Preprocessing plan was not found")
    preprocessing_plan = json.loads(preprocessing_plan_path.read_text(encoding="utf-8"))
    plan_target = preprocessing_plan.get("target_column")
    if plan_target and plan_target != target_column:
        raise ValueError("Preprocessing plan target column does not match the requested target")
    drop_columns = [
        str(column)
        for column in preprocessing_plan.get("drop_columns", [])
        if str(column) in df.columns and str(column) != target_column
    ]
    numeric_features = [
        str(column)
        for column in preprocessing_plan.get("numeric_features", [])
        if str(column) in df.columns and str(column) not in drop_columns and str(column) != target_column
    ]
    categorical_features = [
        str(column)
        for column in preprocessing_plan.get("categorical_features", [])
        if str(column) in df.columns and str(column) not in drop_columns and str(column) != target_column
    ]
    planned_features = []
    for column in [*numeric_features, *categorical_features]:
        if column not in planned_features:
            planned_features.append(column)
    if not planned_features:
        planned_features = [
            column for column in df.columns if column != target_column and column not in drop_columns
        ]
        numeric_features = [
            column for column in planned_features if pd.api.types.is_numeric_dtype(df[column])
        ]
        categorical_features = [column for column in planned_features if column not in numeric_features]
    features = df[planned_features].copy()
else:
    features = df.drop(columns=[target_column]).copy()
    feature_columns = list(features.columns)
    numeric_features = [
        column for column in feature_columns if pd.api.types.is_numeric_dtype(features[column])
    ]
    categorical_features = [column for column in feature_columns if column not in numeric_features]

target = df[target_column].astype(str)
feature_columns = list(features.columns)
for column in numeric_features:
    if column not in features.columns:
        continue
    features[column] = pd.to_numeric(features[column], errors="coerce")
    fill_value = features[column].median()
    if pd.isna(fill_value):
        fill_value = 0
    features[column] = features[column].fillna(fill_value)

for column in categorical_features:
    if column in features.columns:
        features[column] = features[column].fillna("__missing__").astype(str)

for column in feature_columns:
    if column in numeric_features or column in categorical_features:
        continue
    if pd.api.types.is_numeric_dtype(features[column]):
        numeric_features.append(column)
        fill_value = features[column].median()
        if pd.isna(fill_value):
            fill_value = 0
        features[column] = features[column].fillna(fill_value)
    else:
        categorical_features.append(column)
        features[column] = features[column].fillna("__missing__").astype(str)

categorical_columns = [column for column in categorical_features if column in features.columns]
if categorical_columns:
    encoded_features = pd.get_dummies(features, columns=categorical_columns, dummy_na=True)
else:
    encoded_features = features.copy()
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
    holdout_strategy = "stratified_holdout"
else:
    X_train, X_eval, y_train, y_eval = encoded_features, encoded_features, target, target
    holdout_strategy = "resubstitution_small_dataset"
eval_feature_rows = features.loc[X_eval.index]

estimators = [
    ("majority_class", DummyClassifier(strategy="most_frequent")),
    ("logistic_regression", LogisticRegression(max_iter=500, random_state=42)),
    ("random_forest", RandomForestClassifier(n_estimators=80, random_state=42)),
]

runs = []
best = None
best_estimator = None
labels = sorted(target.unique().tolist())
class_distribution = {{
    str(label): int(count)
    for label, count in target.value_counts().sort_index().items()
}}
for model_name, estimator in estimators:
    estimator.fit(X_train, y_train)
    predictions = estimator.predict(X_eval)
    precision, recall, f1, support = precision_recall_fscore_support(
        y_eval,
        predictions,
        labels=labels,
        zero_division=0,
    )
    per_class = {{
        str(label): {{
            "precision": round(float(precision[index]), 4),
            "recall": round(float(recall[index]), 4),
            "f1": round(float(f1[index]), 4),
            "support": int(support[index]),
        }}
        for index, label in enumerate(labels)
    }}
    metrics = {{
        "accuracy": round(float(accuracy_score(y_eval, predictions)), 4),
        "f1_weighted": round(float(f1_score(y_eval, predictions, average="weighted", zero_division=0)), 4),
        "row_count": int(len(df)),
        "train_row_count": int(len(y_train)),
        "eval_row_count": int(len(y_eval)),
        "class_count": int(target.nunique(dropna=True)),
        "holdout_strategy": holdout_strategy,
        "class_distribution": class_distribution,
        "eval_class_distribution": {{
            str(label): int(count)
            for label, count in y_eval.value_counts().reindex(labels, fill_value=0).sort_index().items()
        }},
        "per_class": per_class,
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
    if hasattr(estimator, "coef_"):
        coefficient_values = estimator.coef_
        if len(coefficient_values.shape) == 1:
            coefficient_scores = coefficient_values
        else:
            coefficient_scores = coefficient_values.mean(axis=0)
        coefficients = sorted(
            zip(encoded_features.columns, coefficient_scores),
            key=lambda item: abs(float(item[1])),
            reverse=True,
        )[:10]
        model["linear_coefficients"] = [
            {{
                "feature": str(feature),
                "coefficient": round(float(coefficient), 6),
                "abs_coefficient": round(abs(float(coefficient)), 6),
            }}
            for feature, coefficient in coefficients
        ]
    if len(y_eval) >= 2 and encoded_features.shape[1] <= 200:
        try:
            permutation = permutation_importance(
                estimator,
                X_eval,
                y_eval,
                n_repeats=5,
                random_state=42,
                scoring="accuracy",
            )
            permutation_rows = sorted(
                zip(encoded_features.columns, permutation.importances_mean, permutation.importances_std),
                key=lambda item: abs(float(item[1])),
                reverse=True,
            )[:10]
            model["permutation_importance"] = [
                {{
                    "feature": str(feature),
                    "mean_importance": round(float(mean_importance), 6),
                    "std_importance": round(float(std_importance), 6),
                }}
                for feature, mean_importance, std_importance in permutation_rows
            ]
        except Exception as exc:
            model["explanation_warning"] = str(exc)
    run = {{"model_name": model_name, "model": model, "metrics": metrics}}
    runs.append(run)
    if best is None or (metrics["accuracy"], metrics["f1_weighted"]) > (
        best["metrics"]["accuracy"],
        best["metrics"]["f1_weighted"],
    ):
        best = run
        best_estimator = estimator

model_output_path.parent.mkdir(parents=True, exist_ok=True)
with model_output_path.open("wb") as model_file:
    pickle.dump(best_estimator, model_file)

best_predictions = best_estimator.predict(X_eval)
prediction_samples = []
def json_safe_sample_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value

for sample_index, (row_index, feature_row) in enumerate(eval_feature_rows.iterrows()):
    actual = y_eval.loc[row_index]
    predicted = best_predictions[sample_index]
    feature_snapshot = {{
        str(column): json_safe_sample_value(value)
        for column, value in feature_row.head(12).items()
    }}
    prediction_samples.append({{
        "row_index": int(row_index) if hasattr(row_index, "__int__") else str(row_index),
        "actual": str(actual),
        "predicted": str(predicted),
        "is_error": bool(actual != predicted),
        "features": feature_snapshot,
    }})
prediction_samples = sorted(
    prediction_samples,
    key=lambda sample: (not sample["is_error"], sample["row_index"]),
)[:50]

result = {{
    "engine": "sklearn",
    "task_type": "classification",
    "target_column": target_column,
    "feature_columns": feature_columns,
    "encoded_feature_count": int(encoded_features.shape[1]),
    "model_name": best["model_name"],
    "model": best["model"],
    "metrics": best["metrics"],
    "prediction_samples": prediction_samples,
    "runs": sorted(runs, key=lambda run: (run["metrics"]["accuracy"], run["metrics"]["f1_weighted"]), reverse=True),
    "model_path": str(model_output_path).replace("\\\\", "/"),
}}
if preprocessing_plan is not None:
    result["preprocessing_plan_path"] = str(preprocessing_plan_path).replace("\\\\", "/")
    result["preprocessing_plan"] = {{
        "drop_columns": drop_columns,
        "numeric_features": numeric_features,
        "categorical_features": categorical_features,
    }}
print(marker + json.dumps(result, ensure_ascii=False))
""".strip()


def train_sklearn_classifier(
    *,
    workspace_root: Path,
    dataset_path: str,
    target_column: str,
    model_output_path: str,
    preprocessing_plan_path: str | None = None,
    kernel_service: KernelServiceProtocol,
) -> dict[str, Any]:
    _resolve_workspace_path(workspace_root, dataset_path, must_exist=True)
    _resolve_workspace_path(workspace_root, model_output_path, must_exist=False)
    if preprocessing_plan_path is not None:
        _resolve_workspace_path(
            workspace_root,
            preprocessing_plan_path,
            must_exist=True,
            missing_detail="Preprocessing plan not found",
        )

    result = kernel_service.execute(
        _training_code(dataset_path, target_column, model_output_path, preprocessing_plan_path),
        timeout_seconds=120,
    )
    if result.status != "ok":
        raise RuntimeError(result.stderr or result.stdout or "Kernel training failed")
    return _extract_result(result.stdout)
