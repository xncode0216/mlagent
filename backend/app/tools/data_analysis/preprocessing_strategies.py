"""预处理策略的**唯一词表**：计划生成、计划执行、管道脚本三处都从这里取。

此前这些策略在三个地方各写死一遍——计划的 ``steps`` 声明 median/most_frequent/
one_hot，执行器 ``_numeric_transform`` / ``_categorical_transform`` 自己硬编码同样的
值，管道脚本模板里又写死一次 ``SimpleImputer(strategy='median')``。四个字段里只有
``scaler`` 真的被执行器读取，另外三个是**有声明无消费方**：改计划里的 ``imputer``
不会改变任何行为，而变换报告仍会回报硬编码的那个值，于是计划在说谎。

所以策略必须同源，并且**每个字段要么被消费、要么被拒绝**——不支持的取值直接报错，
不允许静默忽略。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

NUMERIC_IMPUTERS = ("median", "mean", "zero")
NUMERIC_SCALERS = ("standard", "minmax", "none")
CATEGORICAL_IMPUTERS = ("most_frequent", "constant")
# 目前只实现这一种编码。仍然校验它，是为了让"计划里写了别的编码器"立刻失败，
# 而不是被静默当成 one-hot 执行——后者正是本模块要消灭的那类谎报。
CATEGORICAL_ENCODERS = ("one_hot_ignore_unknown",)

#: 类别列选择常量填充时写入的占位值，同时也是 one-hot 后的列名后缀来源。
CATEGORICAL_FILL_VALUE = "__missing__"


def _validate(field: str, value: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise ValueError(f"Unsupported {field} {value!r}; expected one of {', '.join(allowed)}")
    return value


@dataclass(frozen=True)
class PreprocessingStrategies:
    """一份计划里各列类型的处理策略。默认值即此前硬编码的那一组，行为不变。"""

    numeric_imputer: str = "median"
    numeric_scaler: str = "standard"
    categorical_imputer: str = "most_frequent"
    categorical_encoder: str = "one_hot_ignore_unknown"

    def __post_init__(self) -> None:
        _validate("numeric imputer", self.numeric_imputer, NUMERIC_IMPUTERS)
        _validate("numeric scaler", self.numeric_scaler, NUMERIC_SCALERS)
        _validate("categorical imputer", self.categorical_imputer, CATEGORICAL_IMPUTERS)
        _validate("categorical encoder", self.categorical_encoder, CATEGORICAL_ENCODERS)

    def as_steps_fields(self) -> dict[str, dict[str, str]]:
        """写进计划 ``steps`` 的策略字段（选择器等派生内容由调用方补上）。"""
        return {
            "numeric": {"imputer": self.numeric_imputer, "scaler": self.numeric_scaler},
            "categorical": {
                "imputer": self.categorical_imputer,
                "encoder": self.categorical_encoder,
            },
        }


def strategy_metadata(steps: Any) -> dict[str, str]:
    """产物 metadata 里要携带的策略字段。

    前端计划卡片的选择器靠它显示当前取值——卡片只拿得到事件里的 props（来自产物
    metadata），拿不到计划文件本身。不带上就等于有选择器却不知道选中的是哪个。
    """
    strategies = strategies_from_steps(steps)
    return {
        "numeric_imputer": strategies.numeric_imputer,
        "numeric_scaler": strategies.numeric_scaler,
        "categorical_imputer": strategies.categorical_imputer,
    }


def strategies_from_steps(steps: Any) -> PreprocessingStrategies:
    """从计划的 ``steps`` 还原策略。

    缺字段时回退到默认值——旧计划文件没有这些键，不能因此拒绝执行；但**取值非法时
    直接抛错**，因为那意味着计划要求的处理方式我们根本做不到。
    """
    numeric = steps.get("numeric") if isinstance(steps, dict) else None
    categorical = steps.get("categorical") if isinstance(steps, dict) else None
    defaults = PreprocessingStrategies()

    def pick(source: Any, key: str, fallback: str) -> str:
        value = source.get(key) if isinstance(source, dict) else None
        return value if isinstance(value, str) and value else fallback

    return PreprocessingStrategies(
        numeric_imputer=pick(numeric, "imputer", defaults.numeric_imputer),
        numeric_scaler=pick(numeric, "scaler", defaults.numeric_scaler),
        categorical_imputer=pick(categorical, "imputer", defaults.categorical_imputer),
        categorical_encoder=pick(categorical, "encoder", defaults.categorical_encoder),
    )
