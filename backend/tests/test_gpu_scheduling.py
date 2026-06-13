import asyncio
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.services.gpu_scheduler_service import (
    GPUAcquireCancelled,
    GPUAcquireTimeout,
    GPUSchedulerService,
    gpu_scheduler,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_gpu_scheduler_fifo_queue():
    scheduler = GPUSchedulerService()
    assert scheduler.status == "idle"

    # 1. Task 1 acquires GPU
    acquisition = await scheduler.acquire_gpu("task1", "proj1")
    assert acquisition["status"] == "acquired"
    assert scheduler.status == "busy"
    assert scheduler.active_task["task_id"] == "task1"
    assert len(scheduler.queue) == 0

    # 2. Task 2 requests GPU concurrently
    acquired_task2 = asyncio.Event()

    async def run_task2():
        acquisition = await scheduler.acquire_gpu("task2", "proj1")
        assert acquisition["status"] == "acquired"
        acquired_task2.set()

    task2_coro = asyncio.create_task(run_task2())
    await asyncio.sleep(0.01)  # Yield control to let task2 run and queue

    assert scheduler.status == "busy"
    assert scheduler.active_task["task_id"] == "task1"
    assert len(scheduler.queue) == 1
    assert scheduler.queue[0]["task_id"] == "task2"
    assert not acquired_task2.is_set()

    # 3. Task 3 requests GPU concurrently
    acquired_task3 = asyncio.Event()

    async def run_task3():
        acquisition = await scheduler.acquire_gpu("task3", "proj1")
        assert acquisition["status"] == "acquired"
        acquired_task3.set()

    task3_coro = asyncio.create_task(run_task3())
    await asyncio.sleep(0.01)

    assert len(scheduler.queue) == 2
    assert scheduler.queue[1]["task_id"] == "task3"
    assert not acquired_task3.is_set()

    # 4. Task 1 releases GPU, Task 2 should get it immediately
    await scheduler.release_gpu("task1")
    await asyncio.sleep(0.01)

    assert scheduler.status == "busy"
    assert scheduler.active_task["task_id"] == "task2"
    assert len(scheduler.queue) == 1
    assert scheduler.queue[0]["task_id"] == "task3"
    assert acquired_task2.is_set()
    assert not acquired_task3.is_set()

    # 5. Task 2 releases, Task 3 gets it
    await scheduler.release_gpu("task2")
    await asyncio.sleep(0.01)

    assert scheduler.status == "busy"
    assert scheduler.active_task["task_id"] == "task3"
    assert len(scheduler.queue) == 0
    assert acquired_task3.is_set()

    # 6. Task 3 releases, returns to idle
    await scheduler.release_gpu("task3")
    assert scheduler.status == "idle"
    assert scheduler.active_task is None

    # Clean up tasks
    await task2_coro
    await task3_coro


@pytest.mark.anyio
async def test_gpu_scheduler_queue_cancel_handling():
    scheduler = GPUSchedulerService()
    await scheduler.acquire_gpu("task1", "proj1")

    # Queue Task 2
    async def run_task2():
        with pytest.raises(GPUAcquireCancelled):
            await scheduler.acquire_gpu("task2", "proj1")

    task2_coro = asyncio.create_task(run_task2())
    await asyncio.sleep(0.01)

    # Queue Task 3
    task3_coro = asyncio.create_task(scheduler.acquire_gpu("task3", "proj1"))
    await asyncio.sleep(0.01)

    assert len(scheduler.queue) == 2

    # Cancel Task 2 (remove it from queue)
    result = await scheduler.cancel_task("task2")
    assert result == {"task_id": "task2", "status": "canceled", "was_active": False}
    assert len(scheduler.queue) == 1
    assert scheduler.queue[0]["task_id"] == "task3"

    # Release Task 1, Task 3 should be woken up instead of deadlocking
    await scheduler.release_gpu("task1")
    await asyncio.sleep(0.01)
    assert scheduler.active_task["task_id"] == "task3"

    # Clean up
    await scheduler.release_gpu("task3")
    await task2_coro
    await task3_coro


@pytest.mark.anyio
async def test_gpu_scheduler_timeout_removes_queued_task():
    scheduler = GPUSchedulerService()
    await scheduler.acquire_gpu("task1", "proj1")

    with pytest.raises(GPUAcquireTimeout):
        await scheduler.acquire_gpu("task2", "proj1", timeout_seconds=0.01)

    assert scheduler.get_status()["queue_length"] == 0
    assert scheduler.active_task["task_id"] == "task1"


@pytest.mark.anyio
async def test_gpu_scheduler_cancel_active_promotes_next_task():
    scheduler = GPUSchedulerService()
    await scheduler.acquire_gpu("task1", "proj1")
    task2_coro = asyncio.create_task(scheduler.acquire_gpu("task2", "proj1"))
    await asyncio.sleep(0.01)

    result = await scheduler.cancel_task("task1")
    acquired = await task2_coro

    assert result == {"task_id": "task1", "status": "canceled", "was_active": True}
    assert acquired["status"] == "acquired"
    assert scheduler.active_task["task_id"] == "task2"


def test_gpu_status_api_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    # Mock the global scheduler status for API check
    orig_status = gpu_scheduler.status
    orig_active = gpu_scheduler.active_task
    orig_queue = gpu_scheduler.queue

    try:
        gpu_scheduler.status = "busy"
        gpu_scheduler.active_task = {
            "task_id": "test_api_task",
            "project_id": "proj_123",
            "started_at": "2026-05-21T18:00:00Z"
        }
        gpu_scheduler.queue = []

        response = client.get("/api/projects/proj_123/resources/gpu/status")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "busy"
        assert payload["active_task"]["task_id"] == "test_api_task"
        assert payload["queue_length"] == 0
    finally:
        # Restore original global scheduler state
        gpu_scheduler.status = orig_status
        gpu_scheduler.active_task = orig_active
        gpu_scheduler.queue = orig_queue


def test_gpu_cancel_api_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    get_settings.cache_clear()
    client = TestClient(app)

    orig_status = gpu_scheduler.status
    orig_active = gpu_scheduler.active_task
    orig_queue = gpu_scheduler.queue

    try:
        gpu_scheduler.status = "busy"
        gpu_scheduler.active_task = {
            "task_id": "test_api_task",
            "project_id": "proj_123",
            "started_at": "2026-05-21T18:00:00Z",
        }
        gpu_scheduler.queue = []

        response = client.post("/api/projects/proj_123/resources/gpu/tasks/test_api_task/cancel")
        assert response.status_code == 200
        assert response.json() == {
            "task_id": "test_api_task",
            "status": "canceled",
            "was_active": True,
        }
        assert gpu_scheduler.status == "idle"
        assert gpu_scheduler.active_task is None
    finally:
        gpu_scheduler.status = orig_status
        gpu_scheduler.active_task = orig_active
        gpu_scheduler.queue = orig_queue
