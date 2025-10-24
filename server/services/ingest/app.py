import os, json, time, queue, threading, io
from datetime import datetime
import pandas as pd
import boto3
import paho.mqtt.client as mqtt
import psycopg

MQTT_URI = os.getenv("MQTT_URI","mqtt://localhost:1883")
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
PG_DSN = os.getenv("PG_DSN")
S3_ENDPOINT=os.getenv("S3_ENDPOINT","http://localhost:9000")
S3_ACCESS_KEY=os.getenv("S3_ACCESS_KEY","admin")
S3_SECRET_KEY=os.getenv("S3_SECRET_KEY","admin12345")
S3_BUCKET=os.getenv("S3_BUCKET","telemetry")
S3_REGION=os.getenv("S3_REGION","us-east-1")

topic_telemetry = "telemetry/#"
topic_last = "last/#"
q = queue.Queue(maxsize=20000)


def _as_float(value):
    try:
        if value is None:
            return None
        if isinstance(value, str) and value.lower() in {"", "null"}:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value):
    try:
        if value is None:
            return None
        if isinstance(value, str) and value.lower() in {"", "null"}:
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _lookup_path(data, parts):
    current = data
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def get_field(payload, *candidates):
    """Retorna o primeiro valor encontrado entre chaves / caminhos informados."""
    for candidate in candidates:
        if candidate is None:
            continue
        if isinstance(candidate, (tuple, list)):
            value = _lookup_path(payload, candidate)
            if value is not None:
                return value
            continue
        if isinstance(payload, dict) and candidate in payload and payload[candidate] is not None:
            return payload[candidate]
        parts = candidate.split(".")
        value = _lookup_path(payload, parts)
        if value is not None:
            return value
    return None

def parse_mqtt_uri(uri):
    host_port = uri.replace("mqtt://","")
    parts = host_port.split(":")
    host = parts[0]
    port = int(parts[1]) if len(parts)>1 else 1883
    return host, port

def on_connect(client, userdata, flags, rc, props=None):
    print("MQTT connected rc=", rc)
    client.subscribe(topic_telemetry, qos=1)
    client.subscribe(topic_last, qos=1)

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception:
        payload = {"raw": msg.payload.decode("utf-8", errors="ignore")}
    q.put((msg.topic, payload, datetime.utcnow()))

def db_writer():
    with psycopg.connect(PG_DSN, autocommit=True) as conn:
        while True:
            topic, payload, ts = q.get()
            if topic.startswith("telemetry/"):
                device_id = topic.split("/",1)[1]
                lat = _as_float(get_field(payload, "gnss.lat", ("gnss", "lat"), "lat"))
                lon = _as_float(get_field(payload, "gnss.lon", ("gnss", "lon"), "lon"))
                speed = _as_float(get_field(payload, "gnss.speed", ("gnss", "speed"), "speed"))
                heading = _as_float(get_field(payload, "gnss.heading", "gnss.course", ("gnss", "heading")))
                altitude = _as_float(get_field(payload, "gnss.alt", ("gnss", "alt"), "altitude"))
                imu_rms_x = _as_float(get_field(payload, "imu.acc.x.rms", "imu.rms_x", ("imu", "rms_x")))
                imu_rms_y = _as_float(get_field(payload, "imu.acc.y.rms", "imu.rms_y", ("imu", "rms_y")))
                imu_rms_z = _as_float(get_field(payload, "imu.acc.z.rms", "imu.rms_z", ("imu", "rms_z")))
                jerk_x = _as_float(get_field(payload, "imu.jerk.x.rms", "imu.jerk_x", ("imu", "jerk", "x")))
                jerk_y = _as_float(get_field(payload, "imu.jerk.y.rms", "imu.jerk_y", ("imu", "jerk", "y")))
                jerk_z = _as_float(get_field(payload, "imu.jerk.z.rms", "imu.jerk_z", ("imu", "jerk", "z")))
                cn0 = _as_float(get_field(payload, "gnss.cn0_avg", ("gnss", "cn0_avg"), "cn0_avg"))
                sats = _as_int(get_field(payload, "gnss.num_sats", "gnss.sats_used", ("gnss", "sats_used"), "sats_used"))
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO telemetry_flat
                        (ts, device_id, lat, lon, speed, heading, altitude,
                         imu_rms_x, imu_rms_y, imu_rms_z,
                         jerk_x, jerk_y, jerk_z, cn0_avg, sats_used, payload)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT DO NOTHING
                    """, (
                        ts, device_id, lat, lon, speed, heading, altitude,
                        imu_rms_x, imu_rms_y, imu_rms_z,
                        jerk_x, jerk_y, jerk_z,
                        cn0, sats, json.dumps(payload)
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
            print(f"[ingest] S3 bucket '{S3_BUCKET}' criado.")
        except Exception as e:
            print(f"[ingest] Falha ao criar bucket '{S3_BUCKET}': {e}")
    buffer = []
    last_flush = time.time()
    FLUSH_EVERY = 10
    BATCH_SIZE = 200
    while True:
        try:
            item = q.get(timeout=1)
            buffer.append(item)
        except queue.Empty:
            pass
        if buffer and (
            len(buffer) >= BATCH_SIZE or time.time() - last_flush >= FLUSH_EVERY
        ):
            rows = []
            for topic, payload, ts in buffer:
                if topic.startswith("telemetry/"):
                    device_id = topic.split("/", 1)[1]
                    rows.append(
                        {
                            "ts": ts,
                            "device_id": device_id,
                            "payload": json.dumps(payload),
                        }
                    )
            if rows:
                import io
                import pandas as pd

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
    threading.Thread(target=db_writer, daemon=True).start()
    threading.Thread(target=s3_writer, daemon=True).start()
    host, port = parse_mqtt_uri(MQTT_URI)
    client = mqtt.Client(client_id="ingest-"+str(int(time.time())), protocol=mqtt.MQTTv5)
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(host, port, keepalive=30)
    client.loop_forever()

if __name__ == "__main__":
    main()
