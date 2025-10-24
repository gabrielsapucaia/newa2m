package com.example.sensorlogger.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.core.content.getSystemService
import com.example.sensorlogger.model.AxisStats
import com.example.sensorlogger.model.ImuSnapshot
import com.example.sensorlogger.model.NormStats
import com.example.sensorlogger.model.TripleAxisJerkStats
import com.example.sensorlogger.model.TripleAxisStats
import com.example.sensorlogger.model.Quaternion
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class ImuAggregator(context: Context) : SensorEventListener {

    private val sensorManager: SensorManager? = context.getSystemService()
    private val accelerometer: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val gyroscope: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val rotationVector: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val linearAccelerationSensor: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val magnetometer: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
    private val barometer: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_PRESSURE)

    private val lock = Any()
    private var bucket = Bucket()

    private val orientationAngles = FloatArray(3)
    private val rotationMatrix = FloatArray(9)
    private var latestQuaternion = Quaternion.IDENTITY

    private var latestAccel = floatArrayOf(0f, 0f, 0f)
    private var latestGyro = floatArrayOf(0f, 0f, 0f)
    private var latestLinearAccel = floatArrayOf(0f, 0f, 0f)
    private var latestMagnetometer = floatArrayOf(0f, 0f, 0f)
    private var latestOrientation = floatArrayOf(0f, 0f, 0f)
    private var latestPressure = 0f
    private var latestBaroAlt = 0f

    private var lastSampleMillis: Long = 0L
    private var lastAccelMagnitude: Float = 0f
    private var lastAccelTimestampNanos: Long = 0L
    private var lastAccelValues: FloatArray? = null

    private var accelerometerAccuracy: Int = -1
    private var gyroscopeAccuracy: Int = -1
    private var rotationAccuracy: Int = -1

    fun start() {
        sensorManager?.let { manager ->
            accelerometer?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            gyroscope?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            rotationVector?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            linearAccelerationSensor?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            magnetometer?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            barometer?.also { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
        }
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        synchronized(lock) {
            bucket = Bucket()
        }
    }

    fun snapshot(nowMillis: Long): ImuSnapshot = synchronized(lock) {
        val samples = bucket.sampleCount

        val ax = latestAccel.getOrElse(0) { 0f }
        val ay = latestAccel.getOrElse(1) { 0f }
        val az = latestAccel.getOrElse(2) { 0f }
        val gx = latestGyro.getOrElse(0) { 0f }
        val gy = latestGyro.getOrElse(1) { 0f }
        val gz = latestGyro.getOrElse(2) { 0f }
        val yaw = latestOrientation.getOrElse(0) { 0f }.toDegrees()
        val pitch = latestOrientation.getOrElse(1) { 0f }.toDegrees()
        val roll = latestOrientation.getOrElse(2) { 0f }.toDegrees()

        if (samples == 0) {
            bucket = Bucket()
            return@synchronized ImuSnapshot.EMPTY.copy(
                timestampMillis = nowMillis,
                ax = ax,
                ay = ay,
                az = az,
                gx = gx,
                gy = gy,
                gz = gz,
                pitch = pitch,
                roll = roll,
                yaw = yaw,
                pressure = latestPressure,
                altitudeBaro = latestBaroAlt
            )
        }

        val rmsAcceleration = bucket.accMagnitude.rms() ?: 0f
        val rmsJerk = bucket.jerkMagnitude.rms() ?: 0f
        val yawRateMean = bucket.gyroZ.mean() ?: 0f

        val elapsedMillis = (bucket.lastTimestampMillis - bucket.firstTimestampMillis).coerceAtLeast(1L)
        val effectiveHz = samples * 1000f / elapsedMillis

        val snapshot = ImuSnapshot(
            timestampMillis = nowMillis,
            ax = ax,
            ay = ay,
            az = az,
            gx = gx,
            gy = gy,
            gz = gz,
            pitch = pitch,
            roll = roll,
            yaw = yaw,
            rmsAcceleration = rmsAcceleration,
            rmsJerk = rmsJerk,
            yawRateMean = yawRateMean,
            sampleCount = samples,
            effectiveHz = effectiveHz,
            pressure = latestPressure,
            altitudeBaro = latestBaroAlt,
            accelerationStats = bucket.buildAccelStats(),
            angularVelocityStats = bucket.buildGyroStats(),
            jerkStats = bucket.buildJerkStats(),
            accelerationNormStats = bucket.accMagnitude.toNormStats(),
            angularVelocityNormStats = bucket.gyroMagnitude.toNormStats(),
            jerkNormStats = bucket.jerkMagnitude.toNormStats(),
            yawRateDegPerSec = yawRateMean * RAD_TO_DEG,
            quaternion = latestQuaternion,
            accelerometerAccuracy = accelerometerAccuracy,
            gyroscopeAccuracy = gyroscopeAccuracy,
            rotationAccuracy = rotationAccuracy,
            linearAccelerationStats = bucket.buildLinearAccelerationStats(),
            linearAccelerationNormStats = bucket.linearAccelerationMagnitude.toNormStats(),
            magnetometerStats = bucket.buildMagnetometerStats(),
            magnetometerNormStats = bucket.magnetometerMagnitude.toNormStats(),
            magnetometerFieldStrength = bucket.magnetometerMagnitude.rms()
        )
        bucket = Bucket()
        lastAccelTimestampNanos = 0L
        lastAccelValues = null
        snapshot
    }

    override fun onSensorChanged(event: SensorEvent) {
        val timestampMillis = System.currentTimeMillis()
        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> handleAccelerometer(event, timestampMillis)
            Sensor.TYPE_GYROSCOPE -> handleGyroscope(event)
            Sensor.TYPE_ROTATION_VECTOR -> handleRotationVector(event.values)
            Sensor.TYPE_LINEAR_ACCELERATION -> handleLinearAcceleration(event)
            Sensor.TYPE_MAGNETIC_FIELD -> handleMagnetometer(event)
            Sensor.TYPE_PRESSURE -> handleBarometer(event)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        when (sensor?.type) {
            Sensor.TYPE_ACCELEROMETER -> accelerometerAccuracy = accuracy
            Sensor.TYPE_LINEAR_ACCELERATION -> accelerometerAccuracy = accuracy
            Sensor.TYPE_GYROSCOPE -> gyroscopeAccuracy = accuracy
            Sensor.TYPE_ROTATION_VECTOR -> rotationAccuracy = accuracy
        }
    }

    private fun handleAccelerometer(event: SensorEvent, timestampMillis: Long) {
        val ax = event.values.getOrElse(0) { 0f }
        val ay = event.values.getOrElse(1) { 0f }
        val az = event.values.getOrElse(2) { 0f }
        if (!ax.isFinite() || !ay.isFinite() || !az.isFinite()) {
            return
        }
        val magnitude = sqrt((ax * ax + ay * ay + az * az).toDouble()).toFloat()
        val jerkVector = computeJerk(event.timestamp, ax, ay, az)

        lastSampleMillis = timestampMillis
        lastAccelMagnitude = magnitude
        latestAccel = floatArrayOf(ax, ay, az)

        val gz = latestGyro.getOrElse(2) { 0f }

        synchronized(lock) {
            bucket.addAccelerometerSample(timestampMillis, ax, ay, az, magnitude, jerkVector, gz)
        }
    }

    private fun computeJerk(
        timestampNanos: Long,
        ax: Float,
        ay: Float,
        az: Float
    ): FloatArray? {
        val previous = lastAccelValues
        val lastTs = lastAccelTimestampNanos
        lastAccelValues = floatArrayOf(ax, ay, az)
        lastAccelTimestampNanos = timestampNanos
        if (previous == null || lastTs == 0L) {
            return null
        }
        val deltaNs = timestampNanos - lastTs
        if (deltaNs <= 0L) return null
        val dtSeconds = deltaNs / 1_000_000_000f
        if (dtSeconds <= 0f) return null
        val jx = (ax - previous.getOrElse(0) { 0f }) / dtSeconds
        val jy = (ay - previous.getOrElse(1) { 0f }) / dtSeconds
        val jz = (az - previous.getOrElse(2) { 0f }) / dtSeconds
        if (!jx.isFinite() || !jy.isFinite() || !jz.isFinite()) return null
        return floatArrayOf(jx, jy, jz)
    }

    private fun handleGyroscope(event: SensorEvent) {
        val gx = event.values.getOrElse(0) { return }
        val gy = event.values.getOrElse(1) { return }
        val gz = event.values.getOrElse(2) { return }
        if (!gx.isFinite() || !gy.isFinite() || !gz.isFinite()) {
            return
        }
        latestGyro = floatArrayOf(gx, gy, gz)
        synchronized(lock) {
            bucket.addGyroSample(gx, gy, gz)
        }
    }

    private fun handleLinearAcceleration(event: SensorEvent) {
        val lx = event.values.getOrElse(0) { return }
        val ly = event.values.getOrElse(1) { return }
        val lz = event.values.getOrElse(2) { return }
        if (!lx.isFinite() || !ly.isFinite() || !lz.isFinite()) {
            return
        }
        latestLinearAccel = floatArrayOf(lx, ly, lz)
        synchronized(lock) {
            bucket.addLinearAccelerationSample(lx, ly, lz)
        }
    }

    private fun handleMagnetometer(event: SensorEvent) {
        val mx = event.values.getOrElse(0) { return }
        val my = event.values.getOrElse(1) { return }
        val mz = event.values.getOrElse(2) { return }
        if (!mx.isFinite() || !my.isFinite() || !mz.isFinite()) {
            return
        }
        latestMagnetometer = floatArrayOf(mx, my, mz)
        synchronized(lock) {
            bucket.addMagnetometerSample(mx, my, mz)
        }
    }

    private fun handleRotationVector(values: FloatArray) {
        if (values.size >= 3) {
            SensorManager.getRotationMatrixFromVector(rotationMatrix, values)
            SensorManager.getOrientation(rotationMatrix, orientationAngles)
            latestOrientation = orientationAngles.clone()
            latestQuaternion = values.toQuaternion()
        }
    }

    private fun handleBarometer(event: SensorEvent) {
        val pressure = event.values.getOrElse(0) { return }
        latestPressure = pressure
        latestBaroAlt = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, pressure)
    }

    private fun Float.toDegrees(): Float = Math.toDegrees(this.toDouble()).toFloat()
    private fun FloatArray.toQuaternion(): Quaternion {
        val x = getOrElse(0) { 0f }
        val y = getOrElse(1) { 0f }
        val z = getOrElse(2) { 0f }
        val w = if (size >= 4) {
            getOrElse(3) { computeW(x, y, z) }
        } else {
            computeW(x, y, z)
        }
        return Quaternion(w, x, y, z)
    }

    private fun computeW(x: Float, y: Float, z: Float): Float {
        val t = 1f - x * x - y * y - z * z
        return if (t > 0f) sqrt(t.toDouble()).toFloat() else 0f
    }

    private data class Bucket(
        var firstTimestampMillis: Long = 0L,
        var lastTimestampMillis: Long = 0L,
        var sampleCount: Int = 0,
        val accX: StatsAccumulator = StatsAccumulator(),
        val accY: StatsAccumulator = StatsAccumulator(),
        val accZ: StatsAccumulator = StatsAccumulator(),
        val gyroX: StatsAccumulator = StatsAccumulator(),
        val gyroY: StatsAccumulator = StatsAccumulator(),
        val gyroZ: StatsAccumulator = StatsAccumulator(),
        val accMagnitude: StatsAccumulator = StatsAccumulator(),
        val gyroMagnitude: StatsAccumulator = StatsAccumulator(),
        val jerkMagnitude: StatsAccumulator = StatsAccumulator(),
        val jerkX: StatsAccumulator = StatsAccumulator(),
        val jerkY: StatsAccumulator = StatsAccumulator(),
        val jerkZ: StatsAccumulator = StatsAccumulator(),
        val linearAccelerationX: StatsAccumulator = StatsAccumulator(),
        val linearAccelerationY: StatsAccumulator = StatsAccumulator(),
        val linearAccelerationZ: StatsAccumulator = StatsAccumulator(),
        val linearAccelerationMagnitude: StatsAccumulator = StatsAccumulator(),
        val magnetometerX: StatsAccumulator = StatsAccumulator(),
        val magnetometerY: StatsAccumulator = StatsAccumulator(),
        val magnetometerZ: StatsAccumulator = StatsAccumulator(),
        val magnetometerMagnitude: StatsAccumulator = StatsAccumulator()
    ) {
        fun addAccelerometerSample(
            timestampMillis: Long,
            ax: Float,
            ay: Float,
            az: Float,
            magnitude: Float,
            jerkVector: FloatArray?,
            gz: Float
        ) {
            if (sampleCount == 0) {
                firstTimestampMillis = timestampMillis
            }
            lastTimestampMillis = timestampMillis
            sampleCount += 1
            accX.add(ax)
            accY.add(ay)
            accZ.add(az)
            accMagnitude.add(magnitude)
            if (jerkVector != null) {
                val jx = jerkVector[0]
                val jy = jerkVector[1]
                val jz = jerkVector[2]
                jerkX.add(jx)
                jerkY.add(jy)
                jerkZ.add(jz)
                val jerkNorm = sqrt((jx * jx + jy * jy + jz * jz).toDouble()).toFloat()
                jerkMagnitude.add(jerkNorm)
            }
        }

        fun addGyroSample(gx: Float, gy: Float, gz: Float) {
            gyroX.add(gx)
            gyroY.add(gy)
            gyroZ.add(gz)
            val norm = sqrt((gx * gx + gy * gy + gz * gz).toDouble()).toFloat()
            gyroMagnitude.add(norm)
        }

        fun addLinearAccelerationSample(lx: Float, ly: Float, lz: Float) {
            linearAccelerationX.add(lx)
            linearAccelerationY.add(ly)
            linearAccelerationZ.add(lz)
            val norm = sqrt((lx * lx + ly * ly + lz * lz).toDouble()).toFloat()
            linearAccelerationMagnitude.add(norm)
        }

        fun addMagnetometerSample(mx: Float, my: Float, mz: Float) {
            magnetometerX.add(mx)
            magnetometerY.add(my)
            magnetometerZ.add(mz)
            val norm = sqrt((mx * mx + my * my + mz * mz).toDouble()).toFloat()
            magnetometerMagnitude.add(norm)
        }

        fun buildAccelStats(): TripleAxisStats = TripleAxisStats(
            x = accX.toAxisStats(),
            y = accY.toAxisStats(),
            z = accZ.toAxisStats()
        )

        fun buildGyroStats(): TripleAxisStats = TripleAxisStats(
            x = gyroX.toAxisStats(),
            y = gyroY.toAxisStats(),
            z = gyroZ.toAxisStats()
        )

        fun buildJerkStats(): TripleAxisJerkStats = TripleAxisJerkStats(
            xRms = jerkX.rms(),
            yRms = jerkY.rms(),
            zRms = jerkZ.rms()
        )

        fun buildLinearAccelerationStats(): TripleAxisStats = TripleAxisStats(
            x = linearAccelerationX.toAxisStats(),
            y = linearAccelerationY.toAxisStats(),
            z = linearAccelerationZ.toAxisStats()
        )

        fun buildMagnetometerStats(): TripleAxisStats = TripleAxisStats(
            x = magnetometerX.toAxisStats(),
            y = magnetometerY.toAxisStats(),
            z = magnetometerZ.toAxisStats()
        )
    }

    companion object {
        private const val RAD_TO_DEG = 57.2957795f
    }
}

internal class StatsAccumulator {
    private var count: Int = 0
    private var sum: Double = 0.0
    private var sumSq: Double = 0.0
    private var minValue: Float = Float.POSITIVE_INFINITY
    private var maxValue: Float = Float.NEGATIVE_INFINITY

    fun add(value: Float) {
        if (!value.isFinite()) return
        count += 1
        sum += value.toDouble()
        sumSq += value.toDouble() * value.toDouble()
        minValue = min(minValue, value)
        maxValue = max(maxValue, value)
    }

    fun count(): Int = count

    fun mean(): Float? = if (count == 0) null else (sum / count).toFloat()

    fun rms(): Float? = if (count == 0) null else sqrt(sumSq / count).toFloat()

    fun sigma(): Float? {
        if (count == 0) return null
        val meanVal = sum / count
        val variance = (sumSq / count) - (meanVal * meanVal)
        return if (variance <= 0.0) 0f else sqrt(variance).toFloat()
    }

    fun min(): Float? = if (count == 0) null else minValue

    fun max(): Float? = if (count == 0) null else maxValue

    fun toAxisStats(): AxisStats = AxisStats(
        mean = mean(),
        rms = rms(),
        min = min(),
        max = max(),
        sigma = sigma()
    )

    fun toNormStats(): NormStats = NormStats(
        rms = rms(),
        sigma = sigma()
    )
}
