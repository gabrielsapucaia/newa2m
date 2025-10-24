package com.example.sensorlogger.model

data class ImuSnapshot(
    val timestampMillis: Long,
    val ax: Float,
    val ay: Float,
    val az: Float,
    val gx: Float,
    val gy: Float,
    val gz: Float,
    val pitch: Float,
    val roll: Float,
    val yaw: Float,
    val rmsAcceleration: Float,
    val rmsJerk: Float,
    val yawRateMean: Float,
    val sampleCount: Int,
    val effectiveHz: Float,
    val pressure: Float,
    val altitudeBaro: Float,
    val accelerationStats: TripleAxisStats = TripleAxisStats.EMPTY,
    val angularVelocityStats: TripleAxisStats = TripleAxisStats.EMPTY,
    val jerkStats: TripleAxisJerkStats = TripleAxisJerkStats.EMPTY,
    val accelerationNormStats: NormStats = NormStats.EMPTY,
    val angularVelocityNormStats: NormStats = NormStats.EMPTY,
    val jerkNormStats: NormStats = NormStats.EMPTY,
    val yawRateDegPerSec: Float = 0f,
    val quaternion: Quaternion = Quaternion.IDENTITY,
    val accelerometerAccuracy: Int = -1,
    val gyroscopeAccuracy: Int = -1,
    val rotationAccuracy: Int = -1,
    val linearAccelerationStats: TripleAxisStats = TripleAxisStats.EMPTY,
    val linearAccelerationNormStats: NormStats = NormStats.EMPTY,
    val magnetometerStats: TripleAxisStats = TripleAxisStats.EMPTY,
    val magnetometerNormStats: NormStats = NormStats.EMPTY,
    val magnetometerFieldStrength: Float? = null
) {
    companion object {
        val EMPTY = ImuSnapshot(
            timestampMillis = 0L,
            ax = 0f,
            ay = 0f,
            az = 0f,
            gx = 0f,
            gy = 0f,
            gz = 0f,
            pitch = 0f,
            roll = 0f,
            yaw = 0f,
            rmsAcceleration = 0f,
            rmsJerk = 0f,
            yawRateMean = 0f,
            sampleCount = 0,
            effectiveHz = 0f,
            pressure = 0f,
            altitudeBaro = 0f,
            accelerationStats = TripleAxisStats.EMPTY,
            angularVelocityStats = TripleAxisStats.EMPTY,
            jerkStats = TripleAxisJerkStats.EMPTY,
            accelerationNormStats = NormStats.EMPTY,
            angularVelocityNormStats = NormStats.EMPTY,
            jerkNormStats = NormStats.EMPTY,
            yawRateDegPerSec = 0f,
            quaternion = Quaternion.IDENTITY,
            accelerometerAccuracy = -1,
            gyroscopeAccuracy = -1,
            rotationAccuracy = -1,
            linearAccelerationStats = TripleAxisStats.EMPTY,
            linearAccelerationNormStats = NormStats.EMPTY,
            magnetometerStats = TripleAxisStats.EMPTY,
            magnetometerNormStats = NormStats.EMPTY,
            magnetometerFieldStrength = null
        )
    }
}

data class Quaternion(
    val w: Float,
    val x: Float,
    val y: Float,
    val z: Float
) {
    companion object {
        val IDENTITY = Quaternion(1f, 0f, 0f, 0f)
    }
}

data class AxisStats(
    val mean: Float? = null,
    val rms: Float? = null,
    val min: Float? = null,
    val max: Float? = null,
    val sigma: Float? = null
) {
    companion object {
        val EMPTY = AxisStats()
    }
}

data class TripleAxisStats(
    val x: AxisStats = AxisStats.EMPTY,
    val y: AxisStats = AxisStats.EMPTY,
    val z: AxisStats = AxisStats.EMPTY
) {
    companion object {
        val EMPTY = TripleAxisStats()
    }
}

data class TripleAxisJerkStats(
    val xRms: Float? = null,
    val yRms: Float? = null,
    val zRms: Float? = null
) {
    companion object {
        val EMPTY = TripleAxisJerkStats()
    }
}

data class NormStats(
    val rms: Float? = null,
    val sigma: Float? = null
) {
    companion object {
        val EMPTY = NormStats()
    }
}
