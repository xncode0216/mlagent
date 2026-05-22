import asyncio
import datetime
from typing import Dict, List, Any, Optional

class GPUSchedulerService:
    def __init__(self):
        self.status = "idle"  # "idle" | "busy"
        self.active_task: Optional[Dict[str, Any]] = None
        self.queue: List[Dict[str, Any]] = []  # items: {"task_id": ..., "project_id": ..., "event": asyncio.Event(), "requested_at": ...}

    async def acquire_gpu(self, task_id: str, project_id: str):
        # If currently idle and nobody is waiting, acquire immediately
        if self.status == "idle" and not self.queue:
            self.status = "busy"
            self.active_task = {
                "task_id": task_id,
                "project_id": project_id,
                "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            return

        # Otherwise, queue and wait
        event = asyncio.Event()
        queue_item = {
            "task_id": task_id,
            "project_id": project_id,
            "event": event,
            "requested_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        self.queue.append(queue_item)

        # Suspend execution until the event is set
        await event.wait()

    async def release_gpu(self, task_id: str):
        # If releasing the active task
        if self.active_task and self.active_task["task_id"] == task_id:
            self.active_task = None
            self.status = "idle"

            # Wake up the next queued task
            if self.queue:
                next_item = self.queue.pop(0)
                self.status = "busy"
                self.active_task = {
                    "task_id": next_item["task_id"],
                    "project_id": next_item["project_id"],
                    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
                next_item["event"].set()
        else:
            # If a queued task is canceled/released before running, remove it from queue to avoid deadlock
            # Wake up the task being removed so its coroutine doesn't hang forever
            for item in self.queue:
                if item["task_id"] == task_id:
                    item["event"].set()
            self.queue = [item for item in self.queue if item["task_id"] != task_id]

    def get_status(self) -> dict:
        queue_snapshot = [
            {
                "task_id": item["task_id"],
                "project_id": item["project_id"],
                "requested_at": item["requested_at"]
            }
            for item in self.queue
        ]
        return {
            "status": self.status,
            "active_task": self.active_task,
            "queue": queue_snapshot,
            "queue_length": len(queue_snapshot)
        }

# Global singleton
gpu_scheduler = GPUSchedulerService()
