from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MLAgent API"
    workspace_root: Path = Path("workspaces")
    database_url: str = "postgresql+psycopg://mlagent:mlagent@localhost:5432/mlagent"
    redis_url: str = "redis://localhost:6379/0"
    dev_user_id: str = "dev-user"
    kernel_backend: str = "local"
    kernel_image: str = "mlagent-kernel:dev"
    docker_executable: str = "docker"

    model_config = SettingsConfigDict(env_prefix="MLAGENT_", env_file=".env")


@lru_cache
def get_settings() -> Settings:
    return Settings()
