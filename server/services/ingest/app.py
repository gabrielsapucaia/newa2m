import os, json, time, queue, threading, io, logging
from datetime import datetime, timezone
from typing import Optional
import pandas as pd
import boto3
import paho.mqtt.client as mqtt
import psycopg

logging.basicConfig(level=logging.INFO, format="[ingest] %(message)s")

MQTT_URI = os.getenv("MQTT_URI","mqtt://localhost:1883")
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
PG_DSN = os.getenv("PG_DSN")
S3_ENDPOINT=os.getenv("S3_ENDPOINT","http://localhost:9000")
S3_ACCESS_KEY=os.getenv("S3_ACCESS_KEY","admin")
S3_SECRET_KEY=os.getenv("S3_SECRET_KEY","admin12345")
S3_BUCKET=os.getenv("S3_BUCKET","telemetry")
S3_REGION=os.getenv("S3_REGION","us-east-1")

TOPIC_TELEMETRY = "telemetry/#"
TOPIC_LAST = "last/#"
DB_QUEUE = queue.Queue(maxsize=20000)
S3_QUEUE = queue.Queue(maxsize=20000)


def g(d, *path, default=None):
    """Acessa d[path...] com seguranca e suporta chaves planas."""
    if not path:
        return default
    if isinstance(d, dict):
        joined = ".".join(path)
        if joined in d:
            return d[joined]
    cur = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return cur


def fnum(x):
    """Converte para float ou retorna None."""
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None

def parse_mqtt_uri(uri):
    host_port = uri.replace("mqtt://","")
    parts = host_port.split(":")
    host = parts[0]
    port = int(parts[1]) if len(parts)>1 else 1883
    return host, port

def on_connect(client, userdata, flags, rc, props=None):
    logging.info("MQTT conectado rc=%s", rc)
    client.subscribe(TOPIC_TELEMETRY, qos=1)
    client.subscribe(TOPIC_LAST, qos=1)

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception:
        payload = {"raw": msg.payload.decode("utf-8", errors="ignore")}
    envelope = (msg.topic, payload, datetime.utcnow().replace(tzinfo=timezone.utc))
    _enqueue(DB_QUEUE, envelope, "db")
    _enqueue(S3_QUEUE, envelope, "s3")

def _enqueue(target_queue: queue.Queue, item, label: str) -> None:
    try:
        target_queue.put_nowait(item)
    except queue.Full:
        logging.error("fila %s cheia; descartando frame %s", label, item[0])


def extract_ts(payload, fallback: datetime) -> datetime:
    if isinstance(payload, dict):
        ts_candidate = payload.get("ts") or payload.get("timestamp")
        if ts_candidate:
            dt = parse_datetime(ts_candidate)
            if dt:
                return dt
        epoch = payload.get("ts_epoch") or payload.get("epoch_ms") or payload.get("epoch")
        if epoch is not None:
            dt = parse_epoch(epoch)
            if dt:
                return dt
    return fallback


def parse_datetime(value) -> Optional[datetime]:
    try:
        if isinstance(value, str):
            val = value.strip()
            if val.endswith("Z"):
                val = val[:-1] + "+00:00"
            dt = datetime.fromisoformat(val)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    except Exception:
        return None
    return None


def parse_epoch(value) -> Optional[datetime]:
    try:
        if isinstance(value, str):
            value = float(value)
        if isinstance(value, (int, float)):
            if value > 1e12:
                value /= 1000.0
            return datetime.fromtimestamp(value, tz=timezone.utc)
    except Exception:
        return None
    return None

def db_writer():
    with psycopg.connect(PG_DSN, autocommit=True) as conn:
        while True:
            topic, payload, received_at = DB_QUEUE.get()
            if not topic.startswith("telemetry/"):
                continue
            device_fallback = None
            if isinstance(payload, dict):
                device_fallback = payload.get("deviceId") or payload.get("device_id")
            device_id = topic.split("/", 1)[1] if "/" in topic else (device_fallback or "unknown")

            ts_payload = extract_ts(payload, received_at)

            # GNSS
            direct_lat = payload.get("lat") if isinstance(payload, dict) else None
            direct_lon = payload.get("lon") if isinstance(payload, dict) else None
            direct_speed = payload.get("speed") if isinstance(payload, dict) else None
            direct_heading = payload.get("heading") if isinstance(payload, dict) else None
            direct_altitude = payload.get("altitude") if isinstance(payload, dict) else None
            direct_cn0 = payload.get("cn0_avg") if isinstance(payload, dict) else None
            direct_sats = payload.get("sats_used") if isinstance(payload, dict) else None

            lat = fnum(g(payload, "gnss", "lat", default=direct_lat))
            lon = fnum(g(payload, "gnss", "lon", default=direct_lon))
            speed = fnum(g(payload, "gnss", "speed", default=direct_speed))
            heading = fnum(
                g(
                    payload,
                    "gnss",
                    "heading",
                    default=g(payload, "gnss", "course", default=direct_heading),
                )
            )
            altitude = fnum(
                g(
                    payload,
                    "gnss",
                    "altitude",
                    default=g(payload, "gnss", "alt", default=direct_altitude),
                )
            )
            cn0 = fnum(g(payload, "gnss", "cn0_avg", default=direct_cn0))
            sats = g(payload, "gnss", "num_sats", default=direct_sats)
            try:
                sats = int(sats) if sats is not None else None
            except Exception:
                sats = None

            # IMU (plano ou aninhado)
            direct_imu_rms_x = payload.get("imu_rms_x") if isinstance(payload, dict) else None
            direct_imu_rms_y = payload.get("imu_rms_y") if isinstance(payload, dict) else None
            direct_imu_rms_z = payload.get("imu_rms_z") if isinstance(payload, dict) else None

            imu_rms_x = fnum(g(payload, "imu", "rms_x", default=direct_imu_rms_x))
            imu_rms_y = fnum(g(payload, "imu", "rms_y", default=direct_imu_rms_y))
            imu_rms_z = fnum(g(payload, "imu", "rms_z", default=direct_imu_rms_z))
            if imu_rms_x is None:
                imu_rms_x = fnum(g(payload, "imu", "acc", "x", "rms"))
            if imu_rms_y is None:
                imu_rms_y = fnum(g(payload, "imu", "acc", "y", "rms"))
            if imu_rms_z is None:
                imu_rms_z = fnum(g(payload, "imu", "acc", "z", "rms"))

            jerk_x = fnum(g(payload, "imu", "jerk", "x", "rms", default=g(payload, "imu", "jerk", "x")))
            jerk_y = fnum(g(payload, "imu", "jerk", "y", "rms", default=g(payload, "imu", "jerk", "y")))
            jerk_z = fnum(g(payload, "imu", "jerk", "z", "rms", default=g(payload, "imu", "jerk", "z")))

            truck_status = g(payload, "truck", "status")

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO telemetry_flat
                      (ts, device_id, lat, lon, speed, heading, altitude,
                       imu_rms_x, imu_rms_y, imu_rms_z,
                       jerk_x, jerk_y, jerk_z,
                       cn0_avg, sats_used, truck_status, payload)
                    VALUES
                      (%s,%s,%s,%s,%s,%s,%s,
                       %s,%s,%s,
                       %s,%s,%s,
                       %s,%s,%s,%s)
                    ON CONFLICT DO NOTHING
                """, (
                    ts_payload, device_id, lat, lon, speed, heading, altitude,
                    imu_rms_x, imu_rms_y, imu_rms_z,
                    jerk_x, jerk_y, jerk_z,
                    cn0, sats, truck_status, json.dumps(payload)
                ))

def s3_writer():
    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
    )
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
    except Exception:
        try:
            s3.create_bucket(Bucket=S3_BUCKET)
            logging.info("bucket '%s' criado no S3", S3_BUCKET)
        except Exception as e:
            logging.error("não foi possível criar bucket '%s': %s", S3_BUCKET, e)
    buffer = []
    last_flush = time.time()
    FLUSH_EVERY = 10
    BATCH_SIZE = 200
    while True:
        try:
            item = S3_QUEUE.get(timeout=1)
            buffer.append(item)
        except queue.Empty:
            pass
        if buffer and (
            len(buffer) >= BATCH_SIZE or time.time() - last_flush >= FLUSH_EVERY
        ):
            rows = []
            for topic, payload, received_at in buffer:
                if topic.startswith("telemetry/"):
                    device_id = topic.split("/", 1)[1]
                    rows.append(
                        {
                            "ts": extract_ts(payload, received_at),
                            "device_id": device_id,
                            "payload": json.dumps(payload),
                            "received_at": received_at.isoformat(),
                        }
                    )
            if rows:
                df = pd.DataFrame(rows)
                dt = datetime.utcnow().strftime("%Y-%m-%d")
                key = f"frames/dt={dt}/part-{int(time.time())}.parquet"
                f = io.BytesIO()
                df.to_parquet(f, index=False)
                f.seek(0)
                s3.put_object(Bucket=S3_BUCKET, Key=key, Body=f.getvalue())
            buffer.clear()
            last_flush = time.time()

def main():
    host, port = parse_mqtt_uri(MQTT_URI)

    threading.Thread(target=db_writer, daemon=True, name="db-writer").start()
    threading.Thread(target=s3_writer, daemon=True, name="s3-writer").start()

    client = mqtt.Client(client_id="ingest-" + str(int(time.time())), protocol=mqtt.MQTTv5)
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(host, port, keepalive=30)
    client.loop_forever()

if __name__ == "__main__":
    main()
