from fastapi import APIRouter
from app.services.gpu_scheduler_service import gpu_scheduler

router = APIRouter(prefix="/api/projects/{project_id}/resources", tags=["resources"])

@router.get("/gpu/status")
async def get_gpu_status(project_id: str) -> dict:
    """Returns the current real-time status of the GPU resource scheduler and waiting queue."""
    status_info = gpu_scheduler.get_status()
    return status_info
