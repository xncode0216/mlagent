from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MLAgent API"
    workspace_root: Path = Path("workspaces")
    database_url: str = "postgresql+psycopg://mlagent:mlagent@localhost:5432/mlagent"
    redis_url: str = "redis://localhost:6379/0"
    dev_user_id: str = "dev-user"
    auth_mode: Literal["development", "jwt", "oidc"] = "development"
    auth_jwt_secret: SecretStr = SecretStr("")
    auth_jwt_issuer: str = ""
    auth_jwt_audience: str = ""
    auth_jwt_leeway_seconds: int = 30
    auth_oidc_issuer: str = ""
    auth_oidc_audience: str = ""
    auth_oidc_jwks_url: str = ""
    auth_oidc_jwks_cache_seconds: int = 300
    auth_oidc_jwks_timeout_seconds: float = 5.0
    auth_oidc_authorization_url: str = ""
    auth_oidc_token_url: str = ""
    auth_oidc_client_id: str = ""
    auth_oidc_client_secret: SecretStr = SecretStr("")
    auth_oidc_redirect_uri: str = ""
    auth_browser_return_url: str = ""
    auth_oidc_token_timeout_seconds: float = 5.0
    auth_login_transaction_ttl_seconds: int = 600
    auth_session_ttl_seconds: int = 28_800
    # "memory" keeps process-local browser auth state (single worker only);
    # "redis" shares login transactions and sessions across workers/instances.
    auth_session_backend: Literal["memory", "redis"] = "memory"
    log_level: str = "INFO"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]
    kernel_backend: str = "local"
    kernel_image: str = "mlagent-kernel:dev"
    docker_executable: str = "docker"
    kernel_memory_limit: str = "2g"
    kernel_cpu_limit: str = "2"
    kernel_pids_limit: int = 512
    kernel_workspace_mount_mode: str = "rw"
    gpu_acquire_timeout_seconds: float = 30.0
    llm_provider: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1024
    llm_timeout_seconds: float = 60.0

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Allow MLAGENT_CORS_ORIGINS to be a comma-separated string."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    model_config = SettingsConfigDict(env_prefix="MLAGENT_", env_file=".env")


@lru_cache
def get_settings() -> Settings:
    return Settings()
