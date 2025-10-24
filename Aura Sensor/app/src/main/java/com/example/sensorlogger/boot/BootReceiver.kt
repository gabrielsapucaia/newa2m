package com.example.sensorlogger.boot

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.example.sensorlogger.service.TelemetryService
import com.example.sensorlogger.util.OperatorStore
import timber.log.Timber

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val store = OperatorStore(context)
        if (!store.autoStart || store.operatorId.isBlank() || store.equipmentTag.isBlank()) {
            return
        }
        val hasLocationPermission =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
        if (!hasLocationPermission) {
            Timber.w("Boot completed but location permission is missing; skipping TelemetryService auto-start")
            return
        }
        Timber.i("Boot completed, restarting TelemetryService")
        val serviceIntent = TelemetryService.startIntent(
            context = context,
            operatorId = store.operatorId,
            operatorName = store.operatorName,
            equipmentTag = store.equipmentTag,
            nmeaEnabled = store.nmeaEnabled
        )
        context.startForegroundService(serviceIntent)
    }
}
