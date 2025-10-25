import asyncio
import contextlib
import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, Optional

import paho.mqtt.client as mqtt
import psycopg
import psycopg.rows
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

PG_DSN = os.getenv("PG_DSN")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
SERVER_IP = os.getenv("SERVER_IP", "localhost")

app = FastAPI(title="Aura API")

cors_origins_env = os.getenv("CORS_ORIGINS")
if cors_origins_env:
    allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    return value


def _to_jsonable(records: Iterable[Dict[str, Any]]) -> list[Dict[str, Any]]:
    return [_normalize(dict(record)) for record in records]


def _parse_iso(value: str) -> datetime:
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    return datetime.fromisoformat(candidate)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "server_ip": SERVER_IP}


@app.get("/stats")
async def stats() -> JSONResponse:
    out: dict[str, Any] = {"devices": []}
    with psycopg.connect(PG_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT device_id, MAX(ts) AS last_ts, COUNT(*) AS total_points
                FROM v_telemetry_enriched
                GROUP BY device_id
                ORDER BY last_ts DESC;
                """
            )
            rows = cur.fetchall()
            devs = [
                {
                    "device_id": r[0],
                    "last_ts": r[1].isoformat(),
                    "total_points": r[2],
                }
                for r in rows
            ]
    out["devices"] = devs
    out["db_total_points"] = sum(d["total_points"] for d in devs)
    return JSONResponse(out)


@app.get("/devices/{device_id}/series")
async def series(
    device_id: str,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    fields: Optional[str] = Query("lat,lon,speed"),
    bucket: Optional[str] = Query("1s"),
    limit: Optional[int] = Query(10000),
) -> JSONResponse:
    start_ts = start or (datetime.utcnow() - timedelta(hours=1)).isoformat()
    end_ts = end or datetime.utcnow().isoformat()
    cols = [c.strip() for c in fields.split(",") if c.strip()]
    select_cols = ", ".join([f"avg({c}) as {c}" for c in cols])
    with psycopg.connect(PG_DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT time_bucket(%s, ts) as ts_bucket, device_id,
                       {select_cols}
                FROM v_telemetry_enriched
                WHERE device_id=%s AND ts BETWEEN %s AND %s
                GROUP BY ts_bucket, device_id
                ORDER BY ts_bucket ASC
                LIMIT %s
            """,
                (bucket, device_id, start_ts, end_ts, limit),
            )
            rows = cur.fetchall()
    return JSONResponse(_to_jsonable(rows))


@app.get("/devices/{device_id}/series2")
async def series2(
    device_id: str,
    bucket: str = Query("10s"),
    window_sec: int = Query(1800, ge=60, le=86400),
    cursor: Optional[str] = Query(None),
    limit: int = Query(2000, ge=1, le=5000),
) -> JSONResponse:
    try:
        end_ts = _parse_iso(cursor) if cursor else datetime.now(timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid cursor") from exc

    start_ts = end_ts - timedelta(seconds=window_sec)

    with psycopg.connect(PG_DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    time_bucket(%s, ts) AS ts,
                    device_id,
                    avg(lat) AS lat,
                    avg(lon) AS lon,
                    avg(speed) AS speed,
                    avg(cn0_avg) AS cn0_avg,
                    avg(sats_used) AS sats_used
                FROM v_telemetry_enriched
                WHERE device_id = %s
                  AND ts >= %s
                  AND ts < %s
                GROUP BY ts, device_id
                ORDER BY ts ASC
                LIMIT %s;
                """,
                (bucket, device_id, start_ts, end_ts, limit),
            )
            rows = cur.fetchall()

    items = [_normalize(row) for row in rows]
    next_cursor = items[0]["ts"] if items else None
    return JSONResponse({"data": items, "cursor": next_cursor})


@app.get("/devices/{device_id}/last")
async def last(device_id: str) -> JSONResponse:
    with psycopg.connect(PG_DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ts, device_id, lat, lon, speed, payload
                FROM v_telemetry_enriched
                WHERE device_id=%s
                ORDER BY ts DESC
                LIMIT 1
            """,
                (device_id,),
            )
            row = cur.fetchone()
            if not row:
                return JSONResponse({"error": "not found"}, status_code=404)
            return JSONResponse(_normalize(dict(row)))


@app.websocket("/live")
@app.websocket("/ws/last")
async def ws_last(ws: WebSocket) -> None:
    await ws.accept()
    target_device = ws.query_params.get("device_id")
    client = mqtt.Client(protocol=mqtt.MQTTv5)
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def on_message(_: mqtt.Client, __: Any, message: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(message.payload.decode())
        except Exception:
            payload = {"raw": message.payload.decode(errors="ignore")}

        if target_device:
            topic_device = (message.topic or "").split("/")[-1]
            payload_device = payload.get("device_id")
            if target_device not in {topic_device, payload_device}:
                return

        loop.call_soon_threadsafe(queue.put_nowait, payload)

    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.subscribe("last/#", qos=1)
    client.loop_start()
    try:
        while True:
            item = await queue.get()
            await ws.send_json(item)
    except WebSocketDisconnect:
        pass
    finally:
        client.loop_stop()
        with contextlib.suppress(Exception):
            client.disconnect()
