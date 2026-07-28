"""机器学习 API，拆分为按职责内聚的子模块（P3-5 切片 4）。

原本是单文件 `machine_learning.py`（1,228 行）。依赖是单向的：
`support` → `report` / `bundle` / `failure_state` → `runs` / `training` → 这里。
路由前缀与路径保持不变，`app.main` 的导入方式也不变。
"""

from fastapi import APIRouter

from app.api.machine_learning.runs import router as runs_router
from app.api.machine_learning.training import router as training_router

# 测试用 `app.api.machine_learning.gpu_scheduler` patch 这个单例的方法。它是对象
# 属性替换，对所有引用该单例的模块生效，因此这里继续暴露它。
from app.services.gpu_scheduler_service import gpu_scheduler

router = APIRouter(prefix="/api/projects/{project_id}/ml", tags=["machine-learning"])
router.include_router(runs_router)
router.include_router(training_router)

__all__ = ["gpu_scheduler", "router"]
