import os, asyncio, json
from datetime import datetime, timedelta
from typing import Optional
import psycopg
from fastapi import FastAPI, WebSocket, Query
from fastapi.responses import JSONResponse
import paho.mqtt.client as mqtt

PG_DSN = os.getenv("PG_DSN")
MQTT_HOST = os.getenv("MQTT_HOST","localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT","1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
SERVER_IP = os.getenv("SERVER_IP","localhost")

app = FastAPI(title="Aura API")

@app.get("/health")
async def health():
    return {"ok": True, "server_ip": SERVER_IP}

@app.get("/devices/{device_id}/series")
async def series(device_id: str,
                 start: Optional[str] = Query(None),
                 end: Optional[str] = Query(None),
                 fields: Optional[str] = Query("lat,lon,speed"),
                 bucket: Optional[str] = Query("1s"),
                 limit: Optional[int] = Query(10000)):
    start_ts = start or (datetime.utcnow()-timedelta(hours=1)).isoformat()
    end_ts = end or datetime.utcnow().isoformat()
    cols = [c.strip() for c in fields.split(",") if c.strip()]
    with psycopg.connect(PG_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT time_bucket(%s, ts) as ts_bucket, device_id,
                       {", ".join([f"avg({c}) as {c}" for c in cols])}
                FROM telemetry_flat
                WHERE device_id=%s AND ts BETWEEN %s AND %s
                GROUP BY ts_bucket, device_id
                ORDER BY ts_bucket ASC
                LIMIT %s
            """, (bucket, device_id, start_ts, end_ts, limit))
            rows = [dict(zip([d.name for d in cur.description], r)) for r in cur.fetchall()]
    return JSONResponse(rows)

@app.get("/devices/{device_id}/last")
async def last(device_id: str):
    with psycopg.connect(PG_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ts, device_id, lat, lon, speed, payload
                FROM telemetry_flat
                WHERE device_id=%s
                ORDER BY ts DESC
                LIMIT 1
            """, (device_id,))
            row = cur.fetchone()
            if not row:
                return JSONResponse({"error":"not found"}, status_code=404)
            return JSONResponse(dict(zip([d.name for d in cur.description], row)))

@app.websocket("/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    client = mqtt.Client(protocol=mqtt.MQTTv5)
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    loop = asyncio.get_running_loop()
    q = asyncio.Queue()
    def on_message(c,u,m):
        try:
            payload = json.loads(m.payload.decode())
        except Exception:
            payload = {"raw": m.payload.decode(errors="ignore")}
        loop.call_soon_threadsafe(q.put_nowait, {"topic": m.topic, "payload": payload})
    client.on_message = on_message
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.subscribe("last/#", qos=1)
    client.loop_start()
    try:
        while True:
            item = await q.get()
            await ws.send_json(item)
    finally:
        client.loop_stop()
        await ws.close()
