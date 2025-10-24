package com.example.sensorlogger.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TelemetryPayload(
    @SerialName("v") val version: Int = 2,
    @SerialName("device_id") val deviceId: String,
    @SerialName("ts_utc") val timestampUtc: Long,
    @SerialName("elapsedRealtimeNanos") val elapsedRealtimeNanos: Long,
    @SerialName("seq") val sequence: Long,
    @SerialName("operator_code") val operatorId: String,
    @SerialName("operator_name") val operatorName: String,
    @SerialName("equipment_tag") val equipmentTag: String,

    val latitude: Float,
    val longitude: Float,
    val altitude: Float,
    val speed: Float,
    val bearing: Float,
    val accuracy: Float,
    val verticalAccuracyMeters: Float,
    val speedAccuracyMps: Float,
    val bearingAccuracyDeg: Float,

    val satellitesVisible: Int,
    val satellitesUsed: Int,
    val cn0Average: Float,
    val hasL5: Boolean,

    val hdop: Float,
    val vdop: Float,
    val pdop: Float,
    val provider: String,

    val ax: Float,
    val ay: Float,
    val az: Float,
    val gx: Float,
    val gy: Float,
    val gz: Float,
    val pitch: Float,
    val roll: Float,
    val yaw: Float,

    val a_rms_total: Float,
    val jerk_rms: Float,
    val yaw_rate_mean: Float,
    val samples_imu: Int,
    val imu_hz: Float,

    val pressure: Float,
    val alt_baro: Float,

    val gnss_raw_supported: Boolean,
    val gnss_raw_count: Int,

    val timestamp: String
) {
    fun toCsvHeader(): String = HEADER

    fun toCsvRow(): String = buildString {
        append(version)
        append(',').append(deviceId)
        append(',').append(timestampUtc)
        append(',').append(elapsedRealtimeNanos)
        append(',').append(sequence)
        append(',').append(operatorId)
        append(',').append(operatorName)
        append(',').append(equipmentTag)
        append(',').append(latitude)
        append(',').append(longitude)
        append(',').append(altitude)
        append(',').append(speed)
        append(',').append(bearing)
        append(',').append(accuracy)
        append(',').append(verticalAccuracyMeters)
        append(',').append(speedAccuracyMps)
        append(',').append(bearingAccuracyDeg)
        append(',').append(satellitesVisible)
        append(',').append(satellitesUsed)
        append(',').append(cn0Average)
        append(',').append(hasL5)
        append(',').append(hdop)
        append(',').append(vdop)
        append(',').append(pdop)
        append(',').append(provider)
        append(',').append(ax)
        append(',').append(ay)
        append(',').append(az)
        append(',').append(gx)
        append(',').append(gy)
        append(',').append(gz)
        append(',').append(pitch)
        append(',').append(roll)
        append(',').append(yaw)
        append(',').append(a_rms_total)
        append(',').append(jerk_rms)
        append(',').append(yaw_rate_mean)
        append(',').append(samples_imu)
        append(',').append(imu_hz)
        append(',').append(pressure)
        append(',').append(alt_baro)
        append(',').append(gnss_raw_supported)
        append(',').append(gnss_raw_count)
        append(',').append(timestamp)
    }

    companion object {
        const val HEADER =
            "v,device_id,ts_utc,elapsedRealtimeNanos,seq,operator_code,operator_name,equipment_tag," +
                "latitude,longitude,altitude,speed,bearing,accuracy,verticalAccuracyMeters," +
                "speedAccuracyMps,bearingAccuracyDeg,satellitesVisible,satellitesUsed,cn0Average," +
                "hasL5,hdop,vdop,pdop,provider,ax,ay,az,gx,gy,gz,pitch,roll,yaw,a_rms_total," +
                "jerk_rms,yaw_rate_mean,samples_imu,imu_hz,pressure,alt_baro,gnss_raw_supported," +
                "gnss_raw_count,timestamp"
    }
}
