-- Migration: Add truck_status column
-- Date: 2025-10-27
-- Description: Add truck_status column to track truck operational status

-- Add truck_status column (extracted from payload for easier querying)
ALTER TABLE telemetry_flat ADD COLUMN IF NOT EXISTS truck_status text;

-- Create index for faster filtering by truck status
CREATE INDEX IF NOT EXISTS idx_truck_status ON telemetry_flat (truck_status, ts DESC);

-- Update existing records to extract truck_status from payload
UPDATE telemetry_flat 
SET truck_status = payload->>'truck.status' 
WHERE truck_status IS NULL 
  AND payload->>'truck.status' IS NOT NULL;

-- Recreate the enriched view to include truck_status
DROP VIEW IF EXISTS v_telemetry_enriched;

CREATE VIEW v_telemetry_enriched AS
SELECT
    ts,
    device_id,
    lat,
    lon,
    speed,
    heading,
    altitude,
    truck_status,
    cn0_avg,
    sats_used,
    imu_rms_x,
    imu_rms_y,
    imu_rms_z,
    jerk_x,
    jerk_y,
    jerk_z,
    payload->>'operator.id' as operator_id,
    payload->>'equipment.tag' as equipment_tag,
    (payload->>'seq_id')::bigint as seq_id,
    payload->>'gnss.provider' as gnss_provider,
    (payload->>'gnss.accuracy_m')::float as gnss_accuracy_m,
    (payload->>'imu.pitch_deg')::float as pitch_deg,
    (payload->>'imu.roll_deg')::float as roll_deg,
    (payload->>'imu.yaw_deg')::float as yaw_deg,
    payload->>'imu.motion.stationary' as motion_stationary,
    payload->>'imu.motion.shock_level' as shock_level,
    (payload->>'imu.motion.shock_score')::float as shock_score,
    payload
FROM telemetry_flat;

COMMENT ON VIEW v_telemetry_enriched IS 'Enriched telemetry view with extracted fields including truck status';
COMMENT ON COLUMN telemetry_flat.truck_status IS 'Truck operational status: CARREGANDO, CHEIO, BASCULANDO, VAZIO';
