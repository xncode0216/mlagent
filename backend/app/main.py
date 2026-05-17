from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.evolution import router as evolution_router
from app.api.files import router as files_router
from app.api.health import router as health_router
from app.api.machine_learning import router as machine_learning_router
from app.api.projects import router as projects_router
from app.api.sessions import router as sessions_router
from app.api.ws import router as ws_router

app = FastAPI(title="MLAgent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(projects_router)
app.include_router(files_router)
app.include_router(machine_learning_router)
app.include_router(evolution_router)
app.include_router(sessions_router)
app.include_router(ws_router)
