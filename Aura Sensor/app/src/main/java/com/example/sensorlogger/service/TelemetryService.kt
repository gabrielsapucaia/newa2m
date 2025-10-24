package com.example.sensorlogger.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.LifecycleService
import com.example.sensorlogger.MainActivity
import com.example.sensorlogger.R
import com.example.sensorlogger.model.GnssSnapshot
import com.example.sensorlogger.model.ImuSnapshot
import com.example.sensorlogger.model.TelemetryMappers
import com.example.sensorlogger.model.TelemetryPayload
import com.example.sensorlogger.model.TelemetryPayloadV11
import com.example.sensorlogger.model.TelemetryUiState
import com.example.sensorlogger.mqtt.MqttPublisher
import com.example.sensorlogger.repository.TelemetryStateStore
import com.example.sensorlogger.sensors.ImuAggregator
import com.example.sensorlogger.storage.CsvWriter
import com.example.sensorlogger.storage.OfflineQueue
import com.example.sensorlogger.storage.OfflineQueue.DrainOutcome
import com.example.sensorlogger.util.IdProvider
import com.example.sensorlogger.util.Time
import com.example.sensorlogger.gnss.GnssManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.selects.onTimeout
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.isActive
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import com.example.sensorlogger.BuildConfig
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import android.os.SystemClock
import java.nio.charset.StandardCharsets
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.withTimeoutOrNull

class TelemetryService : LifecycleService() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private lateinit var imuAggregator: ImuAggregator
    private lateinit var gnssManager: GnssManager
    private lateinit var csvWriter: CsvWriter
    private lateinit var offlineQueue: OfflineQueue
    private lateinit var idProvider: IdProvider
    private lateinit var mqttPublisher: MqttPublisher
    private lateinit var connectivityManager: ConnectivityManager
    private lateinit var wifiManager: WifiManager

    private val json = Json { encodeDefaults = true }
    private val notificationManager by lazy { NotificationManagerCompat.from(this) }
    private val drainTrigger = Channel<Unit>(Channel.CONFLATED)
    private var wifiLock: WifiManager.WifiLock? = null
    private var autoReconnectJob: Job? = null
    @Volatile
    private var autoReconnectActive = false

    private var networkCallbackRegistered = false
    private val wifiCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            super.onAvailable(network)
            if (!::connectivityManager.isInitialized) return
            val capabilities = connectivityManager.getNetworkCapabilities(network)
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) {
                drainTrigger.trySend(Unit)
                serviceScope.launch {
                    runCatching { mqttPublisher.reconnect() }
                        .onFailure { Timber.w(it, "MQTT reconnection on Wi-Fi available failed") }
                }
            }
        }
    }

    private var operatorId: String = ""
    private var operatorName: String = ""
    private var equipmentTag: String = ""
    private var nmeaEnabled: Boolean = true

    private var isRunning = false
    private var queueFlushJob: Job? = null
    private var disconnectJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        imuAggregator = ImuAggregator(this)
        gnssManager = GnssManager(this)
        csvWriter = CsvWriter(this, TelemetryPayload.HEADER)
        offlineQueue = OfflineQueue(this)
        idProvider = IdProvider(this)
        mqttPublisher = MqttPublisher(deviceIdProvider = { idProvider.deviceId })
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

        createNotificationChannel()
        registerWifiCallback()

        serviceScope.launch {
            offlineQueue.initialize()
            val size = offlineQueue.size()
            TelemetryStateStore.update { state -> state.copy(queueSize = size) }
            if (size > 0) {
                drainTrigger.trySend(Unit)
            }
        }
        serviceScope.launch {
            mqttPublisher.statuses.collectLatest { statuses ->
                val primaryStatus = statuses[MqttPublisher.NAME_PRIMARY]
                val activeEndpoint = primaryStatus?.let { status ->
                    status.activeEndpoint?.takeIf { status.enabled }
                }
                TelemetryStateStore.update { state ->
                    state.copy(
                        localBrokerStatus = mapBrokerStatus(primaryStatus),
                        cloudBrokerStatus = TelemetryUiState.BrokerStatus.Disabled,
                        brokerActiveEndpoint = activeEndpoint
                    )
                }
                if (!isRunning || primaryStatus == null || !primaryStatus.enabled) {
                    stopAutoReconnectLoop()
                } else {
                    when (primaryStatus.state) {
                        MqttPublisher.BrokerStatus.State.Connected,
                        MqttPublisher.BrokerStatus.State.Disabled -> stopAutoReconnectLoop()
                        MqttPublisher.BrokerStatus.State.Disconnected,
                        MqttPublisher.BrokerStatus.State.Failed,
                        MqttPublisher.BrokerStatus.State.Connecting,
                        MqttPublisher.BrokerStatus.State.Reconnecting -> startAutoReconnectLoop()
                    }
                }
                updateNotification()
            }
        }
        queueFlushJob = serviceScope.launch { flushOfflineLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                operatorId = intent.getStringExtra(EXTRA_OPERATOR_ID) ?: operatorId
                operatorName = intent.getStringExtra(EXTRA_OPERATOR_NAME) ?: operatorName
                equipmentTag = intent.getStringExtra(EXTRA_EQUIPMENT_TAG) ?: equipmentTag
                nmeaEnabled = intent.getBooleanExtra(EXTRA_NMEA_ENABLED, true)
                startLogging()
            }
            ACTION_STOP -> stopLogging()
            ACTION_DRAIN_QUEUE -> {
                drainTrigger.trySend(Unit)
                serviceScope.launch {
                    val size = offlineQueue.size()
                    TelemetryStateStore.update { state -> state.copy(queueSize = size) }
                }
            }
            ACTION_RECONNECT -> {
                serviceScope.launch {
                    mqttPublisher.reconnect()
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    override fun onDestroy() {
        if (networkCallbackRegistered && ::connectivityManager.isInitialized) {
            runCatching { connectivityManager.unregisterNetworkCallback(wifiCallback) }
            networkCallbackRegistered = false
        }
        drainTrigger.close()
        stopLogging()
        runBlocking { disconnectJob?.join() }
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun startLogging() {
        if (isRunning) {
            updateNotification()
            return
        }
        if (operatorId.isBlank() || equipmentTag.isBlank()) {
            Timber.w("TelemetryService start skipped: missing operatorId or equipmentTag")
            stopSelf()
            return
        }
        isRunning = true
        acquireWifiLock()
        startForeground(NOTIFICATION_ID, buildNotification(initial = true))
        imuAggregator.start()
        gnssManager.start(nmeaEnabled)
        TelemetryStateStore.update { state ->
            state.copy(
                serviceRunning = true,
                operatorId = operatorId,
                operatorName = operatorName,
                equipmentTag = equipmentTag
            )
        }
        serviceScope.launch { telemetryLoop() }
        drainTrigger.trySend(Unit)
    }

    private fun stopLogging() {
        if (!isRunning) {
            releaseWifiLock()
            stopAutoReconnectLoop()
            stopForeground(STOP_FOREGROUND_DETACH)
            return
        }
        isRunning = false
        releaseWifiLock()
        imuAggregator.stop()
        gnssManager.stop()
        disconnectJob = serviceScope.launch { mqttPublisher.disconnectAll(idProvider.deviceId) }
        TelemetryStateStore.update { state ->
            state.copy(serviceRunning = false)
        }
        stopAutoReconnectLoop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun mapBrokerStatus(status: MqttPublisher.BrokerStatus?): TelemetryUiState.BrokerStatus {
        if (status == null || !status.enabled) return TelemetryUiState.BrokerStatus.Disabled
        return when (status.state) {
            MqttPublisher.BrokerStatus.State.Disabled -> TelemetryUiState.BrokerStatus.Disabled
            MqttPublisher.BrokerStatus.State.Connecting -> TelemetryUiState.BrokerStatus.Connecting
            MqttPublisher.BrokerStatus.State.Disconnected -> TelemetryUiState.BrokerStatus.Disconnected
            MqttPublisher.BrokerStatus.State.Connected -> TelemetryUiState.BrokerStatus.Connected
            MqttPublisher.BrokerStatus.State.Reconnecting -> TelemetryUiState.BrokerStatus.Reconnecting
            MqttPublisher.BrokerStatus.State.Failed -> TelemetryUiState.BrokerStatus.Failed
        }
    }

    private fun acquireWifiLock() {
        if (!::wifiManager.isInitialized) return
        val currentLock = wifiLock
        if (currentLock?.isHeld == true) return
        wifiLock = runCatching {
            wifiManager.createWifiLock(
                WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                "SensorLogger:TelemetryWifi"
            ).apply {
                setReferenceCounted(false)
                acquire()
            }
        }.onFailure { Timber.w(it, "Failed to acquire Wi-Fi lock") }
            .getOrNull() ?: currentLock
    }

    private fun releaseWifiLock() {
        wifiLock?.let { lock ->
            runCatching {
                if (lock.isHeld) {
                    lock.release()
                }
            }.onFailure { Timber.w(it, "Failed to release Wi-Fi lock") }
        }
        wifiLock = null
    }

    private fun startAutoReconnectLoop() {
        if (autoReconnectActive || !isRunning) return
        autoReconnectActive = true
        autoReconnectJob = serviceScope.launch {
            var delayMs = AUTO_RECONNECT_INITIAL_DELAY_MS
            while (isActive && autoReconnectActive && isRunning) {
                delay(delayMs)
                if (!autoReconnectActive || !isRunning) break
                val success = runCatching { mqttPublisher.reconnect() }.isSuccess
                delayMs = if (success) {
                    AUTO_RECONNECT_INITIAL_DELAY_MS
                } else {
                    (delayMs * 2).coerceAtMost(AUTO_RECONNECT_MAX_DELAY_MS)
                }
            }
        }
    }

    private fun stopAutoReconnectLoop() {
        autoReconnectActive = false
        autoReconnectJob?.cancel()
        autoReconnectJob = null
    }

    private fun registerWifiCallback() {
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        try {
            connectivityManager.registerNetworkCallback(request, wifiCallback)
            networkCallbackRegistered = true
        } catch (t: Throwable) {
            Timber.w(t, "Failed to register Wi-Fi callback")
        }
    }

    private suspend fun telemetryLoop() {
        while (isRunning) {
            val frameStart = SystemClock.elapsedRealtime()
            val nowUtc = Time.nowUtcMillis()
            val seq = idProvider.nextSequence()
            val elapsedRealtime = Time.elapsedRealtimeNanos()
            val imuSnapshot = imuAggregator.snapshot(nowUtc)
            val gnssSnapshot = gnssManager.snapshot()
            val payload = buildPayload(nowUtc, elapsedRealtime, seq, imuSnapshot, gnssSnapshot)

            serviceScope.launch { writeCsv(payload) }

            val extras = TelemetryMappers.Extras(
                equipmentTag = equipmentTag.takeIf { it.isNotBlank() },
                barometerPressureHpa = imuSnapshot.pressure.takeIf { it != 0f },
                barometerAltitudeMeters = imuSnapshot.altitudeBaro.takeIf { it != 0f },
                gnss = TelemetryMappers.GnssExtras(
                    elapsedRealtimeNanos = gnssSnapshot.elapsedRealtimeNanos.takeIf { it != 0L },
                    cn0Min = gnssSnapshot.cn0Min,
                    cn0Max = gnssSnapshot.cn0Max,
                    cn0Percentile25 = gnssSnapshot.cn0Percentile25,
                    cn0Median = gnssSnapshot.cn0Median,
                    cn0Percentile75 = gnssSnapshot.cn0Percentile75,
                    gpsVisible = gnssSnapshot.gpsVisible,
                    gpsUsed = gnssSnapshot.gpsUsed,
                    glonassVisible = gnssSnapshot.glonassVisible,
                    glonassUsed = gnssSnapshot.glonassUsed,
                    galileoVisible = gnssSnapshot.galileoVisible,
                    galileoUsed = gnssSnapshot.galileoUsed,
                    beidouVisible = gnssSnapshot.beidouVisible,
                    beidouUsed = gnssSnapshot.beidouUsed,
                    qzssVisible = gnssSnapshot.qzssVisible,
                    qzssUsed = gnssSnapshot.qzssUsed,
                    sbasVisible = gnssSnapshot.sbasVisible,
                    sbasUsed = gnssSnapshot.sbasUsed,
                    rawGpsCount = gnssSnapshot.rawGpsCount,
                    rawGlonassCount = gnssSnapshot.rawGlonassCount,
                    rawGalileoCount = gnssSnapshot.rawGalileoCount,
                    rawBeidouCount = gnssSnapshot.rawBeidouCount,
                    rawQzssCount = gnssSnapshot.rawQzssCount,
                    rawSbasCount = gnssSnapshot.rawSbasCount
                ),
                imu = TelemetryMappers.ImuExtras(
                    quaternion = imuSnapshot.quaternion.takeIf { imuSnapshot.sampleCount > 0 },
                    accelerometerAccuracy = imuSnapshot.accelerometerAccuracy,
                    gyroscopeAccuracy = imuSnapshot.gyroscopeAccuracy,
                    rotationAccuracy = imuSnapshot.rotationAccuracy,
                    stationary = determineStationary(imuSnapshot, gnssSnapshot),
                    shockLevel = determineShockLevel(imuSnapshot),
                    shockScore = imuSnapshot.rmsJerk.takeIf { imuSnapshot.sampleCount > 0 && it.isFinite() },
                    linearAccelerationStats = imuSnapshot.linearAccelerationStats,
                    linearAccelerationNorm = imuSnapshot.linearAccelerationNormStats,
                    magnetometerStats = imuSnapshot.magnetometerStats,
                    magnetometerNorm = imuSnapshot.magnetometerNormStats,
                    magnetometerFieldStrength = imuSnapshot.magnetometerFieldStrength
                )
            )
            val payloadV11 = TelemetryMappers.fromLegacy(
                payload,
                imuSnapshot,
                extras = extras
            )
            val payloadJson = json.encodeToString(payloadV11)
            val lastSnapshotBytes = payloadJson.toByteArray(StandardCharsets.UTF_8)
            schedulePublish(payloadV11, lastSnapshotBytes)
            val queueSize = offlineQueue.size()

            val location = gnssSnapshot.location
            TelemetryStateStore.update { state ->
                state.copy(
                    operatorId = operatorId,
                    operatorName = operatorName,
                    equipmentTag = equipmentTag,
                    sequence = seq,
                    queueSize = queueSize,
                    lastLatitude = location?.latitude?.toFloat(),
                    lastLongitude = location?.longitude?.toFloat(),
                    lastSpeed = location?.speed?.toFloat(),
                    lastArms = imuSnapshot.rmsAcceleration,
                    lastAltitude = location?.altitude?.toFloat(),
                    lastAccuracy = location?.accuracy,
                    lastVerticalAccuracy = location?.verticalAccuracyMeters,
                    lastSpeedAccuracy = location?.speedAccuracyMetersPerSecond,
                    lastBearing = location?.bearing?.toFloat(),
                    lastBearingAccuracy = location?.bearingAccuracyDegrees,
                    lastProvider = location?.provider ?: gnssSnapshot.provider,
                    satellitesVisible = gnssSnapshot.satellitesVisible,
                    satellitesUsed = gnssSnapshot.satellitesUsed,
                    cn0Average = gnssSnapshot.cn0Average,
                    gnssElapsedRealtimeNanos = extras.gnss.elapsedRealtimeNanos,
                    hasL5 = gnssSnapshot.hasL5,
                    hdop = gnssSnapshot.hdop,
                    vdop = gnssSnapshot.vdop,
                    pdop = gnssSnapshot.pdop,
                    gnssRawSupported = gnssSnapshot.gnssRawSupported,
                    gnssRawCount = gnssSnapshot.gnssRawCount,
                    baroPressureHpa = extras.barometerPressureHpa,
                    baroAltitudeMeters = extras.barometerAltitudeMeters,
                    gnssCn0Min = extras.gnss.cn0Min,
                    gnssCn0Max = extras.gnss.cn0Max,
                    gnssCn0P25 = extras.gnss.cn0Percentile25,
                    gnssCn0P50 = extras.gnss.cn0Median,
                    gnssCn0P75 = extras.gnss.cn0Percentile75,
                    gnssGpsVisible = extras.gnss.gpsVisible,
                    gnssGpsUsed = extras.gnss.gpsUsed,
                    gnssGlonassVisible = extras.gnss.glonassVisible,
                    gnssGlonassUsed = extras.gnss.glonassUsed,
                    gnssGalileoVisible = extras.gnss.galileoVisible,
                    gnssGalileoUsed = extras.gnss.galileoUsed,
                    gnssBeidouVisible = extras.gnss.beidouVisible,
                    gnssBeidouUsed = extras.gnss.beidouUsed,
                    gnssQzssVisible = extras.gnss.qzssVisible,
                    gnssQzssUsed = extras.gnss.qzssUsed,
                    gnssSbasVisible = extras.gnss.sbasVisible,
                    gnssSbasUsed = extras.gnss.sbasUsed,
                    gnssRawGpsCount = extras.gnss.rawGpsCount,
                    gnssRawGlonassCount = extras.gnss.rawGlonassCount,
                    gnssRawGalileoCount = extras.gnss.rawGalileoCount,
                    gnssRawBeidouCount = extras.gnss.rawBeidouCount,
                    gnssRawQzssCount = extras.gnss.rawQzssCount,
                    gnssRawSbasCount = extras.gnss.rawSbasCount,
                    lastAx = imuSnapshot.ax,
                    lastAy = imuSnapshot.ay,
                    lastAz = imuSnapshot.az,
                    lastGx = imuSnapshot.gx,
                    lastGy = imuSnapshot.gy,
                    lastGz = imuSnapshot.gz,
                    lastPitch = imuSnapshot.pitch,
                    lastRoll = imuSnapshot.roll,
                    lastYaw = imuSnapshot.yaw,
                    lastJerk = imuSnapshot.rmsJerk,
                    lastYawRate = imuSnapshot.yawRateMean,
                    imuSamples = imuSnapshot.sampleCount,
                    imuHz = imuSnapshot.effectiveHz,
                    lastMessageTimestampUtc = nowUtc,
                    lastUpdatedMillis = System.currentTimeMillis(),
                    lastPayloadJson = payloadJson,
                    imuQuaternionW = extras.imu.quaternion?.w,
                    imuQuaternionX = extras.imu.quaternion?.x,
                    imuQuaternionY = extras.imu.quaternion?.y,
                    imuQuaternionZ = extras.imu.quaternion?.z,
                    imuAccelerometerAccuracy = extras.imu.accelerometerAccuracy.takeIf { it >= 0 },
                    imuGyroscopeAccuracy = extras.imu.gyroscopeAccuracy.takeIf { it >= 0 },
                    imuRotationAccuracy = extras.imu.rotationAccuracy.takeIf { it >= 0 },
                    imuMotionStationary = extras.imu.stationary,
                    imuMotionShockLevel = extras.imu.shockLevel,
                    imuMotionShockScore = extras.imu.shockScore,
                    linearAccXMean = extras.imu.linearAccelerationStats.x.mean,
                    linearAccXRms = extras.imu.linearAccelerationStats.x.rms,
                    linearAccXMin = extras.imu.linearAccelerationStats.x.min,
                    linearAccXMax = extras.imu.linearAccelerationStats.x.max,
                    linearAccXSigma = extras.imu.linearAccelerationStats.x.sigma,
                    linearAccYMean = extras.imu.linearAccelerationStats.y.mean,
                    linearAccYRms = extras.imu.linearAccelerationStats.y.rms,
                    linearAccYMin = extras.imu.linearAccelerationStats.y.min,
                    linearAccYMax = extras.imu.linearAccelerationStats.y.max,
                    linearAccYSigma = extras.imu.linearAccelerationStats.y.sigma,
                    linearAccZMean = extras.imu.linearAccelerationStats.z.mean,
                    linearAccZRms = extras.imu.linearAccelerationStats.z.rms,
                    linearAccZMin = extras.imu.linearAccelerationStats.z.min,
                    linearAccZMax = extras.imu.linearAccelerationStats.z.max,
                    linearAccZSigma = extras.imu.linearAccelerationStats.z.sigma,
                    linearAccNormRms = extras.imu.linearAccelerationNorm.rms,
                    linearAccNormSigma = extras.imu.linearAccelerationNorm.sigma,
                    magnetometerXMean = extras.imu.magnetometerStats.x.mean,
                    magnetometerXRms = extras.imu.magnetometerStats.x.rms,
                    magnetometerXMin = extras.imu.magnetometerStats.x.min,
                    magnetometerXMax = extras.imu.magnetometerStats.x.max,
                    magnetometerXSigma = extras.imu.magnetometerStats.x.sigma,
                    magnetometerYMean = extras.imu.magnetometerStats.y.mean,
                    magnetometerYRms = extras.imu.magnetometerStats.y.rms,
                    magnetometerYMin = extras.imu.magnetometerStats.y.min,
                    magnetometerYMax = extras.imu.magnetometerStats.y.max,
                    magnetometerYSigma = extras.imu.magnetometerStats.y.sigma,
                    magnetometerZMean = extras.imu.magnetometerStats.z.mean,
                    magnetometerZRms = extras.imu.magnetometerStats.z.rms,
                    magnetometerZMin = extras.imu.magnetometerStats.z.min,
                    magnetometerZMax = extras.imu.magnetometerStats.z.max,
                    magnetometerZSigma = extras.imu.magnetometerStats.z.sigma,
                    magnetometerFieldStrength = extras.imu.magnetometerFieldStrength
                )
            }
            updateNotification(payload)
            val loopElapsed = SystemClock.elapsedRealtime() - frameStart
            val sleep = PERIOD_MS - loopElapsed
            if (sleep > 0) {
                delay(sleep)
            } else {
                delay(0L)
            }
        }
    }

    private suspend fun writeCsv(payload: TelemetryPayload) {
        withContext(Dispatchers.IO) {
            csvWriter.append(payload.toCsvRow())
        }
    }

    private fun schedulePublish(payload: TelemetryPayloadV11, lastSnapshotBytes: ByteArray) {
        serviceScope.launch {
            val publishResults = withTimeoutOrNull(MQTT_PUBLISH_TIMEOUT_MS) {
                mqttPublisher.publishTelemetry(
                    payload.deviceId,
                    payload,
                    lastSnapshot = lastSnapshotBytes
                )
            }
            if (publishResults == null) {
                Timber.w("MQTT publish timed out for seq=%d", payload.sequenceId)
            }
            val enabledTargets = mqttPublisher.enabledLabels()
            val failedTargets = if (publishResults == null) {
                enabledTargets
            } else {
                enabledTargets.filter { publishResults[it] != true }.toSet()
            }
            if (failedTargets.isNotEmpty()) {
                val errorTag = if (publishResults == null) "publish_timeout" else "publish_failed"
                val stored = offlineQueue.enqueue(payload, failedTargets, errorTag)
                if (stored) {
                    drainTrigger.trySend(Unit)
                } else {
                    Timber.w("Offline queue drop for seq=%d: daily limit reached", payload.sequenceId)
                }
            }
            val queueSize = offlineQueue.size()
            TelemetryStateStore.update { state -> state.copy(queueSize = queueSize) }
        }
    }

    private suspend fun flushOfflineLoop() {
        var backoff = DRAIN_MIN_BACKOFF_MS
        while (serviceScope.isActive) {
            val outcome = drainOfflineBatch()
            TelemetryStateStore.update { state -> state.copy(queueSize = outcome.remaining) }
            if (outcome.remaining == 0) {
                backoff = DRAIN_MIN_BACKOFF_MS
                if (waitForDrainTrigger(DRAIN_IDLE_INTERVAL_MS)) {
                    return
                }
                continue
            }
            if (outcome.processed > 0) {
                backoff = DRAIN_MIN_BACKOFF_MS
                continue
            }
            val delayMillis = jitterDelay(backoff)
            backoff = min(backoff * 2, DRAIN_MAX_BACKOFF_MS)
            if (waitForDrainTrigger(delayMillis)) {
                return
            }
        }
    }

    private suspend fun drainOfflineBatch(): DrainOutcome =
        offlineQueue.drainOnce(DRAIN_BATCH_SIZE) { message ->
            val targets = message.targets.toSet()
            if (targets.isEmpty()) {
                emptyMap()
            } else {
                mqttPublisher.publishTelemetry(
                    deviceId = message.payload.deviceId,
                    payload = message.payload,
                    targetFilter = targets
                )
            }
        }

    @OptIn(ExperimentalCoroutinesApi::class)
    private suspend fun waitForDrainTrigger(timeoutMs: Long): Boolean {
        var channelClosed = false
        select<Unit> {
            drainTrigger.onReceiveCatching { result ->
                channelClosed = result.isClosed
            }
            onTimeout(timeoutMs) {}
        }
        return channelClosed
    }

    private fun jitterDelay(base: Long): Long {
        if (base <= 1L) return 1L
        val spread = base / 2
        val offset = if (spread > 0) Random.nextLong(-spread, spread + 1) else 0L
        return (base + offset).coerceAtLeast(base / 2)
    }

    private fun buildPayload(
        tsUtc: Long,
        elapsedRealtimeNanos: Long,
        seq: Long,
        imu: ImuSnapshot,
        gnss: GnssSnapshot
    ): TelemetryPayload {
        val deviceId = BuildConfig.DEVICE_ID.takeIf { it.isNotBlank() } ?: idProvider.deviceId
        val location = gnss.location
        return TelemetryPayload(
            deviceId = deviceId,
            timestampUtc = tsUtc,
            elapsedRealtimeNanos = elapsedRealtimeNanos,
            sequence = seq,
            operatorId = operatorId,
            operatorName = operatorName,
            equipmentTag = equipmentTag,
            latitude = location?.latitude?.toFloat() ?: 0f,
            longitude = location?.longitude?.toFloat() ?: 0f,
            altitude = location?.altitude?.toFloat() ?: 0f,
            speed = location?.speed?.toFloat() ?: 0f,
            bearing = location?.bearing?.toFloat() ?: 0f,
            accuracy = location?.accuracy ?: 0f,
            verticalAccuracyMeters = location?.verticalAccuracyMeters ?: 0f,
            speedAccuracyMps = location?.speedAccuracyMetersPerSecond ?: 0f,
            bearingAccuracyDeg = location?.bearingAccuracyDegrees ?: 0f,
            satellitesVisible = gnss.satellitesVisible,
            satellitesUsed = gnss.satellitesUsed,
            cn0Average = gnss.cn0Average,
            hasL5 = gnss.hasL5,
            hdop = gnss.hdop,
            vdop = gnss.vdop,
            pdop = gnss.pdop,
            provider = gnss.provider,
            ax = imu.ax,
            ay = imu.ay,
            az = imu.az,
            gx = imu.gx,
            gy = imu.gy,
            gz = imu.gz,
            pitch = imu.pitch,
            roll = imu.roll,
            yaw = imu.yaw,
            a_rms_total = imu.rmsAcceleration,
            jerk_rms = imu.rmsJerk,
            yaw_rate_mean = imu.yawRateMean,
            samples_imu = imu.sampleCount,
            imu_hz = imu.effectiveHz,
            pressure = imu.pressure,
            alt_baro = imu.altitudeBaro,
            gnss_raw_supported = gnss.gnssRawSupported,
            gnss_raw_count = gnss.gnssRawCount,
            timestamp = Time.formatUtc(tsUtc)
        )
    }

    private fun determineStationary(imu: ImuSnapshot, gnss: GnssSnapshot): Boolean? {
        if (imu.sampleCount == 0) return null
        val speed = gnss.location?.speed ?: 0f
        val jerk = imu.rmsJerk
        val sigma = imu.accelerationNormStats.sigma ?: 0f
        val imuStationary = jerk < 1f && sigma < 0.2f
        val gnssStationary = speed.isFinite() && speed < 0.3f
        return when {
            imuStationary && gnssStationary -> true
            !imuStationary && !gnssStationary -> false
            else -> null
        }
    }

    private fun determineShockLevel(imu: ImuSnapshot): String? {
        if (imu.sampleCount == 0) return null
        val jerk = imu.rmsJerk
        if (!jerk.isFinite()) return null
        return when {
            jerk < 1.5f -> "low"
            jerk < 4.5f -> "medium"
            else -> "high"
        }
    }

    private fun buildNotification(payload: TelemetryPayload? = null, initial: Boolean = false): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val title = if (isRunning) getString(R.string.notification_title_active) else getString(R.string.notification_title_idle)
        val text = payload?.let {
            "seq=${it.sequence} | lat=${"%.5f".format(it.latitude)} | a_rms=${"%.3f".format(it.a_rms_total)}"
        } ?: getString(R.string.notification_text_idle)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_logger)
            .setContentIntent(pendingIntent)
            .setOngoing(isRunning)
            .setOnlyAlertOnce(!initial)
            .build()
    }

    private fun updateNotification(payload: TelemetryPayload? = null) {
        if (!isRunning) return
        notificationManager.notify(NOTIFICATION_ID, buildNotification(payload))
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notification_channel_description)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "com.example.sensorlogger.action.START"
        const val ACTION_STOP = "com.example.sensorlogger.action.STOP"
        const val ACTION_DRAIN_QUEUE = "com.example.sensorlogger.action.DRAIN_QUEUE"
        const val ACTION_RECONNECT = "com.example.sensorlogger.action.RECONNECT_MQTT"

        private const val EXTRA_OPERATOR_ID = "extra_operator_id"
        private const val EXTRA_OPERATOR_NAME = "extra_operator_name"
        private const val EXTRA_EQUIPMENT_TAG = "extra_equipment_tag"
        private const val EXTRA_NMEA_ENABLED = "extra_nmea_enabled"

        private const val NOTIFICATION_ID = 101
        private const val CHANNEL_ID = "sensorlogger_channel"
        private const val PERIOD_MS = 1_000L
        private const val DRAIN_MIN_BACKOFF_MS = 2_000L
        private const val DRAIN_MAX_BACKOFF_MS = 300_000L
        private const val DRAIN_IDLE_INTERVAL_MS = 60_000L
        private const val DRAIN_BATCH_SIZE = 500
        private const val MQTT_PUBLISH_TIMEOUT_MS = 1_500L
        private const val AUTO_RECONNECT_INITIAL_DELAY_MS = 5_000L
        private const val AUTO_RECONNECT_MAX_DELAY_MS = 60_000L

        fun startIntent(
            context: Context,
            operatorId: String,
            operatorName: String,
            equipmentTag: String,
            nmeaEnabled: Boolean
        ): Intent =
            Intent(context, TelemetryService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_OPERATOR_ID, operatorId)
                putExtra(EXTRA_OPERATOR_NAME, operatorName)
                putExtra(EXTRA_EQUIPMENT_TAG, equipmentTag)
                putExtra(EXTRA_NMEA_ENABLED, nmeaEnabled)
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, TelemetryService::class.java).apply { action = ACTION_STOP }
    }
}
