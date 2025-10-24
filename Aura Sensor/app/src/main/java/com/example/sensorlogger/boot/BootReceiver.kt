package com.example.sensorlogger.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.example.sensorlogger.service.TelemetryService
import com.example.sensorlogger.util.OperatorStore
import timber.log.Timber

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val store = OperatorStore(context)
        if (store.autoStart && store.operatorId.isNotBlank() && store.equipmentTag.isNotBlank()) {
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
}
