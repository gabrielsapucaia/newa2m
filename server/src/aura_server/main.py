from fastapi import FastAPI

from .config import get_settings


settings = get_settings()
app = FastAPI(title=settings.app_name)


@app.get("/", tags=["health"])
async def root() -> dict[str, str]:
    """Endpoint principal com mensagem amig�vel."""

    return {
        "message": "Aura Sensor backend online",
        "documentation": "/docs",
    }


@app.get("/health/live", tags=["health"])
async def health_live() -> dict[str, str]:
    """Verifica se a aplica��o est� viva."""

    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def health_ready() -> dict[str, str]:
    """Verifica se a aplica��o est� pronta para receber tr�fego."""

    return {
        "status": "ok",
        "database": "pending",
    }
