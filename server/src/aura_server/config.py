from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configura��o central da aplica��o."""

    app_name: str = "Aura Sensor Backend"
    api_v1_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8000
    database_url: str = "sqlite+aiosqlite:///./data/aura.db"
    auth_username: str = "device-test"
    auth_password: str = "devpass"

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Retorna inst�ncia cacheada de configura��o."""

    return Settings()
