from datetime import datetime
from typing import Any, Dict, Optional

import os
import psycopg
import psycopg.rows

from fastapi import APIRouter, Query

PG_DSN = os.getenv("PG_DSN")

router = APIRouter(prefix="/devices", tags=["raw-telemetry"])


def _build_where_clauses(params: Dict[str, Any]):
    clauses = ["tf.device_id = %s"]
    values = [params["device_id"]]

    if params.get("from_ts") is not None:
        clauses.append("tf.ts >= %s")
        values.append(params["from_ts"])

    if params.get("to_ts") is not None:
        clauses.append("tf.ts <= %s")
        values.append(params["to_ts"])

    if params.get("page_after_ts") is not None:
        clauses.append("tf.ts > %s")
        values.append(params["page_after_ts"])

    where_sql = " AND ".join(clauses)
    return where_sql, values


@router.get("/{device_id}/raw")
def get_raw_telemetry(
    device_id: str,
    from_ts: Optional[datetime] = Query(None),
    to_ts: Optional[datetime] = Query(None),
    page_after_ts: Optional[datetime] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    params = {
        "device_id": device_id,
        "from_ts": from_ts,
        "to_ts": to_ts,
        "page_after_ts": page_after_ts,
    }

    where_sql, values = _build_where_clauses(params)

    points_sql = f"""
        SELECT
            tf.ts AS ts,
            (tf.payload->>'seq_id')::bigint AS seq_id,

            tf.lat AS lat,
            tf.lon AS lon,
            tf.speed AS speed,
            tf.heading AS heading,
            tf.altitude AS alt,
            tf.cn0_avg AS cn0_avg,
            tf.sats_used AS sats_used,
            (tf.payload->'gnss'->>'accuracy_m')::float8    AS accuracy_m,
            (tf.payload->'gnss'->>'num_sats')::int         AS num_sats,

            (tf.payload->'imu'->>'pitch_deg')::float8      AS pitch_deg,
            (tf.payload->'imu'->>'roll_deg')::float8       AS roll_deg,
            (tf.payload->'imu'->>'yaw_deg')::float8        AS yaw_deg,

            tf.imu_rms_x AS imu_rms_x,
            tf.imu_rms_y AS imu_rms_y,
            tf.imu_rms_z AS imu_rms_z,
            tf.jerk_x    AS jerk_x_rms,
            tf.jerk_y    AS jerk_y_rms,
            tf.jerk_z    AS jerk_z_rms,

            (tf.payload->'imu'->'jerk'->'norm'->>'rms')::float8  AS jerk_norm_rms,
            (tf.payload->'imu'->'gyro'->'norm'->>'rms')::float8  AS gyro_norm_rms,
            (tf.payload->'imu'->'acc' ->'norm'->>'rms')::float8  AS acc_norm_rms,

            (tf.payload->'imu'->'motion'->>'shock_score')::float8 AS shock_score,
            (tf.payload->'imu'->'motion'->>'shock_level')::text   AS shock_level,

            (tf.payload->'power'->>'battery_percent')::int        AS battery_percent,
            (tf.payload->'power'->>'charging')::boolean           AS charging,

            (tf.payload->'network'->>'wifi_ssid')::text           AS wifi_ssid,
            (tf.payload->'network'->>'wifi_strength_dbm')::int    AS wifi_strength_dbm,

            (tf.payload->>'operator.id')::text         AS operator_id,
            (tf.payload->>'equipment.tag')::text       AS equipment_tag,
            (tf.payload->>'schema.version')::text      AS schema_version,
            (tf.payload->'app'->>'version_name')::text AS app_version,
            (tf.payload->'meta'->>'hardware')::text    AS hardware,
            (tf.payload->'meta'->>'uptime_s')::bigint  AS uptime_s,

            tf.payload AS raw_payload
        FROM telemetry_flat tf
        WHERE {where_sql}
        ORDER BY tf.ts ASC
        LIMIT {limit}
    """

    stats_sql = f"""
        SELECT
            MAX(tf.speed) AS speed_max,
            PERCENTILE_CONT(0.95) WITHIN GROUP (
                ORDER BY (tf.payload->'imu'->'motion'->>'shock_score')::float8
            ) AS shock_score_p95,
            MAX((tf.payload->'imu'->'motion'->>'shock_score')::float8) AS shock_score_max,
            PERCENTILE_CONT(0.95) WITHIN GROUP (
                ORDER BY (tf.payload->'imu'->'jerk'->'norm'->>'rms')::float8
            ) AS jerk_norm_rms_p95,
            MIN((tf.payload->'power'->>'battery_percent')::int) AS battery_min,
            MAX((tf.payload->'power'->>'battery_percent')::int) AS battery_max
        FROM telemetry_flat tf
        WHERE {where_sql}
    """

    with psycopg.connect(PG_DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(points_sql, values)
            rows = cur.fetchall()

        with conn.cursor() as cur:
            cur.execute(stats_sql, values)
            stats_row = cur.fetchone()

    points = []
    for row in rows:
        ts = row["ts"]
        points.append({
            "ts": ts.isoformat() if ts else None,
            "seq_id": row["seq_id"],
            "gnss": {
                "lat": row["lat"],
                "lon": row["lon"],
                "speed": row["speed"],
                "heading": row["heading"],
                "alt": row["alt"],
                "accuracy_m": row["accuracy_m"],
                "cn0_avg": row["cn0_avg"],
                "num_sats": row["num_sats"],
                "sats_used": row["sats_used"],
            },
            "imu": {
                "pitch_deg": row["pitch_deg"],
                "roll_deg": row["roll_deg"],
                "yaw_deg": row["yaw_deg"],
                "acc_norm_rms": row["acc_norm_rms"],
                "gyro_norm_rms": row["gyro_norm_rms"],
                "jerk_x_rms": row["jerk_x_rms"],
                "jerk_y_rms": row["jerk_y_rms"],
                "jerk_z_rms": row["jerk_z_rms"],
                "jerk_norm_rms": row["jerk_norm_rms"],
                "shock_score": row["shock_score"],
                "shock_level": row["shock_level"],
            },
            "power": {
                "battery_percent": row["battery_percent"],
                "charging": row["charging"],
            },
            "network": {
                "wifi_ssid": row["wifi_ssid"],
                "wifi_strength_dbm": row["wifi_strength_dbm"],
            },
            "meta": {
                "operator_id": row["operator_id"],
                "equipment_tag": row["equipment_tag"],
                "schema_version": row["schema_version"],
                "app_version": row["app_version"],
                "hardware": row["hardware"],
                "uptime_s": row["uptime_s"],
            },
            "raw_payload": row["raw_payload"],
        })

    next_page_after_ts = points[-1]["ts"] if points else None

    stats = None
    if stats_row:
        if any(value is not None for value in stats_row.values()):
            stats = {
                "speed_max": stats_row["speed_max"],
                "shock_score_p95": stats_row["shock_score_p95"],
                "shock_score_max": stats_row["shock_score_max"],
                "jerk_norm_rms_p95": stats_row["jerk_norm_rms_p95"],
                "battery_min": stats_row["battery_min"],
                "battery_max": stats_row["battery_max"],
            }

    return {
        "device_id": device_id,
        "from_ts": from_ts.isoformat() if from_ts else None,
        "to_ts": to_ts.isoformat() if to_ts else None,
        "points": points,
        "stats": stats,
        "next_page_after_ts": next_page_after_ts,
    }
