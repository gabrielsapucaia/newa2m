package com.example.sensorlogger.storage

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File
import java.io.FileWriter

class CsvWriter(context: Context, private val header: String) {

    private val telemetryDir: File = File(context.getExternalFilesDir(null), TELEMETRY_DIR).apply {
        if (!exists()) {
            mkdirs()
        }
    }

    private val csvFile: File = File(telemetryDir, CSV_NAME)
    private val mutex = Mutex()

    suspend fun append(line: String) {
        mutex.withLock {
            withContext(Dispatchers.IO) {
                ensureHeader()
                FileWriter(csvFile, true).use { writer ->
                    writer.append(line)
                    writer.append('\n')
                }
            }
        }
    }

    fun directory(): File = telemetryDir

    private fun ensureHeader() {
        if (!csvFile.exists() || csvFile.length() == 0L) {
            try {
                FileWriter(csvFile, false).use { writer ->
                    writer.append(header)
                    writer.append('\n')
                }
            } catch (t: Throwable) {
                Timber.e(t, "Failed to write CSV header")
            }
        }
    }

    companion object {
        private const val TELEMETRY_DIR = "telemetry"
        private const val CSV_NAME = "telemetry.csv"
    }
}
