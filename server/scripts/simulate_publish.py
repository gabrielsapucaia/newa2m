import time, json, random, threading
from datetime import datetime
import paho.mqtt.client as mqtt

BROKER="localhost"
PORT=1883
USER="device-test"
PASS="devpass"
DEVICES=[f"truck-{i}" for i in range(1,5)]

def run(dev):
    c = mqtt.Client(client_id=f"sim-{dev}")
    c.username_pw_set(USER, PASS)
    c.connect(BROKER, PORT, keepalive=30)
    c.loop_start()
    while True:
        lat = -10.0 + random.random()
        lon = -48.0 + random.random()
        speed = random.random()*60
        payload = {
            "schema_version": 11,
            "deviceId": dev,
            "gnss": {"lat":lat,"lon":lon,"speed":speed,"cn0_avg":30+random.random()*10,"sats_used":10},
            "imu": {"rms_x":random.random(),"rms_y":random.random(),"rms_z":random.random(),
                    "jerk":{"x":random.random(),"y":random.random(),"z":random.random()}},
            "ts": datetime.utcnow().isoformat()+"Z"
        }
        c.publish(f"telemetry/{dev}", json.dumps(payload), qos=1)
        c.publish(f"last/{dev}", json.dumps(payload), qos=1, retain=True)
        time.sleep(1)

for d in DEVICES:
    threading.Thread(target=run, args=(d,), daemon=True).start()

print("Simulando publicaão… CTRL+C para parar.")
while True:
    time.sleep(5)
