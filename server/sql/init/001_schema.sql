CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry_flat (
  ts timestamptz NOT NULL,
  device_id text NOT NULL,
  lat double precision, lon double precision, speed double precision,
  heading double precision, altitude double precision,
  imu_rms_x double precision, imu_rms_y double precision, imu_rms_z double precision,
  jerk_x double precision, jerk_y double precision, jerk_z double precision,
  cn0_avg double precision, sats_used int,
  payload jsonb,
  PRIMARY KEY (device_id, ts)
);
SELECT create_hypertable('telemetry_flat','ts', if_not_exists => true);
SELECT add_compression_policy('telemetry_flat', INTERVAL '3 days');
SELECT add_retention_policy('telemetry_flat', INTERVAL '90 days');

CREATE TABLE IF NOT EXISTS trips (
  trip_id uuid PRIMARY KEY,
  device_id text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_lat double precision, start_lon double precision,
  end_lat double precision,   end_lon double precision,
  distance_km double precision, duration_s int,
  features jsonb, labels jsonb
);
