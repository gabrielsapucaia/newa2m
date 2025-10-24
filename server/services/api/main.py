import asyncio
import json
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, Optional

import paho.mqtt.client as mqtt
import psycopg
import psycopg.rows
from fastapi import FastAPI, Query, WebSocket
from fastapi.responses import JSONResponse

PG_DSN = os.getenv("PG_DSN")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
SERVER_IP = os.getenv("SERVER_IP", "localhost")

app = FastAPI(title="Aura API")


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    return value


def _to_jsonable(records: Iterable[Dict[str, Any]]) -> list[Dict[str, Any]]:
    return [_normalize(dict(record)) for record in records]


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "server_ip": SERVER_IP}


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
                FROM telemetry_flat
                WHERE device_id=%s AND ts BETWEEN %s AND %s
                GROUP BY ts_bucket, device_id
                ORDER BY ts_bucket ASC
                LIMIT %s
            """,
                (bucket, device_id, start_ts, end_ts, limit),
            )
            rows = cur.fetchall()
    return JSONResponse(_to_jsonable(rows))


@app.get("/devices/{device_id}/last")
async def last(device_id: str) -> JSONResponse:
    with psycopg.connect(PG_DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ts, device_id, lat, lon, speed, payload
                FROM telemetry_flat
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
async def ws_live(ws: WebSocket) -> None:
    await ws.accept()
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
        loop.call_soon_threadsafe(queue.put_nowait, {"topic": message.topic, "payload": payload})

    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.subscribe("last/#", qos=1)
    client.loop_start()
    try:
        while True:
            item = await queue.get()
            await ws.send_json(item)
    finally:
        client.loop_stop()
        await ws.close()
