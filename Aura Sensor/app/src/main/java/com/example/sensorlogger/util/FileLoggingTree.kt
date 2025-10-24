package com.example.sensorlogger.util

import android.content.Context
import timber.log.Timber
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FileLoggingTree(context: Context) : Timber.DebugTree() {

    private val logFile: File = File(context.getExternalFilesDir(null), "telemetry/$LOG_NAME").apply {
        parentFile?.mkdirs()
    }
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        super.log(priority, tag, message, t)
        val line = buildString {
            append(dateFormat.format(Date()))
            append(' ')
            append(tag ?: "AuraSensor")
            append(' ')
            append(message)
            if (t != null) {
                append(" | ").append(t.stackTraceToString())
            }
        }
        runCatching {
            FileWriter(logFile, true).use { writer ->
                writer.appendLine(line)
            }
        }
    }

    companion object {
        private const val LOG_NAME = "aurasensor.log"
    }
}
