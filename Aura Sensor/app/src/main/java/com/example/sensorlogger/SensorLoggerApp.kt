package com.example.sensorlogger

import android.app.Application
import com.example.sensorlogger.util.FileLoggingTree
import com.example.sensorlogger.work.OperatorSyncWorker
import timber.log.Timber

class SensorLoggerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Timber.plant(FileLoggingTree(this))
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
        OperatorSyncWorker.schedulePeriodic(this)
    }
}
