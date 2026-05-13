# MLAgent Foundation, Kernel Spike, and Data Analysis MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working MLAgent vertical slice: login-ready project shell, workspace file management, Agent WebSocket streaming, Docker/Jupyter Kernel execution, and a data-analysis MVP that can load a CSV, profile it, generate artifacts, and display results in the UI.

**Architecture:** The frontend is a React + TypeScript SPA with an IDE-style shell. The backend is FastAPI, backed by PostgreSQL and Redis, with file operations constrained to per-user project workspaces. Python code runs only through a Kernel execution service, initially as a local technical spike and then behind a stable service interface.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style primitives, Zustand, TanStack Query, FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, Docker, Jupyter Client, pandas, plotly, matplotlib, pytest, Vitest, Playwright.

---

## Scope

This plan intentionally implements the first usable slice, not the full platform. The first slice includes:

- App shell matching the current UI demo.
- User/project/file foundations.
- CSV upload and preview.
- Agent chat shell with WebSocket streaming.
- Kernel execution spike and service boundary.
- Data analysis tools: `load_data`, `profile_dataset`, `detect_missing`, `correlation_matrix`, `plot_distribution`.
- Right panel tabs: chart, code, data, log.

Out of scope for this plan:

- Full ML training Agent.
- GPU scheduling.
- Production self-evolution rule consolidation.
- Knowledge graph visualization.
- Enterprise SSO.

## Target Repository Structure

```text
mlagent/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── tools/
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── infra/
│   ├── docker-compose.yml
│   └── kernel/
│       └── Dockerfile
├── docs/
└── scripts/
```

## Interface Contracts

### REST API

```http
GET    /health
POST   /api/auth/dev-login
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
GET    /api/projects/{project_id}/files
POST   /api/projects/{project_id}/files/upload
GET    /api/projects/{project_id}/files/content?path=data/customer_churn.csv
POST   /api/projects/{project_id}/sessions
GET    /api/projects/{project_id}/sessions
GET    /api/sessions/{session_id}/messages
GET    /api/artifacts/{artifact_id}
```

### WebSocket

```text
ws://localhost:8000/ws/sessions/{session_id}
```

Client event:

```json
{
  "type": "user_message",
  "content": "分析 customer_churn.csv 的缺失值和相关性",
  "context": {
    "active_file": "data/customer_churn.csv"
  }
}
```

Server events:

```ts
type AgentStreamEvent =
  | { type: "message_delta"; message_id: string; delta: string }
  | { type: "tool_call_started"; call_id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_call_finished"; call_id: string; status: "success" | "error"; result_ref?: string; error?: string }
  | { type: "kernel_output"; stream: "stdout" | "stderr"; text: string }
  | { type: "artifact_created"; artifact: Artifact }
  | { type: "task_progress"; task_id: string; progress: number; label: string }
  | { type: "error"; code: string; message: string };
```

### Artifact

```ts
type Artifact = {
  id: string;
  project_id: string;
  session_id: string;
  type: "dataframe" | "chart" | "code" | "markdown" | "log";
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
```

---

## Task 1: Create Backend Project Skeleton

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/main.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/health.py`
- Create: `backend/tests/test_health.py`

- [ ] **Step 1: Write the failing health test**

Create `backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health_returns_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "mlagent-api"}
```

- [ ] **Step 2: Create backend package metadata**

Create `backend/pyproject.toml`:

```toml
[project]
name = "mlagent-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "pydantic-settings>=2.6.0",
  "sqlalchemy>=2.0.0",
  "psycopg[binary]>=3.2.0",
  "alembic>=1.13.0",
  "redis>=5.0.0",
  "python-multipart>=0.0.9",
  "pandas>=2.2.0",
  "plotly>=5.24.0",
  "matplotlib>=3.9.0",
  "jupyter-client>=8.6.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.3.0",
  "httpx>=0.27.0",
  "ruff>=0.6.0",
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"
```

- [ ] **Step 3: Implement config**

Create `backend/app/core/config.py`:

```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MLAgent API"
    workspace_root: Path = Path("workspaces")
    database_url: str = "postgresql+psycopg://mlagent:mlagent@localhost:5432/mlagent"
    redis_url: str = "redis://localhost:6379/0"
    dev_user_id: str = "dev-user"

    model_config = SettingsConfigDict(env_prefix="MLAGENT_", env_file=".env")


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Implement health route**

Create `backend/app/api/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mlagent-api"}
```

Create `backend/app/api/__init__.py`:

```python
from app.api import health

__all__ = ["health"]
```

Create `backend/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router

app = FastAPI(title="MLAgent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
```

- [ ] **Step 5: Run the backend test**

Run:

```powershell
cd backend
python -m pip install -e ".[dev]"
pytest tests/test_health.py -v
```

Expected:

```text
tests/test_health.py::test_health_returns_ok PASSED
```

- [ ] **Step 6: Commit**

```powershell
git add backend
git commit -m "feat: initialize FastAPI backend"
```

---

## Task 2: Add Infrastructure Compose File

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/kernel/Dockerfile`
- Modify: `.gitignore`

- [ ] **Step 1: Create Docker Compose**

Create `infra/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: mlagent
      POSTGRES_PASSWORD: mlagent
      POSTGRES_DB: mlagent
    ports:
      - "5432:5432"
    volumes:
      - mlagent_postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mlagent -d mlagent"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    volumes:
      - mlagent_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  mlagent_postgres:
  mlagent_redis:
```

- [ ] **Step 2: Create Kernel Dockerfile**

Create `infra/kernel/Dockerfile`:

```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir \
    ipykernel \
    pandas \
    numpy \
    scipy \
    scikit-learn \
    matplotlib \
    seaborn \
    plotly \
    xgboost \
    lightgbm

WORKDIR /workspace
```

- [ ] **Step 3: Extend `.gitignore`**

Ensure `.gitignore` contains:

```gitignore
workspaces/
.env
.venv/
node_modules/
dist/
__pycache__/
.pytest_cache/
.ruff_cache/
.demo-server*.log
```

- [ ] **Step 4: Validate compose syntax**

Run:

```powershell
docker compose -f infra/docker-compose.yml config
```

Expected: Docker Compose renders normalized service config without errors.

- [ ] **Step 5: Commit**

```powershell
git add infra .gitignore
git commit -m "chore: add local database and kernel infrastructure"
```

---

## Task 3: Create Database Models and Workspace Service

**Files:**
- Create: `backend/app/db/base.py`
- Create: `backend/app/db/session.py`
- Create: `backend/app/models/project.py`
- Create: `backend/app/models/session.py`
- Create: `backend/app/models/artifact.py`
- Create: `backend/app/services/workspace_service.py`
- Create: `backend/tests/test_workspace_service.py`

- [ ] **Step 1: Write workspace path safety tests**

Create `backend/tests/test_workspace_service.py`:

```python
from pathlib import Path

import pytest

from app.services.workspace_service import WorkspaceService


def test_project_root_is_created_under_workspace(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    assert root == tmp_path / "user-1" / "project-1"
    assert root.exists()


def test_safe_path_allows_nested_project_file(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    path = service.resolve_project_path(root, "data/example.csv")
    assert path == root / "data" / "example.csv"


def test_safe_path_blocks_parent_escape(tmp_path: Path):
    service = WorkspaceService(tmp_path)
    root = service.ensure_project_root("user-1", "project-1")
    with pytest.raises(ValueError, match="escapes project workspace"):
        service.resolve_project_path(root, "../secret.txt")
```

- [ ] **Step 2: Implement database base**

Create `backend/app/db/base.py`:

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

Create `backend/app/db/session.py`:

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Implement models**

Create `backend/app/models/project.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(255))
    workspace_path: Mapped[str] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

Create `backend/app/models/session.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    mode: Mapped[str] = mapped_column(String(32), default="data-analysis")
    title: Mapped[str] = mapped_column(String(255), default="Untitled Session")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

Create `backend/app/models/artifact.py`:

```python
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.id"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(1024))
    artifact_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 4: Implement workspace service**

Create `backend/app/services/workspace_service.py`:

```python
from pathlib import Path


class WorkspaceService:
    def __init__(self, workspace_root: Path):
        self.workspace_root = workspace_root.resolve()

    def ensure_project_root(self, user_id: str, project_id: str) -> Path:
        root = (self.workspace_root / user_id / project_id).resolve()
        root.mkdir(parents=True, exist_ok=True)
        for child in ["data", "notebooks", "results", "models", "agent_schema", "evolution", "logs"]:
            (root / child).mkdir(exist_ok=True)
        return root

    def resolve_project_path(self, project_root: Path, relative_path: str) -> Path:
        root = project_root.resolve()
        candidate = (root / relative_path).resolve()
        if root != candidate and root not in candidate.parents:
            raise ValueError(f"Path escapes project workspace: {relative_path}")
        return candidate
```

- [ ] **Step 5: Run tests**

Run:

```powershell
cd backend
pytest tests/test_workspace_service.py -v
```

Expected:

```text
3 passed
```

- [ ] **Step 6: Commit**

```powershell
git add backend/app/db backend/app/models backend/app/services backend/tests/test_workspace_service.py
git commit -m "feat: add project workspace safety service"
```

---

## Task 4: Implement Project and File APIs

**Files:**
- Create: `backend/app/schemas/project.py`
- Create: `backend/app/schemas/file.py`
- Create: `backend/app/api/projects.py`
- Create: `backend/app/api/files.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_project_file_api.py`

- [ ] **Step 1: Write API tests**

Create `backend/tests/test_project_file_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_create_project_and_list_files(tmp_path, monkeypatch):
    monkeypatch.setenv("MLAGENT_WORKSPACE_ROOT", str(tmp_path))
    client = TestClient(app)

    response = client.post("/api/projects", json={"name": "sales_churn_analysis"})
    assert response.status_code == 200
    project = response.json()
    assert project["name"] == "sales_churn_analysis"

    files_response = client.get(f"/api/projects/{project['id']}/files")
    assert files_response.status_code == 200
    names = {item["name"] for item in files_response.json()["items"]}
    assert {"data", "notebooks", "results", "models", "agent_schema", "evolution", "logs"} <= names
```

- [ ] **Step 2: Create schemas**

Create `backend/app/schemas/project.py`:

```python
from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectRead(BaseModel):
    id: str
    owner_id: str
    name: str
    workspace_path: str
```

Create `backend/app/schemas/file.py`:

```python
from pydantic import BaseModel


class FileItem(BaseModel):
    name: str
    path: str
    type: str
    size: int | None = None


class FileList(BaseModel):
    items: list[FileItem]
```

- [ ] **Step 3: Implement project API**

Create `backend/app/api/projects.py`:

```python
from uuid import uuid4

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.project import ProjectCreate, ProjectRead
from app.services.workspace_service import WorkspaceService

router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS: dict[str, ProjectRead] = {}


@router.get("")
def list_projects() -> list[ProjectRead]:
    return list(PROJECTS.values())


@router.post("")
def create_project(payload: ProjectCreate) -> ProjectRead:
    settings = get_settings()
    project_id = uuid4().hex
    service = WorkspaceService(settings.workspace_root)
    root = service.ensure_project_root(settings.dev_user_id, project_id)
    project = ProjectRead(
        id=project_id,
        owner_id=settings.dev_user_id,
        name=payload.name,
        workspace_path=str(root),
    )
    PROJECTS[project_id] = project
    return project


@router.get("/{project_id}")
def get_project(project_id: str) -> ProjectRead:
    return PROJECTS[project_id]
```

- [ ] **Step 4: Implement file API**

Create `backend/app/api/files.py`:

```python
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.api.projects import PROJECTS
from app.schemas.file import FileItem, FileList

router = APIRouter(prefix="/api/projects/{project_id}/files", tags=["files"])


@router.get("")
def list_files(project_id: str, path: str = "") -> FileList:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    root = Path(project.workspace_path).resolve()
    current = (root / path).resolve()
    if root != current and root not in current.parents:
        raise HTTPException(status_code=400, detail="Invalid path")

    items: list[FileItem] = []
    for child in sorted(current.iterdir(), key=lambda item: (item.is_file(), item.name.lower())):
        item_type = "directory" if child.is_dir() else "file"
        items.append(
            FileItem(
                name=child.name,
                path=str(child.relative_to(root)).replace("\\", "/"),
                type=item_type,
                size=child.stat().st_size if child.is_file() else None,
            )
        )
    return FileList(items=items)
```

- [ ] **Step 5: Register routers**

Modify `backend/app/main.py`:

```python
from app.api.files import router as files_router
from app.api.health import router as health_router
from app.api.projects import router as projects_router

app.include_router(health_router)
app.include_router(projects_router)
app.include_router(files_router)
```

- [ ] **Step 6: Run API test**

Run:

```powershell
cd backend
pytest tests/test_project_file_api.py -v
```

Expected:

```text
test_create_project_and_list_files PASSED
```

- [ ] **Step 7: Commit**

```powershell
git add backend/app/api backend/app/schemas backend/app/main.py backend/tests/test_project_file_api.py
git commit -m "feat: add project and file listing APIs"
```

---

## Task 5: Create Frontend Project Skeleton

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/app/App.tsx`
- Create: `frontend/src/app/AppShell.tsx`
- Create: `frontend/src/styles.css`

- [ ] **Step 1: Create package file**

Create `frontend/package.json`:

```json
{
  "name": "mlagent-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5174",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 4174",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "lucide-react": "^0.468.0",
    "vite": "^6.0.0",
    "typescript": "^5.6.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.60.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "eslint": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create Vite config**

Create `frontend/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
});
```

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 3: Create React entry**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MLAgent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Create first app shell**

Create `frontend/src/app/App.tsx`:

```tsx
import { AppShell } from "./AppShell";

export function App() {
  return <AppShell />;
}
```

Create `frontend/src/app/AppShell.tsx`:

```tsx
export function AppShell() {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs">
          <button className="active">数据分析</button>
          <button>机器学习</button>
          <button>自进化知识</button>
        </nav>
        <div className="model-selector">Claude / DeepSeek / Local vLLM</div>
      </header>
      <aside className="file-sidebar">项目文件</aside>
      <main className="agent-workspace">数据分析 Agent</main>
      <section className="right-panel">图表 / 代码 / 数据 / 训练 / 日志</section>
      <footer className="status-bar">Kernel Ready · WebSocket Connected · CPU/MEM</footer>
    </div>
  );
}
```

Create `frontend/src/styles.css`:

```css
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0a0a0f;
  color: #cdd6f4;
}

body {
  margin: 0;
}

button {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 260px minmax(420px, 1fr) 420px;
  grid-template-rows: 48px 1fr 28px;
  height: 100vh;
  background: #0a0a0f;
}

.top-nav {
  grid-column: 1 / 4;
  display: flex;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid #313244;
  background: #11111b;
  padding: 0 14px;
}

.brand {
  font-weight: 700;
  color: #f5f5f5;
}

.mode-tabs {
  display: flex;
  gap: 6px;
}

.mode-tabs button {
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #a6adc8;
  padding: 6px 10px;
}

.mode-tabs button.active {
  border-color: #45475a;
  background: #181825;
  color: #89b4fa;
}

.model-selector {
  margin-left: auto;
  color: #a6adc8;
  font-size: 13px;
}

.file-sidebar,
.agent-workspace,
.right-panel {
  min-height: 0;
  border-right: 1px solid #313244;
  padding: 14px;
  background: #0f0f17;
}

.agent-workspace {
  background: #0a0a0f;
}

.right-panel {
  border-right: 0;
  background: #11111b;
}

.status-bar {
  grid-column: 1 / 4;
  border-top: 1px solid #313244;
  background: #11111b;
  color: #a6adc8;
  font-size: 12px;
  display: flex;
  align-items: center;
  padding: 0 12px;
}
```

- [ ] **Step 5: Install and build**

Run:

```powershell
cd frontend
npm install
npm run build
```

Expected: Vite build succeeds and outputs `dist/`.

- [ ] **Step 6: Commit**

```powershell
git add frontend
git commit -m "feat: initialize React app shell"
```

---

## Task 6: Implement Agent WebSocket Fake Stream

**Files:**
- Create: `backend/app/api/ws.py`
- Modify: `backend/app/main.py`
- Create: `frontend/src/features/chat/types.ts`
- Create: `frontend/src/features/chat/useAgentStream.ts`
- Modify: `frontend/src/app/AppShell.tsx`

- [ ] **Step 1: Implement backend fake stream**

Create `backend/app/api/ws.py`:

```python
import asyncio
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") != "user_message":
                await websocket.send_json({"type": "error", "code": "bad_event", "message": "Unsupported event"})
                continue

            message_id = uuid4().hex
            call_id = uuid4().hex
            await websocket.send_json({"type": "tool_call_started", "call_id": call_id, "tool": "profile_dataset", "args": payload.get("context", {})})
            await asyncio.sleep(0.2)
            await websocket.send_json({"type": "tool_call_finished", "call_id": call_id, "status": "success"})

            text = "我会先读取数据集结构，然后分析缺失值、字段类型和相关性，并把结果放到右侧面板。"
            for chunk in text:
                await websocket.send_json({"type": "message_delta", "message_id": message_id, "delta": chunk})
                await asyncio.sleep(0.01)

            await websocket.send_json({"type": "task_progress", "task_id": session_id, "progress": 1, "label": "完成"})
    except WebSocketDisconnect:
        return
```

- [ ] **Step 2: Register websocket router**

Modify `backend/app/main.py`:

```python
from app.api.ws import router as ws_router

app.include_router(ws_router)
```

- [ ] **Step 3: Create frontend stream types**

Create `frontend/src/features/chat/types.ts`:

```ts
export type AgentStreamEvent =
  | { type: "message_delta"; message_id: string; delta: string }
  | { type: "tool_call_started"; call_id: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_call_finished"; call_id: string; status: "success" | "error"; result_ref?: string; error?: string }
  | { type: "kernel_output"; stream: "stdout" | "stderr"; text: string }
  | { type: "artifact_created"; artifact: Artifact }
  | { type: "task_progress"; task_id: string; progress: number; label: string }
  | { type: "error"; code: string; message: string };

export type Artifact = {
  id: string;
  project_id: string;
  session_id: string;
  type: "dataframe" | "chart" | "code" | "markdown" | "log";
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
```

- [ ] **Step 4: Create WebSocket hook**

Create `frontend/src/features/chat/useAgentStream.ts`:

```ts
import { useEffect, useRef, useState } from "react";

import type { AgentStreamEvent } from "./types";

export function useAgentStream(sessionId: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<AgentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(`ws://127.0.0.1:8000/ws/sessions/${sessionId}`);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => {
      setEvents((current) => [...current, JSON.parse(message.data) as AgentStreamEvent]);
    };
    return () => socket.close();
  }, [sessionId]);

  function sendMessage(content: string, activeFile: string) {
    socketRef.current?.send(
      JSON.stringify({
        type: "user_message",
        content,
        context: { active_file: activeFile },
      }),
    );
  }

  return { connected, events, sendMessage };
}
```

- [ ] **Step 5: Render fake stream in AppShell**

Modify `frontend/src/app/AppShell.tsx` so the center panel has a button that sends a sample message and renders event JSON:

```tsx
import { useAgentStream } from "../features/chat/useAgentStream";

export function AppShell() {
  const { connected, events, sendMessage } = useAgentStream("dev-session");

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">MLAgent</div>
        <nav className="mode-tabs">
          <button className="active">数据分析</button>
          <button>机器学习</button>
          <button>自进化知识</button>
        </nav>
        <div className="model-selector">Claude / DeepSeek / Local vLLM</div>
      </header>
      <aside className="file-sidebar">项目文件</aside>
      <main className="agent-workspace">
        <h2>数据分析 Agent</h2>
        <button onClick={() => sendMessage("分析缺失值", "data/customer_churn.csv")}>发送示例分析请求</button>
        <pre>{events.map((event) => JSON.stringify(event)).join("\n")}</pre>
      </main>
      <section className="right-panel">图表 / 代码 / 数据 / 训练 / 日志</section>
      <footer className="status-bar">{connected ? "WebSocket Connected" : "WebSocket Disconnected"}</footer>
    </div>
  );
}
```

- [ ] **Step 6: Run backend and frontend manually**

Terminal 1:

```powershell
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

Open:

```text
http://127.0.0.1:5174
```

Expected: clicking the sample button shows WebSocket events in the center panel.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/api/ws.py backend/app/main.py frontend/src
git commit -m "feat: add agent websocket streaming skeleton"
```

---

## Task 7: Kernel Execution Technical Spike

**Files:**
- Create: `backend/app/services/kernel_service.py`
- Create: `backend/tests/test_kernel_service.py`

- [ ] **Step 1: Write test for pure execution interface**

Create `backend/tests/test_kernel_service.py`:

```python
from app.services.kernel_service import LocalPythonKernelService


def test_executes_python_and_returns_stdout():
    service = LocalPythonKernelService()
    result = service.execute("print('hello mlagent')")
    assert result.stdout.strip() == "hello mlagent"
    assert result.stderr == ""
    assert result.status == "ok"
```

- [ ] **Step 2: Implement minimal local execution service**

Create `backend/app/services/kernel_service.py`:

```python
import subprocess
from dataclasses import dataclass


@dataclass
class KernelExecutionResult:
    status: str
    stdout: str
    stderr: str


class LocalPythonKernelService:
    def execute(self, code: str, timeout_seconds: int = 10) -> KernelExecutionResult:
        process = subprocess.run(
            ["python", "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return KernelExecutionResult(
            status="ok" if process.returncode == 0 else "error",
            stdout=process.stdout,
            stderr=process.stderr,
        )
```

- [ ] **Step 3: Run test**

Run:

```powershell
cd backend
pytest tests/test_kernel_service.py -v
```

Expected:

```text
test_executes_python_and_returns_stdout PASSED
```

- [ ] **Step 4: Replace local implementation with Jupyter/Docker service after spike**

Modify `backend/app/services/kernel_service.py` in a later commit to introduce:

```python
class KernelServiceProtocol(Protocol):
    def execute(self, code: str, timeout_seconds: int = 60) -> KernelExecutionResult:
        ...
```

Then add `JupyterKernelService` behind the same protocol. Keep callers dependent on the protocol, not on subprocess or Jupyter internals.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/services/kernel_service.py backend/tests/test_kernel_service.py
git commit -m "spike: add kernel execution service boundary"
```

---

## Task 8: Data Analysis Tool MVP

**Files:**
- Create: `backend/app/tools/data_analysis/profile_dataset.py`
- Create: `backend/app/tools/data_analysis/detect_missing.py`
- Create: `backend/app/tools/data_analysis/correlation_matrix.py`
- Create: `backend/app/tools/data_analysis/__init__.py`
- Create: `backend/tests/test_data_analysis_tools.py`

- [ ] **Step 1: Write tests with small DataFrame**

Create `backend/tests/test_data_analysis_tools.py`:

```python
from pathlib import Path

import pandas as pd

from app.tools.data_analysis.correlation_matrix import correlation_matrix
from app.tools.data_analysis.detect_missing import detect_missing
from app.tools.data_analysis.profile_dataset import profile_dataset


def write_sample_csv(path: Path):
    df = pd.DataFrame(
        {
            "age": [20, 30, None],
            "monthly_charges": [50.0, 80.0, 90.0],
            "churn": [0, 1, 1],
        }
    )
    df.to_csv(path, index=False)


def test_profile_dataset(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = profile_dataset(csv_path)
    assert result["row_count"] == 3
    assert result["column_count"] == 3
    assert result["columns"]["age"]["dtype"] in {"float64", "Float64"}


def test_detect_missing(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = detect_missing(csv_path)
    assert result["columns"]["age"]["missing_count"] == 1


def test_correlation_matrix(tmp_path: Path):
    csv_path = tmp_path / "sample.csv"
    write_sample_csv(csv_path)
    result = correlation_matrix(csv_path)
    assert "monthly_charges" in result["columns"]
    assert len(result["matrix"]) == 3
```

- [ ] **Step 2: Implement profile tool**

Create `backend/app/tools/data_analysis/profile_dataset.py`:

```python
from pathlib import Path
from typing import Any

import pandas as pd


def profile_dataset(csv_path: Path, sample_rows: int = 20) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    return {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": {
            column: {
                "dtype": str(df[column].dtype),
                "missing_count": int(df[column].isna().sum()),
                "missing_ratio": float(df[column].isna().mean()),
            }
            for column in df.columns
        },
        "sample": df.head(sample_rows).to_dict(orient="records"),
    }
```

- [ ] **Step 3: Implement missing tool**

Create `backend/app/tools/data_analysis/detect_missing.py`:

```python
from pathlib import Path
from typing import Any

import pandas as pd


def detect_missing(csv_path: Path) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    columns = {}
    for column in df.columns:
        missing_count = int(df[column].isna().sum())
        columns[column] = {
            "missing_count": missing_count,
            "missing_ratio": float(missing_count / len(df)) if len(df) else 0.0,
        }
    return {"columns": columns}
```

- [ ] **Step 4: Implement correlation tool**

Create `backend/app/tools/data_analysis/correlation_matrix.py`:

```python
from pathlib import Path
from typing import Any

import pandas as pd


def correlation_matrix(csv_path: Path) -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    numeric_df = df.select_dtypes(include="number")
    corr = numeric_df.corr(numeric_only=True).fillna(0)
    return {
        "columns": list(corr.columns),
        "matrix": corr.round(4).values.tolist(),
    }
```

Create `backend/app/tools/data_analysis/__init__.py`:

```python
from app.tools.data_analysis.correlation_matrix import correlation_matrix
from app.tools.data_analysis.detect_missing import detect_missing
from app.tools.data_analysis.profile_dataset import profile_dataset

__all__ = ["correlation_matrix", "detect_missing", "profile_dataset"]
```

- [ ] **Step 5: Run tests**

Run:

```powershell
cd backend
pytest tests/test_data_analysis_tools.py -v
```

Expected:

```text
3 passed
```

- [ ] **Step 6: Commit**

```powershell
git add backend/app/tools backend/tests/test_data_analysis_tools.py
git commit -m "feat: add data analysis tool MVP"
```

---

## Task 9: Connect Fake Agent to Data Analysis Tools

**Files:**
- Create: `backend/app/services/artifact_service.py`
- Modify: `backend/app/api/ws.py`
- Test: `backend/tests/test_artifact_service.py`

- [ ] **Step 1: Write artifact service test**

Create `backend/tests/test_artifact_service.py`:

```python
from pathlib import Path

from app.services.artifact_service import ArtifactService


def test_writes_json_artifact(tmp_path: Path):
    service = ArtifactService(tmp_path)
    artifact = service.write_json(
        project_id="project-1",
        session_id="session-1",
        artifact_type="dataframe",
        name="profile.json",
        payload={"row_count": 3},
    )
    assert artifact.path.exists()
    assert artifact.metadata["type"] == "dataframe"
```

- [ ] **Step 2: Implement artifact service**

Create `backend/app/services/artifact_service.py`:

```python
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4


@dataclass
class ArtifactRecord:
    id: str
    path: Path
    metadata: dict[str, Any]


class ArtifactService:
    def __init__(self, project_root: Path):
        self.project_root = project_root

    def write_json(
        self,
        project_id: str,
        session_id: str,
        artifact_type: str,
        name: str,
        payload: dict[str, Any],
    ) -> ArtifactRecord:
        artifact_id = uuid4().hex
        artifact_dir = self.project_root / "results" / session_id
        artifact_dir.mkdir(parents=True, exist_ok=True)
        path = artifact_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return ArtifactRecord(
            id=artifact_id,
            path=path,
            metadata={
                "id": artifact_id,
                "project_id": project_id,
                "session_id": session_id,
                "type": artifact_type,
                "name": name,
            },
        )
```

- [ ] **Step 3: Run artifact test**

Run:

```powershell
cd backend
pytest tests/test_artifact_service.py -v
```

Expected:

```text
test_writes_json_artifact PASSED
```

- [ ] **Step 4: Modify websocket handler to call tools**

Modify `backend/app/api/ws.py` so a user message with `active_file` runs `profile_dataset`, `detect_missing`, and `correlation_matrix`, then emits `artifact_created` events. The emitted artifact shape must match the `Artifact` type in the interface contract.

- [ ] **Step 5: Manual test**

Run backend and frontend. Send the example request. Expected right-side logs show:

```text
tool_call_started profile_dataset
tool_call_finished profile_dataset success
artifact_created profile.json
artifact_created missing.json
artifact_created correlation.json
```

- [ ] **Step 6: Commit**

```powershell
git add backend/app/services/artifact_service.py backend/app/api/ws.py backend/tests/test_artifact_service.py
git commit -m "feat: emit data analysis artifacts from agent stream"
```

---

## Task 10: Polish the First Usable UI Slice

**Files:**
- Create: `frontend/src/features/files/FileExplorer.tsx`
- Create: `frontend/src/features/chat/AgentWorkspace.tsx`
- Create: `frontend/src/features/right-panel/RightPanel.tsx`
- Create: `frontend/src/features/logs/LogPanel.tsx`
- Modify: `frontend/src/app/AppShell.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Create FileExplorer**

Create a static-then-API-ready `FileExplorer.tsx`:

```tsx
const demoItems = ["data/customer_churn.csv", "notebooks/eda.py", "results/profile.json", "models/", "agent_schema/", "evolution/"];

export function FileExplorer() {
  return (
    <div>
      <div className="panel-title">项目文件</div>
      <ul className="file-list">
        {demoItems.map((item) => (
          <li key={item} className={item.includes("customer_churn") ? "selected" : ""}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create AgentWorkspace**

Create `AgentWorkspace.tsx` using `useAgentStream`, with a composer input and event rendering split into message, tools, and logs.

- [ ] **Step 3: Create RightPanel**

Create `RightPanel.tsx` with tabs:

```ts
const tabs = ["图表", "代码", "数据", "训练", "日志"] as const;
```

Only `日志` needs live event data in this slice. Other tabs can show stable empty states.

- [ ] **Step 4: Wire components into AppShell**

Modify `AppShell.tsx` to render `FileExplorer`, `AgentWorkspace`, and `RightPanel`.

- [ ] **Step 5: Run frontend build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build passes.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src
git commit -m "feat: assemble first MLAgent workspace UI slice"
```

---

## Verification Checklist

Run before claiming the first slice complete:

```powershell
cd backend
pytest -v
```

```powershell
cd frontend
npm run build
```

Manual check:

1. Start backend on `127.0.0.1:8000`.
2. Start frontend on `127.0.0.1:5174`.
3. Open the UI.
4. Confirm the IDE shell renders.
5. Click the sample Agent request.
6. Confirm WebSocket events stream.
7. Confirm logs appear in the right panel.
8. Confirm data-analysis artifacts are created for a sample CSV.

## Self-Review Notes

- Spec coverage: This plan covers the first usable slice from the UI demo: app shell, project files, Agent stream, Kernel boundary, data analysis tools, right-side logs/artifacts.
- Placeholder scan: No unresolved placeholder markers remain. Later full Jupyter/Docker Kernel replacement is intentionally outside this slice; the plan creates a protocol boundary first.
- Type consistency: `AgentStreamEvent`, `Artifact`, and `LogEvent` naming matches the UI demo development document.
- Scope check: ML training, GPU, and full self-evolution are separate future plans because they depend on the Agent stream, task queue, and artifact model created here.
