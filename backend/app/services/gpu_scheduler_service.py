import asyncio
import datetime
from typing import Any


class GPUAcquireCancelled(Exception):
    """Raised when a queued GPU request is canceled before acquisition."""


class GPUAcquireTimeout(Exception):
    """Raised when a queued GPU request waits longer than its timeout."""


class GPUSchedulerService:
    def __init__(self):
        self.status = "idle"  # "idle" | "busy"
        self.active_task: dict[str, Any] | None = None
        self.queue: list[dict[str, Any]] = []

    async def acquire_gpu(
        self,
        task_id: str,
        project_id: str,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        # If currently idle and nobody is waiting, acquire immediately
        if self.status == "idle" and not self.queue:
            self.status = "busy"
            self.active_task = self._active_record(task_id, project_id)
            return {"task_id": task_id, "status": "acquired", "queued": False}

        # Otherwise, queue and wait
        event = asyncio.Event()
        queue_item = {
            "task_id": task_id,
            "project_id": project_id,
            "event": event,
            "requested_at": self._now(),
            "result": "waiting",
        }
        self.queue.append(queue_item)

        # Suspend execution until the event is set
        try:
            if timeout_seconds is None:
                await event.wait()
            else:
                await asyncio.wait_for(event.wait(), timeout=timeout_seconds)
        except TimeoutError as exc:
            self._remove_queued_task(task_id)
            raise GPUAcquireTimeout(f"Timed out waiting for GPU: {task_id}") from exc

        if queue_item["result"] == "canceled":
            raise GPUAcquireCancelled(f"GPU request was canceled: {task_id}")
        return {"task_id": task_id, "status": "acquired", "queued": True}

    async def release_gpu(self, task_id: str) -> dict[str, Any]:
        # If releasing the active task
        if self.active_task and self.active_task["task_id"] == task_id:
            self.active_task = None
            self.status = "idle"

            # Wake up the next queued task
            self._promote_next()
            return {"task_id": task_id, "status": "released", "was_active": True}

        removed = self._remove_queued_task(task_id)
        if removed is not None:
            removed["result"] = "released"
            removed["event"].set()
            return {"task_id": task_id, "status": "released", "was_active": False}
        return {"task_id": task_id, "status": "not_found", "was_active": False}

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        if self.active_task and self.active_task["task_id"] == task_id:
            self.active_task = None
            self.status = "idle"
            self._promote_next()
            return {"task_id": task_id, "status": "canceled", "was_active": True}

        removed = self._remove_queued_task(task_id)
        if removed is not None:
            removed["result"] = "canceled"
            removed["event"].set()
            return {"task_id": task_id, "status": "canceled", "was_active": False}
        return {"task_id": task_id, "status": "not_found", "was_active": False}

    def get_status(self) -> dict:
        queue_snapshot = [
            {
                "task_id": item["task_id"],
                "project_id": item["project_id"],
                "requested_at": item["requested_at"],
                "position": index + 1,
            }
            for index, item in enumerate(self.queue)
        ]
        return {
            "status": self.status,
            "active_task": self.active_task,
            "queue": queue_snapshot,
            "queue_length": len(queue_snapshot)
        }

    def _promote_next(self) -> None:
        if not self.queue:
            return
        next_item = self.queue.pop(0)
        self.status = "busy"
        self.active_task = self._active_record(next_item["task_id"], next_item["project_id"])
        next_item["result"] = "acquired"
        next_item["event"].set()

    def _remove_queued_task(self, task_id: str) -> dict[str, Any] | None:
        for index, item in enumerate(self.queue):
            if item["task_id"] == task_id:
                return self.queue.pop(index)
        return None

    def _active_record(self, task_id: str, project_id: str) -> dict[str, Any]:
        return {
            "task_id": task_id,
            "project_id": project_id,
            "started_at": self._now(),
        }

    @staticmethod
    def _now() -> str:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

# Global singleton
gpu_scheduler = GPUSchedulerService()
