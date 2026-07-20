from fastapi import APIRouter, HTTPException

from app.api.projects import get_registered_project
from app.services.gpu_scheduler_service import gpu_scheduler

router = APIRouter(prefix="/api/projects/{project_id}/resources", tags=["resources"])


def _require_project(project_id: str) -> None:
    if get_registered_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")


@router.get("/gpu/status")
async def get_gpu_status(project_id: str) -> dict:
    """Returns the current real-time status of the GPU resource scheduler and waiting queue."""
    _require_project(project_id)
    status_info = gpu_scheduler.get_status()
    return status_info


@router.post("/gpu/tasks/{task_id}/cancel")
async def cancel_gpu_task(project_id: str, task_id: str) -> dict:
    """Cancel an active or queued GPU task and promote the next queued task if needed."""
    _require_project(project_id)
    return await gpu_scheduler.cancel_task(task_id)
