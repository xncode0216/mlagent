from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.data_analysis import router as data_analysis_router
from app.api.evolution import router as evolution_router
from app.api.files import router as files_router
from app.api.health import router as health_router
from app.api.llm import router as llm_router
from app.api.machine_learning import router as machine_learning_router
from app.api.projects import router as projects_router
from app.api.resources import router as resources_router
from app.api.sessions import router as sessions_router
from app.api.ws import router as ws_router
from app.core.config import get_settings
from app.core.observability import install_observability

settings = get_settings()

app = FastAPI(title=settings.app_name)

install_observability(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(llm_router)
app.include_router(projects_router)
app.include_router(files_router)
app.include_router(data_analysis_router)
app.include_router(machine_learning_router)
app.include_router(evolution_router)
app.include_router(resources_router)
app.include_router(sessions_router)
app.include_router(ws_router)
