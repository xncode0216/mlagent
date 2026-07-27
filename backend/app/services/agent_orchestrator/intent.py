"""Keyword-based intent classifier (P1-6 extraction of ``_classify_intent``)."""

from __future__ import annotations


def classify_intent(content: str) -> str:
    text = content.lower()
    abandon_terms = (
        "abandon last failure",
        "abandon failed",
        "abandon saved",
        "abandon retry",
        "clear last failure",
        "clear failed",
        "clear saved failure",
        "clear retry state",
        "drop last failure",
        "forget last failure",
        "\u653e\u5f03\u4e0a\u6b21\u5931\u8d25",
        "\u653e\u5f03\u5931\u8d25",
        "\u6e05\u9664\u4e0a\u6b21\u5931\u8d25",
        "\u6e05\u9664\u5931\u8d25\u72b6\u6001",
        "\u6e05\u9664\u91cd\u8bd5\u72b6\u6001",
    )
    if any(term in text for term in abandon_terms):
        return "abandon_last_failure"

    continue_terms = (
        "continue from last failure",
        "continue the failed",
        "continue failed",
        "resume last",
        "resume failed",
        "retry last",
        "retry failed",
        "recover last",
        "last failure",
        "last failed",
        "\u7ee7\u7eed\u4e0a\u6b21",
        "\u7ee7\u7eed\u5931\u8d25",
        "\u6062\u590d\u4e0a\u6b21",
        "\u6062\u590d\u5931\u8d25",
        "\u91cd\u8bd5\u4e0a\u6b21",
        "\u91cd\u8bd5\u5931\u8d25",
        "\u4e0a\u6b21\u5931\u8d25",
        "\u4e0a\u4e00\u6b65\u5931\u8d25",
    )
    if any(term in text for term in continue_terms):
        return "continue_from_failure"

    ingest_terms = (
        "ingest",
        "register dataset",
        "register this dataset",
        "register data",
        "load dataset",
        "load this dataset",
        "import dataset",
        "import this dataset",
        "source summary",
        "dataset summary",
        "\u63a5\u5165\u6570\u636e",
        "\u5bfc\u5165\u6570\u636e",
        "\u767b\u8bb0\u6570\u636e\u96c6",
        "\u6ce8\u518c\u6570\u636e\u96c6",
        "\u6570\u636e\u96c6\u6458\u8981",
    )
    if any(term in text for term in ingest_terms):
        return "configure_ingest"

    iteration_terms = (
        "iterate",
        "iteration",
        "follow-up experiment",
        "follow up experiment",
        "next experiment",
        "improve recall",
        "improve precision",
        "retrain plan",
        "rerun with changes",
        "\u8fed\u4ee3",
        "\u4e0b\u4e00\u8f6e\u5b9e\u9a8c",
        "\u6539\u8fdb\u6a21\u578b",
        "\u91cd\u8bad\u8ba1\u5212",
    )
    if any(term in text for term in iteration_terms):
        return "configure_iteration"

    diagnosis_terms = (
        "diagnose",
        "diagnosis",
        "diagnostic",
        "error slice",
        "error analysis",
        "prediction sample",
        "prediction samples",
        "misclassified",
        "misclassification",
        "confusion matrix",
        "poor recall",
        "low recall",
        "why recall",
        "poor precision",
        "low precision",
        "bad f1",
        "\u8bca\u65ad",
        "\u9519\u8bef\u5207\u7247",
        "\u9519\u8bef\u6837\u672c",
        "\u9884\u6d4b\u6837\u672c",
        "\u8bef\u5206\u7c7b",
        "\u6df7\u6dc6\u77e9\u9635",
        "\u53ec\u56de\u7387",
        "\u7cbe\u786e\u7387",
    )
    if any(term in text for term in diagnosis_terms):
        return "configure_diagnosis"

    export_terms = (
        "export experiment",
        "export bundle",
        "export report",
        "export handoff",
        "handoff bundle",
        "handoff package",
        "download bundle",
        "package report",
        "package this model",
        "package the model",
        "final report",
        "deliverable",
        "reproducible bundle",
        "\u5bfc\u51fa",
        "\u5bfc\u51fa\u62a5\u544a",
        "\u5bfc\u51fa\u6a21\u578b",
        "\u4ea4\u4ed8\u5305",
        "\u4ea4\u4ed8\u7269",
        "\u6253\u5305",
        "\u53ef\u590d\u73b0\u5305",
    )
    if any(term in text for term in export_terms):
        return "configure_export"

    learning_terms = (
        "learn from this",
        "extract lesson",
        "extract lessons",
        "extract learned",
        "learned rule",
        "learned rules",
        "propose rule",
        "propose learned",
        "save lesson",
        "remember this workflow",
        "project memory",
        "knowledge rule",
        "\u63d0\u53d6\u7ecf\u9a8c",
        "\u63d0\u53d6\u89c4\u5219",
        "\u6c89\u6dc0\u7ecf\u9a8c",
        "\u5b66\u4e60\u7ecf\u9a8c",
        "\u7ecf\u9a8c\u89c4\u5219",
        "\u8bb0\u4f4f\u8fd9\u6b21",
        "\u9879\u76ee\u8bb0\u5fc6",
        "\u77e5\u8bc6\u89c4\u5219",
    )
    if any(term in text for term in learning_terms):
        return "configure_learning"

    clean_terms = (
        "clean",
        "cleaning",
        "quality issue",
        "quality issues",
        "safe fixes",
        "fix missing",
        "dedupe",
        "deduplicate",
        "\u6e05\u6d17",
        "\u8d28\u91cf\u95ee\u9898",
        "\u5b89\u5168\u4fee\u590d",
        "\u53bb\u91cd",
    )
    if any(term in text for term in clean_terms):
        return "configure_cleaning"

    transform_terms = (
        "transform",
        "transformation",
        "preprocessing plan",
        "preprocess plan",
        "feature transform",
        "feature engineering plan",
        "\u8f6c\u6362",
        "\u9884\u5904\u7406\u8ba1\u5212",
        "\u7279\u5f81\u8f6c\u6362",
    )
    if any(term in text for term in transform_terms):
        return "configure_transform"

    profile_terms = (
        "profile",
        "data profile",
        "quality profile",
        "profile this dataset",
        "show quality warnings",
        "\u753b\u50cf",
        "\u6570\u636e\u753b\u50cf",
        "\u8d28\u91cf\u753b\u50cf",
    )
    if any(term in text for term in profile_terms):
        return "configure_profile"

    prepare_terms = (
        "prepare",
        "preprocess",
        "preprocessing",
        "feature engineering",
        "prepare for modeling",
        "ready for modeling",
        "\u9884\u5904\u7406",
        "\u7279\u5f81\u5de5\u7a0b",
        "\u5efa\u6a21\u524d",
        "\u51c6\u5907\u5efa\u6a21",
    )
    if any(term in text for term in prepare_terms):
        return "prepare_for_modeling"

    evaluation_terms = (
        "evaluate",
        "evaluation",
        "model comparison",
        "compare models",
        "compare experiments",
        "regenerate report",
        "generate model report",
        "evaluation report",
        "metrics report",
        "model report",
        "report this model",
        "\u8bc4\u4f30",
        "\u6a21\u578b\u8bc4\u4f30",
        "\u5bf9\u6bd4\u6a21\u578b",
        "\u5bf9\u6bd4\u5b9e\u9a8c",
        "\u91cd\u65b0\u751f\u6210\u62a5\u544a",
        "\u751f\u6210\u8bc4\u4f30\u62a5\u544a",
        "\u751f\u6210\u6a21\u578b\u62a5\u544a",
        "\u8bc4\u4f30\u62a5\u544a",
    )
    if any(term in text for term in evaluation_terms):
        return "configure_evaluation"

    training_terms = (
        "train",
        "training",
        "fit model",
        "start sklearn",
        "run sklearn",
        "sklearn",
        "baseline",
        "classifier",
        "regressor",
        "\u8bad\u7ec3",
        "\u5f00\u59cb\u8bad\u7ec3",
        "\u5206\u7c7b\u5668",
        "\u56de\u5f52",
    )
    if any(term in text for term in training_terms):
        return "configure_training"

    modeling_terms = (
        "modeling",
        "model",
        "machine learning",
        "\u5efa\u6a21",
        "\u6a21\u578b",
        "\u673a\u5668\u5b66\u4e60",
        "\u7279\u5f81",
    )
    if any(term in text for term in modeling_terms):
        return "prepare_for_modeling"
    return "analysis_overview"
