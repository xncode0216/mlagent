from fastapi import APIRouter
from app.services.gpu_scheduler_service import gpu_scheduler

router = APIRouter(prefix="/api/projects/{project_id}/resources", tags=["resources"])


@router.get("/gpu/status")
async def get_gpu_status(project_id: str) -> dict:
    """Returns the current real-time status of the GPU resource scheduler and waiting queue."""
    status_info = gpu_scheduler.get_status()
    return status_info


@router.post("/gpu/tasks/{task_id}/cancel")
async def cancel_gpu_task(project_id: str, task_id: str) -> dict:
    """Cancel an active or queued GPU task and promote the next queued task if needed."""
    return await gpu_scheduler.cancel_task(task_id)
