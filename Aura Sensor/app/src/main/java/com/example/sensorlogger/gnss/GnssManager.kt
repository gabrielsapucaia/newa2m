package com.example.sensorlogger.gnss

import android.annotation.SuppressLint
import android.content.Context
import android.location.GnssMeasurementsEvent
import android.location.GnssStatus
import android.location.Location
import android.location.LocationManager
import android.location.OnNmeaMessageListener
import com.example.sensorlogger.model.GnssSnapshot
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import timber.log.Timber
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import android.os.Build

class GnssManager(private val context: Context) {

    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)
    private val locationManager = context.getSystemService(LocationManager::class.java)

    private val lock = Any()

    private var lastLocation: Location? = null
    private var lastElapsedRealtimeNanos: Long = 0L
    private var satellitesVisible: Int = 0
    private var satellitesUsed: Int = 0
    private var cn0Average: Float = 0f
    private var cn0Min: Float? = null
    private var cn0Max: Float? = null
    private var cn0Percentile25: Float? = null
    private var cn0Median: Float? = null
    private var cn0Percentile75: Float? = null
    private var hasL5: Boolean = false
    private var hdop: Float = 0f
    private var vdop: Float = 0f
    private var pdop: Float = 0f
    private var provider: String = ""
    private var gnssRawSupported: Boolean = false
    private var gnssRawCount: Int = 0
    private var gpsVisible: Int = 0
    private var gpsUsed: Int = 0
    private var glonassVisible: Int = 0
    private var glonassUsed: Int = 0
    private var galileoVisible: Int = 0
    private var galileoUsed: Int = 0
    private var beidouVisible: Int = 0
    private var beidouUsed: Int = 0
    private var qzssVisible: Int = 0
    private var qzssUsed: Int = 0
    private var sbasVisible: Int = 0
    private var sbasUsed: Int = 0
    private var rawGpsCount: Int = 0
    private var rawGlonassCount: Int = 0
    private var rawGalileoCount: Int = 0
    private var rawBeidouCount: Int = 0
    private var rawQzssCount: Int = 0
    private var rawSbasCount: Int = 0

    private var nmeaEnabled: Boolean = true

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            synchronized(lock) {
                lastLocation = location
                lastElapsedRealtimeNanos = location.elapsedRealtimeNanos
                provider = location.provider ?: ""
            }
        }
    }

    private val statusCallback = object : GnssStatus.Callback() {
        override fun onSatelliteStatusChanged(status: GnssStatus) {
            synchronized(lock) {
                satellitesVisible = status.satelliteCount
                var usedCount = 0
                var cn0Sum = 0f
                var cn0Samples = 0
                var minCn0: Float? = null
                var maxCn0: Float? = null
                val cn0Values = ArrayList<Float>(status.satelliteCount)
                var gpsVis = 0
                var gpsUse = 0
                var glonassVis = 0
                var glonassUse = 0
                var galileoVis = 0
                var galileoUse = 0
                var beidouVis = 0
                var beidouUse = 0
                var qzssVis = 0
                var qzssUse = 0
                var sbasVis = 0
                var sbasUse = 0
                var l5 = false
                for (i in 0 until status.satelliteCount) {
                    if (status.usedInFix(i)) {
                        usedCount++
                    }
                    val cn0 = status.getCn0DbHz(i)
                    if (!cn0.isNaN()) {
                        cn0Sum += cn0
                        cn0Samples++
                        cn0Values.add(cn0)
                        minCn0 = minCn0?.let { min(it, cn0) } ?: cn0
                        maxCn0 = maxCn0?.let { max(it, cn0) } ?: cn0
                    }
                    when (status.getConstellationType(i)) {
                        GnssStatus.CONSTELLATION_GPS -> {
                            gpsVis++
                            if (status.usedInFix(i)) gpsUse++
                        }
                        GnssStatus.CONSTELLATION_GLONASS -> {
                            glonassVis++
                            if (status.usedInFix(i)) glonassUse++
                        }
                        GnssStatus.CONSTELLATION_GALILEO -> {
                            galileoVis++
                            if (status.usedInFix(i)) galileoUse++
                        }
                        GnssStatus.CONSTELLATION_BEIDOU -> {
                            beidouVis++
                            if (status.usedInFix(i)) beidouUse++
                        }
                        GnssStatus.CONSTELLATION_QZSS -> {
                            qzssVis++
                            if (status.usedInFix(i)) qzssUse++
                        }
                        GnssStatus.CONSTELLATION_SBAS -> {
                            sbasVis++
                            if (status.usedInFix(i)) sbasUse++
                        }
                    }
                    val carrier = status.getCarrierFrequencyHz(i)
                    if (!carrier.isNaN() && abs(carrier - L5_FREQ) < L5_DELTA) {
                        l5 = true
                    }
                }
                satellitesUsed = usedCount
                cn0Average = if (cn0Samples > 0) cn0Sum / cn0Samples else 0f
                hasL5 = l5
                cn0Min = minCn0
                cn0Max = maxCn0
                cn0Percentile25 = percentile(cn0Values, 0.25f)
                cn0Median = percentile(cn0Values, 0.5f)
                cn0Percentile75 = percentile(cn0Values, 0.75f)
                gpsVisible = gpsVis
                gpsUsed = gpsUse
                glonassVisible = glonassVis
                glonassUsed = glonassUse
                galileoVisible = galileoVis
                galileoUsed = galileoUse
                beidouVisible = beidouVis
                beidouUsed = beidouUse
                qzssVisible = qzssVis
                qzssUsed = qzssUse
                sbasVisible = sbasVis
                sbasUsed = sbasUse
            }
        }
    }

    private val nmeaListener = OnNmeaMessageListener { message, _ ->
        parseNmea(message)
    }

    private val measurementsCallback = object : GnssMeasurementsEvent.Callback() {
        override fun onGnssMeasurementsReceived(eventArgs: GnssMeasurementsEvent) {
            synchronized(lock) {
                gnssRawCount = eventArgs.measurements.size
                var gps = 0
                var glonass = 0
                var galileo = 0
                var beidou = 0
                var qzss = 0
                var sbas = 0
                eventArgs.measurements.forEach { measurement ->
                    when (measurement.constellationType) {
                        GnssStatus.CONSTELLATION_GPS -> gps++
                        GnssStatus.CONSTELLATION_GLONASS -> glonass++
                        GnssStatus.CONSTELLATION_GALILEO -> galileo++
                        GnssStatus.CONSTELLATION_BEIDOU -> beidou++
                        GnssStatus.CONSTELLATION_QZSS -> qzss++
                        GnssStatus.CONSTELLATION_SBAS -> sbas++
                    }
                }
                rawGpsCount = gps
                rawGlonassCount = glonass
                rawGalileoCount = galileo
                rawBeidouCount = beidou
                rawQzssCount = qzss
                rawSbasCount = sbas
            }
        }

        override fun onStatusChanged(status: Int) {
            gnssRawSupported = status != STATUS_NOT_SUPPORTED
        }
    }

    @SuppressLint("MissingPermission")
    fun start(enableNmea: Boolean) {
        nmeaEnabled = enableNmea
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
            .setMinUpdateIntervalMillis(900L)
            .setWaitForAccurateLocation(false)
            .build()
        fusedClient.requestLocationUpdates(request, locationCallback, context.mainLooper)
        tryRegisterStatus()
        if (nmeaEnabled) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    locationManager?.addNmeaListener(context.mainExecutor, nmeaListener)
                } else {
                    @Suppress("DEPRECATION")
                    locationManager?.addNmeaListener(nmeaListener)
                }
            } catch (t: Throwable) {
                Timber.w(t, "Failed to register NMEA listener")
            }
        }
        tryRegisterMeasurements()
    }

    fun stop() {
        fusedClient.removeLocationUpdates(locationCallback)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                locationManager?.removeNmeaListener(nmeaListener)
            } else {
                @Suppress("DEPRECATION")
                locationManager?.removeNmeaListener(nmeaListener)
            }
        } catch (_: Throwable) {
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                locationManager?.unregisterGnssStatusCallback(statusCallback)
            } else {
                @Suppress("DEPRECATION")
                locationManager?.unregisterGnssStatusCallback(statusCallback)
            }
        } catch (_: Throwable) {
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                locationManager?.unregisterGnssMeasurementsCallback(measurementsCallback)
            } else {
                @Suppress("DEPRECATION")
                locationManager?.unregisterGnssMeasurementsCallback(measurementsCallback)
            }
        } catch (_: Throwable) {
        }
    }

    fun snapshot(): GnssSnapshot = synchronized(lock) {
        GnssSnapshot(
            location = lastLocation,
            elapsedRealtimeNanos = lastElapsedRealtimeNanos,
            satellitesVisible = satellitesVisible,
            satellitesUsed = satellitesUsed,
            cn0Average = cn0Average,
            cn0Min = cn0Min,
            cn0Max = cn0Max,
            cn0Percentile25 = cn0Percentile25,
            cn0Median = cn0Median,
            cn0Percentile75 = cn0Percentile75,
            hasL5 = hasL5,
            hdop = hdop,
            vdop = vdop,
            pdop = pdop,
            provider = provider,
            gnssRawSupported = gnssRawSupported,
            gnssRawCount = gnssRawCount,
            gpsVisible = gpsVisible,
            gpsUsed = gpsUsed,
            glonassVisible = glonassVisible,
            glonassUsed = glonassUsed,
            galileoVisible = galileoVisible,
            galileoUsed = galileoUsed,
            beidouVisible = beidouVisible,
            beidouUsed = beidouUsed,
            qzssVisible = qzssVisible,
            qzssUsed = qzssUsed,
            sbasVisible = sbasVisible,
            sbasUsed = sbasUsed,
            rawGpsCount = rawGpsCount,
            rawGlonassCount = rawGlonassCount,
            rawGalileoCount = rawGalileoCount,
            rawBeidouCount = rawBeidouCount,
            rawQzssCount = rawQzssCount,
            rawSbasCount = rawSbasCount
        )
    }

    private fun tryRegisterStatus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                locationManager?.registerGnssStatusCallback(context.mainExecutor, statusCallback)
            } else {
                @Suppress("DEPRECATION")
                locationManager?.registerGnssStatusCallback(statusCallback)
            }
        } catch (t: Throwable) {
            Timber.w(t, "Failed to register GNSS status callback")
        }
    }

    private fun tryRegisterMeasurements() {
        try {
            val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                locationManager?.registerGnssMeasurementsCallback(context.mainExecutor, measurementsCallback)
            } else {
                @Suppress("DEPRECATION")
                locationManager?.registerGnssMeasurementsCallback(measurementsCallback)
            }
            gnssRawSupported = ok == true
        } catch (t: Throwable) {
            Timber.w(t, "GNSS measurements not supported")
            gnssRawSupported = false
        }
    }

    private fun parseNmea(message: String) {
        if (!nmeaEnabled) return
        if (message.startsWith("\$GPGSA") || message.startsWith("\$GNGSA") || message.startsWith("\$GLGSA")) {
            val parts = message.split(',')
            if (parts.size >= 15) {
                val pdopValue = parts.getOrNull(parts.size - 3)?.toFloatOrNull()
                val hdopValue = parts.getOrNull(parts.size - 2)?.toFloatOrNull()
                val vdopValue = parts.getOrNull(parts.size - 1)?.substringBefore('*')?.toFloatOrNull()
                synchronized(lock) {
                    if (pdopValue != null) pdop = pdopValue
                    if (hdopValue != null) hdop = hdopValue
                    if (vdopValue != null) vdop = vdopValue
                }
            }
        }
    }

    companion object {
        private const val STATUS_NOT_SUPPORTED = GnssMeasurementsEvent.Callback.STATUS_NOT_SUPPORTED
        private const val L5_FREQ = 1_176_450_000f // Hz
        private const val L5_DELTA = 20_000f

        private fun percentile(values: List<Float>, percentile: Float): Float? {
            if (values.isEmpty()) return null
            val sorted = values.sorted()
            val rank = (percentile * (sorted.size - 1)).coerceIn(0f, (sorted.size - 1).toFloat())
            val lowerIndex = rank.toInt()
            val upperIndex = minOf(sorted.size - 1, lowerIndex + 1)
            val fraction = rank - lowerIndex
            return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction
        }
    }
}
