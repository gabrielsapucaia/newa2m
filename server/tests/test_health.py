import pytest
from httpx import AsyncClient

from aura_server.main import app


@pytest.mark.asyncio
async def test_health_endpoints() -> None:
    async with AsyncClient(app=app, base_url="http://testserver") as client:
        live = await client.get("/health/live")
        ready = await client.get("/health/ready")
        root = await client.get("/")

    assert live.status_code == 200
    assert ready.status_code == 200
    assert root.status_code == 200
    assert live.json()["status"] == "ok"
    assert ready.json()["status"] == "ok"
    assert "Aura Sensor" in root.json()["message"]
