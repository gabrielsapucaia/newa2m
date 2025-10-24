package com.example.sensorlogger

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.content.res.ColorStateList
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.TextViewCompat
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.example.sensorlogger.BuildConfig
import com.example.sensorlogger.databinding.ActivityMainBinding
import com.example.sensorlogger.model.TelemetryUiState
import com.example.sensorlogger.repository.TelemetryStateStore
import com.example.sensorlogger.service.TelemetryService
import com.example.sensorlogger.util.OperatorStore
import com.example.sensorlogger.util.Time
import com.example.sensorlogger.work.OperatorSyncWorker
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var operatorStore: OperatorStore
    private var lastUiState: TelemetryUiState? = null
    private val brokerEndpoints: List<String> by lazy {
        val configured = BuildConfig.MQTT_SERVER_URIS
            .split(';')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        val fallback = BuildConfig.MQTT_HOST.takeIf { it.isNotBlank() }?.let {
            "${BuildConfig.MQTT_SCHEME}://$it:${BuildConfig.MQTT_PORT}"
        }
        (configured + listOfNotNull(fallback)).distinct()
    }

    private val foregroundPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { updatePermissionsState() }

    private val backgroundPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            showBackgroundPermissionDialog()
        }
        updatePermissionsState()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* no-op */ }

    private val batteryLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* no-op */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        updateBrokerEndpointLabel(null)

        operatorStore = OperatorStore(this)
        restoreOperatorUi()
        bindListeners()
        observeState()
        updatePermissionsState()
        requestNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionsState()
    }

    private fun bindListeners() {
        binding.inputOperatorId.doAfterTextChanged {
            if (!it.isNullOrBlank()) {
                binding.inputLayoutOperatorId.error = null
            }
            updateStartButtonEnabled()
        }
        binding.inputEquipmentTag.doAfterTextChanged {
            if (!it.isNullOrBlank()) {
                binding.inputLayoutEquipmentTag.error = null
            }
            updateStartButtonEnabled()
        }

        binding.buttonSaveOperator.setOnClickListener {
            operatorStore.operatorId = binding.inputOperatorId.text?.toString().orEmpty().trim()
            operatorStore.operatorName = binding.inputOperatorName.text?.toString().orEmpty().trim()
            operatorStore.equipmentTag = binding.inputEquipmentTag.text?.toString().orEmpty().trim()
            operatorStore.autoStart = binding.checkAutoStart.isChecked
            operatorStore.nmeaEnabled = binding.switchNmea.isChecked
            TelemetryStateStore.update { state ->
                state.copy(
                    operatorId = operatorStore.operatorId,
                    operatorName = operatorStore.operatorName,
                    equipmentTag = operatorStore.equipmentTag,
                    nmeaEnabled = operatorStore.nmeaEnabled
                )
            }
        }

        binding.buttonStart.setOnClickListener {
            if (ensurePermissions() && ensureOperatorIdentity()) {
                startTelemetryService()
            }
        }

        binding.buttonStop.setOnClickListener {
            ContextCompat.startForegroundService(this, TelemetryService.stopIntent(this))
        }

        binding.switchNmea.setOnCheckedChangeListener { _, isChecked ->
            operatorStore.nmeaEnabled = isChecked
            TelemetryStateStore.update { state -> state.copy(nmeaEnabled = isChecked) }
        }

        binding.checkAutoStart.setOnCheckedChangeListener { _, isChecked ->
            operatorStore.autoStart = isChecked
        }

        binding.buttonBattery.setOnClickListener {
            requestBatteryOptimizationExemption()
        }

        binding.buttonDrainQueue.setOnClickListener {
            val intent = Intent(this, TelemetryService::class.java).apply {
                action = TelemetryService.ACTION_DRAIN_QUEUE
            }
            startService(intent)
        }

        binding.buttonForceSync.setOnClickListener {
            enqueueOperatorSync(force = true)
        }

        binding.buttonReconnect.setOnClickListener {
            if (lastUiState?.serviceRunning == true) {
                val intent = Intent(this, TelemetryService::class.java).apply {
                    action = TelemetryService.ACTION_RECONNECT
                }
                ContextCompat.startForegroundService(this, intent)
            } else {
                Toast.makeText(this, R.string.text_service_stopped, Toast.LENGTH_SHORT).show()
            }
        }

        binding.buttonCopyPayload.setOnClickListener {
            val payload = lastUiState?.lastPayloadJson
            if (payload.isNullOrBlank()) {
                Toast.makeText(this, R.string.text_not_available, Toast.LENGTH_SHORT).show()
            } else {
                copyToClipboard("telemetry_payload", payload)
                Toast.makeText(this, R.string.action_copy_payload, Toast.LENGTH_SHORT).show()
            }
        }

        updateStartButtonEnabled()
    }

    private fun observeState() {
        lifecycleScope.launch {
            lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
                TelemetryStateStore.state.collectLatest { state ->
                    renderState(state)
                }
            }
        }
    }

    private fun renderState(state: TelemetryUiState) {
        lastUiState = state
        updateBrokerEndpointLabel(state.brokerActiveEndpoint)

        binding.textServiceStatus.text = if (state.serviceRunning) {
            binding.textServiceStatus.setTextColor(ContextCompat.getColor(this, R.color.brand_secondary))
            getString(R.string.text_service_running)
        } else {
            binding.textServiceStatus.setTextColor(ContextCompat.getColor(this, android.R.color.darker_gray))
            getString(R.string.text_service_stopped)
        }
        binding.buttonStop.isEnabled = state.serviceRunning

        renderBrokerStatus(binding.textLocalBroker, R.string.label_broker_local, state.localBrokerStatus)
        renderBrokerStatus(binding.textCloudBroker, R.string.label_broker_cloud, state.cloudBrokerStatus)

        binding.textSequence.text = buildString {
            appendLine("Sequência")
            append("• Atual: ${state.sequence}")
        }
        binding.textQueue.text = buildString {
            appendLine("Fila offline")
            append("• Pendentes: ${state.queueSize}")
        }
        binding.buttonDrainQueue.isEnabled = state.queueSize > 0

        val lastUtc = if (state.lastMessageTimestampUtc != 0L) {
            Time.formatUtc(state.lastMessageTimestampUtc)
        } else {
            getString(R.string.text_not_available)
        }
        binding.textLastUpdate.text = buildString {
            appendLine("Última mensagem UTC")
            append("• $lastUtc")
        }

        val latText = formatCoord(state.lastLatitude)
        val lonText = formatCoord(state.lastLongitude)
        val altText = formatFloatWithUnit(state.lastAltitude, "m", digits = 1)
        val provider = state.lastProvider ?: getString(R.string.text_not_available)
        binding.textGnssCoordinates.text = buildString {
            appendLine("Coordenadas")
            appendLine("• Latitude: $latText")
            appendLine("• Longitude: $lonText")
            append("• Altitude: $altText | Prov.: $provider")
        }

        val speedText = formatFloatWithUnit(state.lastSpeed, "m/s", digits = 2)
        val bearingText = formatFloatWithUnit(state.lastBearing, "deg", digits = 1)
        binding.textGnssSpeedBearing.text = buildString {
            appendLine("Dinâmica")
            appendLine("• Velocidade: $speedText")
            append("• Rumo: $bearingText")
        }

        val accText = formatFloatWithUnit(state.lastAccuracy, "m", digits = 1)
        val vAccText = formatFloatWithUnit(state.lastVerticalAccuracy, "m", digits = 1)
        val sAccText = formatFloatWithUnit(state.lastSpeedAccuracy, "m/s", digits = 2)
        val bAccText = formatFloatWithUnit(state.lastBearingAccuracy, "deg", digits = 1)
        binding.textGnssAccuracy.text = buildString {
            appendLine("Precisões")
            appendLine("• Posição: $accText")
            appendLine("• Vertical: $vAccText")
            appendLine("• Velocidade: $sAccText")
            append("• Rumo: $bAccText")
        }

        val elapsedRealtimeText = formatElapsedRealtime(state.gnssElapsedRealtimeNanos)
        val ageText = formatElapsedAge(state.lastUpdatedMillis)
        binding.textGnssTiming.text = buildString {
            appendLine("Tempo GNSS")
            appendLine("• elapsedRealtime: $elapsedRealtimeText")
            append("• Atualizado há: $ageText")
        }

        val cn0Avg = formatFloat(state.cn0Average, 1)
        val cn0Min = formatFloat(state.gnssCn0Min, 1)
        val cn0Max = formatFloat(state.gnssCn0Max, 1)
        val cn0P25 = formatFloat(state.gnssCn0P25, 1)
        val cn0P50 = formatFloat(state.gnssCn0P50, 1)
        val cn0P75 = formatFloat(state.gnssCn0P75, 1)
        binding.textGnssCn0.text = buildString {
            appendLine("C/N0 (dB-Hz)")
            appendLine("• Médio: $cn0Avg")
            appendLine("• Min/Máx: $cn0Min / $cn0Max")
            append("• P25/P50/P75: $cn0P25 / $cn0P50 / $cn0P75")
        }

        val totalSat = formatVisibleUsed(state.satellitesVisible, state.satellitesUsed)
        val gpsSat = formatVisibleUsed(state.gnssGpsVisible, state.gnssGpsUsed)
        val glonassSat = formatVisibleUsed(state.gnssGlonassVisible, state.gnssGlonassUsed)
        val galileoSat = formatVisibleUsed(state.gnssGalileoVisible, state.gnssGalileoUsed)
        val beidouSat = formatVisibleUsed(state.gnssBeidouVisible, state.gnssBeidouUsed)
        val qzssSat = formatVisibleUsed(state.gnssQzssVisible, state.gnssQzssUsed)
        val sbasSat = formatVisibleUsed(state.gnssSbasVisible, state.gnssSbasUsed)
        val l5Text = formatBool(state.hasL5)
        binding.textGnssSatellites.text = buildString {
            appendLine("Satélites (visível/uso)")
            appendLine("• Total: $totalSat")
            appendLine("• GPS: $gpsSat | GLONASS: $glonassSat")
            appendLine("• Galileo: $galileoSat | BeiDou: $beidouSat")
            appendLine("• QZSS: $qzssSat | SBAS: $sbasSat")
            append("• Suporte L5: $l5Text")
        }

        val hdop = formatFloat(state.hdop, 1)
        val vdop = formatFloat(state.vdop, 1)
        val pdop = formatFloat(state.pdop, 1)
        binding.textGnssDops.text = buildString {
            appendLine("DOP")
            appendLine("• HDOP: $hdop")
            appendLine("• VDOP: $vdop")
            append("• PDOP: $pdop")
        }

        val gnssRawSupport = formatBool(state.gnssRawSupported)
        val gnssRawCount = formatInt(state.gnssRawCount)
        val rawPerConstellation = listOf(
            "GPS" to state.gnssRawGpsCount,
            "GLONASS" to state.gnssRawGlonassCount,
            "Galileo" to state.gnssRawGalileoCount,
            "BeiDou" to state.gnssRawBeidouCount,
            "QZSS" to state.gnssRawQzssCount,
            "SBAS" to state.gnssRawSbasCount
        ).joinToString(", ") { (name, value) -> "$name=${formatCount(value)}" }
        binding.textGnssRaw.text = buildString {
            appendLine("GNSS bruto")
            appendLine("• Suporte: $gnssRawSupport")
            append("• Medições totais: $gnssRawCount")
        }
        binding.textGnssConstellations.text = buildString {
            appendLine("Bruto por constelação")
            append("• $rawPerConstellation")
        }

        val ax = formatFloat(state.lastAx, 3)
        val ay = formatFloat(state.lastAy, 3)
        val az = formatFloat(state.lastAz, 3)
        binding.textImuAccel.text = buildString {
            appendLine("Acelerômetro (m/s²)")
            appendLine("• X: $ax")
            appendLine("• Y: $ay")
            append("• Z: $az")
        }

        val gx = formatFloat(state.lastGx, 3)
        val gy = formatFloat(state.lastGy, 3)
        val gz = formatFloat(state.lastGz, 3)
        binding.textImuGyro.text = buildString {
            appendLine("Giroscópio (rad/s)")
            appendLine("• X: $gx")
            appendLine("• Y: $gy")
            append("• Z: $gz")
        }

        val pitch = formatFloat(state.lastPitch, 2)
        val roll = formatFloat(state.lastRoll, 2)
        val yaw = formatFloat(state.lastYaw, 2)
        val qw = formatFloat(state.imuQuaternionW, 3)
        val qx = formatFloat(state.imuQuaternionX, 3)
        val qy = formatFloat(state.imuQuaternionY, 3)
        val qz = formatFloat(state.imuQuaternionZ, 3)
        binding.textImuOrientation.text = buildString {
            appendLine("Orientação (deg)")
            appendLine("• Pitch: $pitch")
            appendLine("• Roll: $roll")
            appendLine("• Yaw: $yaw")
            append("• Quaternion: w=$qw, x=$qx, y=$qy, z=$qz")
        }

        val arms = formatFloat(state.lastArms, 3)
        val jerk = formatFloat(state.lastJerk, 3)
        val yawRate = formatFloat(state.lastYawRate, 3)
        val samples = formatInt(state.imuSamples)
        val hz = formatFloat(state.imuHz, 2)
        binding.textImuStats.text = buildString {
            appendLine("Janela 1 Hz")
            appendLine("• a_rms: $arms")
            appendLine("• jerk_rms: $jerk")
            appendLine("• yaw_rate: $yawRate")
            append("• Amostras: $samples | Hz: $hz")
        }

        binding.textImuLinearAccel.text = buildString {
            appendLine("Aceleração linear (m/s²)")
            appendLine("• X: média=${formatFloat(state.linearAccXMean, 3)} rms=${formatFloat(state.linearAccXRms, 3)} min/max=${formatFloat(state.linearAccXMin, 3)} / ${formatFloat(state.linearAccXMax, 3)} σ=${formatFloat(state.linearAccXSigma, 3)}")
            appendLine("• Y: média=${formatFloat(state.linearAccYMean, 3)} rms=${formatFloat(state.linearAccYRms, 3)} min/max=${formatFloat(state.linearAccYMin, 3)} / ${formatFloat(state.linearAccYMax, 3)} σ=${formatFloat(state.linearAccYSigma, 3)}")
            appendLine("• Z: média=${formatFloat(state.linearAccZMean, 3)} rms=${formatFloat(state.linearAccZRms, 3)} min/max=${formatFloat(state.linearAccZMin, 3)} / ${formatFloat(state.linearAccZMax, 3)} σ=${formatFloat(state.linearAccZSigma, 3)}")
            append("• Norma: rms=${formatFloat(state.linearAccNormRms, 3)} σ=${formatFloat(state.linearAccNormSigma, 3)}")
        }

        binding.textImuMagnetometer.text = buildString {
            appendLine("Magnetômetro (uT)")
            appendLine("• X: média=${formatFloat(state.magnetometerXMean, 2)} rms=${formatFloat(state.magnetometerXRms, 2)} min/max=${formatFloat(state.magnetometerXMin, 2)} / ${formatFloat(state.magnetometerXMax, 2)} σ=${formatFloat(state.magnetometerXSigma, 2)}")
            appendLine("• Y: média=${formatFloat(state.magnetometerYMean, 2)} rms=${formatFloat(state.magnetometerYRms, 2)} min/max=${formatFloat(state.magnetometerYMin, 2)} / ${formatFloat(state.magnetometerYMax, 2)} σ=${formatFloat(state.magnetometerYSigma, 2)}")
            appendLine("• Z: média=${formatFloat(state.magnetometerZMean, 2)} rms=${formatFloat(state.magnetometerZRms, 2)} min/max=${formatFloat(state.magnetometerZMin, 2)} / ${formatFloat(state.magnetometerZMax, 2)} σ=${formatFloat(state.magnetometerZSigma, 2)}")
            append("• Intensidade: ${formatFloat(state.magnetometerFieldStrength, 2)} uT")
        }

        val stationary = formatMotionState(state.imuMotionStationary)
        val shockLevel = formatShockLevel(state.imuMotionShockLevel)
        val shockScore = formatFloat(state.imuMotionShockScore, 2)
        binding.textImuMotion.text = buildString {
            appendLine("Movimento")
            appendLine("• Parado: $stationary")
            appendLine("• Choque: $shockLevel")
            append("• Índice: $shockScore")
        }

        val accAccuracy = formatSensorAccuracy(state.imuAccelerometerAccuracy)
        val gyroAccuracy = formatSensorAccuracy(state.imuGyroscopeAccuracy)
        val rotAccuracy = formatSensorAccuracy(state.imuRotationAccuracy)
        binding.textImuAccuracy.text = buildString {
            appendLine("Calibração dos sensores")
            appendLine("• Acelerômetro: $accAccuracy")
            appendLine("• Giroscópio: $gyroAccuracy")
            append("• Vetor de rotação: $rotAccuracy")
        }

        val pressure = formatFloatWithUnit(state.baroPressureHpa, "hPa", digits = 2)
        val baroAlt = formatFloatWithUnit(state.baroAltitudeMeters, "m", digits = 1)
        binding.textBarometer.text = buildString {
            appendLine("Pressão atmosférica")
            appendLine("• Pressão: $pressure")
            append("• Altitude baro: $baroAlt")
        }

        val payloadPreview = state.lastPayloadJson?.takeIf { it.isNotBlank() }
        binding.textLastPayload.text = payloadPreview?.let { preview ->
            if (preview.length > 500) preview.take(500) + "..." else preview
        } ?: getString(R.string.text_not_available)
        binding.buttonCopyPayload.isEnabled = !payloadPreview.isNullOrBlank()

        if (binding.switchNmea.isChecked != state.nmeaEnabled) {
            binding.switchNmea.isChecked = state.nmeaEnabled
        }

        updateStartButtonEnabled(state)
        binding.buttonReconnect.isEnabled = state.serviceRunning
    }

    private fun renderBrokerStatus(textView: TextView, labelRes: Int, status: TelemetryUiState.BrokerStatus) {
        val statusTextRes = when (status) {
            TelemetryUiState.BrokerStatus.Connected -> R.string.text_broker_connected
            TelemetryUiState.BrokerStatus.Connecting -> R.string.text_broker_connecting
            TelemetryUiState.BrokerStatus.Disconnected -> R.string.text_broker_disconnected
            TelemetryUiState.BrokerStatus.Reconnecting -> R.string.text_broker_reconnecting
            TelemetryUiState.BrokerStatus.Failed -> R.string.text_broker_failed
            TelemetryUiState.BrokerStatus.Disabled -> R.string.text_broker_disabled
        }
        val colorRes = when (status) {
            TelemetryUiState.BrokerStatus.Connected -> R.color.status_connected
            TelemetryUiState.BrokerStatus.Connecting -> R.color.status_connecting
            TelemetryUiState.BrokerStatus.Disconnected -> R.color.status_disconnected
            TelemetryUiState.BrokerStatus.Reconnecting -> R.color.status_reconnecting
            TelemetryUiState.BrokerStatus.Failed -> R.color.status_failed
            TelemetryUiState.BrokerStatus.Disabled -> R.color.status_disabled
        }
        val color = ContextCompat.getColor(this, colorRes)
        val statusText = getString(statusTextRes).uppercase(Locale.getDefault())
        textView.text = getString(R.string.text_broker_format, getString(labelRes), statusText)
        textView.setTextColor(color)
        TextViewCompat.setCompoundDrawableTintList(textView, ColorStateList.valueOf(color))
    }

    private fun restoreOperatorUi() {
        binding.inputOperatorId.setText(operatorStore.operatorId)
        binding.inputOperatorName.setText(operatorStore.operatorName)
        binding.inputEquipmentTag.setText(operatorStore.equipmentTag)
        binding.checkAutoStart.isChecked = operatorStore.autoStart
        binding.switchNmea.isChecked = operatorStore.nmeaEnabled
        TelemetryStateStore.update { state ->
            state.copy(
                operatorId = operatorStore.operatorId,
                operatorName = operatorStore.operatorName,
                equipmentTag = operatorStore.equipmentTag,
                nmeaEnabled = operatorStore.nmeaEnabled
            )
        }
        updateStartButtonEnabled()
    }

    private fun updateStartButtonEnabled(state: TelemetryUiState? = lastUiState) {
        val hasOperator = !binding.inputOperatorId.text.isNullOrBlank()
        val hasEquipment = !binding.inputEquipmentTag.text.isNullOrBlank()
        val uiState = state ?: lastUiState ?: TelemetryStateStore.state.value
        val canStart = hasOperator && hasEquipment && uiState.permissionsGranted && !uiState.serviceRunning
        binding.buttonStart.isEnabled = canStart
        binding.buttonReconnect.isEnabled = uiState.serviceRunning
    }

    private fun ensureOperatorIdentity(): Boolean {
        val operatorId = binding.inputOperatorId.text?.toString().orEmpty().trim()
        val equipmentTag = binding.inputEquipmentTag.text?.toString().orEmpty().trim()
        var valid = true
        if (operatorId.isEmpty()) {
            binding.inputLayoutOperatorId.error = getString(R.string.text_operator_required)
            valid = false
        } else {
            binding.inputLayoutOperatorId.error = null
        }
        if (equipmentTag.isEmpty()) {
            binding.inputLayoutEquipmentTag.error = getString(R.string.text_equipment_required)
            valid = false
        } else {
            binding.inputLayoutEquipmentTag.error = null
        }
        return valid
    }

    private fun enqueueOperatorSync(force: Boolean) {
        if (force) {
            OperatorSyncWorker.enqueueImmediate(this)
            Toast.makeText(this, R.string.action_force_operator_sync, Toast.LENGTH_SHORT).show()
        }
    }

    private fun ensurePermissions(): Boolean {
        if (!hasForegroundPermissions()) {
            foregroundPermissionLauncher.launch(FOREGROUND_PERMISSIONS)
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundPermission()) {
            backgroundPermissionLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            return false
        }
        requestNotificationPermissionIfNeeded()
        return true
    }

    private fun updatePermissionsState() {
        TelemetryStateStore.update { state ->
            state.copy(permissionsGranted = hasAllPermissions())
        }
    }

    private fun hasAllPermissions(): Boolean =
        hasForegroundPermissions() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundPermission())

    private fun hasForegroundPermissions(): Boolean =
        FOREGROUND_PERMISSIONS.all { permission ->
            ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }

    private fun hasBackgroundPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    private fun hasNotificationPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasNotificationPermission()) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun startTelemetryService() {
        val operatorId = binding.inputOperatorId.text?.toString().orEmpty().trim()
        val equipmentTag = binding.inputEquipmentTag.text?.toString().orEmpty().trim()
        val name = binding.inputOperatorName.text?.toString().orEmpty().trim()
        operatorStore.operatorId = operatorId
        operatorStore.operatorName = name
        operatorStore.equipmentTag = equipmentTag
        val intent = TelemetryService.startIntent(
            context = this,
            operatorId = operatorId,
            operatorName = name,
            equipmentTag = equipmentTag,
            nmeaEnabled = binding.switchNmea.isChecked
        )
        ContextCompat.startForegroundService(this, intent)
    }

    private fun requestBatteryOptimizationExemption() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val packageName = packageName
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) {
            return
        }
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:$packageName")
        }
        batteryLauncher.launch(intent)
    }

    private fun showBackgroundPermissionDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setMessage("Para registrar GNSS em segundo plano, permita \"Sempre\" nas configurações de localização.")
            .setPositiveButton("Abrir configurações") { _, _ ->
                val intent = Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null)
                )
                startActivity(intent)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun formatElapsedRealtime(nanos: Long?): String =
        if (nanos == null || nanos <= 0L) {
            getString(R.string.text_not_available)
        } else {
            val millis = nanos.toDouble() / 1_000_000.0
            String.format(Locale.US, "%.0f ms", millis)
        }

    private fun formatElapsedAge(lastUpdateMillis: Long): String =
        if (lastUpdateMillis <= 0L) {
            getString(R.string.text_not_available)
        } else {
            val deltaMillis = (System.currentTimeMillis() - lastUpdateMillis).coerceAtLeast(0L)
            val seconds = deltaMillis / 1000.0
            String.format(Locale.US, "%.1f s", seconds)
        }

    private fun formatFloat(value: Float?, digits: Int = 2): String =
        value?.let { String.format(Locale.US, "%.${digits}f", it) } ?: getString(R.string.text_not_available)

    private fun formatFloatWithUnit(value: Float?, unit: String, digits: Int = 2): String {
        val base = value?.let { String.format(Locale.US, "%.${digits}f", it) } ?: return getString(R.string.text_not_available)
        return "$base $unit"
    }

    private fun formatInt(value: Int?): String =
        value?.toString() ?: getString(R.string.text_not_available)

    private fun formatCount(value: Int?): String =
        value?.toString() ?: "--"

    private fun formatBool(value: Boolean?): String = when (value) {
        true -> "sim"
        false -> "não"
        null -> getString(R.string.text_not_available)
    }

    private fun formatCoord(value: Float?): String =
        value?.let { String.format(Locale.US, "%.5f", it) } ?: getString(R.string.text_not_available)

    private fun formatVisibleUsed(visible: Int?, used: Int?): String {
        if (visible == null && used == null) return getString(R.string.text_not_available)
        val v = visible ?: 0
        val u = used ?: 0
        return "$v/$u"
    }

    private fun formatSensorAccuracy(value: Int?): String = when (value) {
        SensorManager.SENSOR_STATUS_UNRELIABLE -> "não confiável"
        SensorManager.SENSOR_STATUS_ACCURACY_LOW -> "baixa"
        SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM -> "média"
        SensorManager.SENSOR_STATUS_ACCURACY_HIGH -> "alta"
        null -> getString(R.string.text_not_available)
        else -> value.toString()
    }

    private fun formatMotionState(stationary: Boolean?): String = when (stationary) {
        true -> "sim"
        false -> "não"
        null -> getString(R.string.text_not_available)
    }

    private fun formatShockLevel(level: String?): String = when (level) {
        null -> getString(R.string.text_not_available)
        "low" -> "baixo"
        "medium" -> "médio"
        "high" -> "alto"
        else -> level
    }

    private fun updateBrokerEndpointLabel(activeEndpoint: String?) {
        val label = getString(R.string.label_broker_endpoint)
        val endpointsText = if (brokerEndpoints.isEmpty()) {
            getString(R.string.text_not_available)
        } else {
            brokerEndpoints.joinToString(" | ")
        }
        val activeText = activeEndpoint?.takeIf { it.isNotBlank() }
        val text = if (activeText != null) {
            "$label: $endpointsText\n${getString(R.string.text_broker_active_endpoint, activeText)}"
        } else {
            "$label: $endpointsText"
        }
        binding.textBrokerEndpoint.text = text
    }

    private fun copyToClipboard(label: String, text: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    companion object {
        private val FOREGROUND_PERMISSIONS = buildSet {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.BODY_SENSORS)
            add(Manifest.permission.ACTIVITY_RECOGNITION)
        }.toTypedArray()
    }
}
