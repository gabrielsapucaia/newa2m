package com.example.sensorlogger.storage

import android.content.Context
import com.example.sensorlogger.model.TelemetryPayloadV11
import com.example.sensorlogger.util.Time
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber

class OfflineQueue(context: Context) {

    private val json = Json { encodeDefaults = true }
    private val telemetryDir: File = File(context.getExternalFilesDir(null), DIRECTORY).apply {
        if (!exists()) {
            mkdirs()
        }
    }

    private val mutex = Mutex()
    private val queueSize = AtomicInteger(0)

    suspend fun initialize() {
        mutex.withLock {
            withContext(Dispatchers.IO) {
                if (!telemetryDir.exists()) {
                    telemetryDir.mkdirs()
                }
                queueSize.set(countAllLines())
                purgeExpiredLocked()
            }
        }
    }

    suspend fun enqueue(payload: TelemetryPayloadV11, pendingTargets: Set<String>, error: String): Boolean {
        if (pendingTargets.isEmpty()) return false
        var stored = false
        mutex.withLock {
            stored = withContext(Dispatchers.IO) {
                purgeExpiredLocked()
                val dayId = Time.currentDateId()
                val file = partitionFile(dayId)
                if (file.length() >= MAX_BYTES_PER_DAY) {
                    Timber.w("Offline queue skipped write for %s: daily limit reached", dayId)
                    return@withContext false
                }
                val message = QueuedMessage(
                    createdAtUtc = Time.nowUtcMillis(),
                    sequence = payload.sequenceId,
                    payload = payload,
                    targets = pendingTargets.toList(),
                    attempts = 0,
                    lastError = error
                )
                file.parentFile?.mkdirs()
                BufferedWriter(FileWriter(file, true)).use { writer ->
                    writer.append(json.encodeToString(message))
                    writer.append('\n')
                }
                queueSize.incrementAndGet()
                true
            }
        }
        return stored
    }

    suspend fun clear() {
        mutex.withLock {
            withContext(Dispatchers.IO) {
                telemetryDir.listFiles { file -> file.name.startsWith(PENDING_PREFIX) && file.name.endsWith(SUFFIX) }
                    ?.forEach { it.delete() }
            }
            queueSize.set(0)
        }
    }

    suspend fun drainOnce(
        batchSize: Int,
        publish: suspend (QueuedMessage) -> Map<String, Boolean>
    ): DrainOutcome {
        return mutex.withLock {
            withContext(Dispatchers.IO) {
                purgeExpiredLocked()
            }
            if (queueSize.get() == 0) {
                return@withLock DrainOutcome(processed = 0, remaining = queueSize.get())
            }
            var remainingBudget = batchSize
            var processedTotal = 0
            val files = queueFilesSorted()
            for (file in files) {
                if (remainingBudget <= 0) break
                val processed = processFileLocked(file, remainingBudget, publish)
                processedTotal += processed
                remainingBudget -= processed
            }
            DrainOutcome(processed = processedTotal, remaining = queueSize.get())
        }
    }

    fun size(): Int = queueSize.get()

    private fun queueFilesSorted(): List<File> =
        telemetryDir.listFiles { file -> file.name.startsWith(PENDING_PREFIX) && file.name.endsWith(SUFFIX) }
            ?.sortedBy { it.name }
            ?: emptyList()

    private suspend fun processFileLocked(
        file: File,
        budget: Int,
        publish: suspend (QueuedMessage) -> Map<String, Boolean>
    ): Int {
        if (budget <= 0) return 0
        var processed = 0
        val tempFile = File(file.parentFile, "${file.name}.tmp")

        withContext(Dispatchers.IO) {
            BufferedWriter(FileWriter(tempFile, false)).use { writer ->
                file.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        if (line.isBlank()) return@forEach
                        val message = runCatching { json.decodeFromString<QueuedMessage>(line) }.getOrElse {
                            Timber.w(it, "Failed to decode offline queue line")
                            decrementQueue()
                            return@forEach
                        }
                        if (processed < budget) {
                            processed += 1
                            val results = publish(message)
                            val remaining = message.targets.filter { results[it] != true }.toSet()
                            if (remaining.isEmpty()) {
                                decrementQueue()
                            } else {
                                val updated = message.copy(
                                    targets = remaining.toList(),
                                    attempts = message.attempts + 1,
                                    lastError = "retry_failed"
                                )
                                writer.append(json.encodeToString(updated))
                                writer.append('\n')
                            }
                        } else {
                            writer.append(line)
                            writer.append('\n')
                        }
                    }
                }
            }
        }

        withContext(Dispatchers.IO) {
            if (!tempFile.exists() || tempFile.length() == 0L) {
                tempFile.delete()
                file.delete()
            } else {
                if (!file.delete()) {
                    Timber.w("Failed to delete original queue file %s", file.name)
                }
                if (!tempFile.renameTo(file)) {
                    Timber.w("Failed to replace queue file %s", file.name)
                }
            }
            Unit
        }

        return min(processed, budget)
    }

    private fun partitionFile(dayId: String): File =
        File(telemetryDir, "$PENDING_PREFIX$dayId$SUFFIX")

    private fun countAllLines(): Int =
        telemetryDir.listFiles { file -> file.name.startsWith(PENDING_PREFIX) && file.name.endsWith(SUFFIX) }
            ?.sumOf { file ->
                file.takeIf { it.isFile }?.bufferedReader()?.use { reader ->
                    reader.lineSequence().count { it.isNotBlank() }
                } ?: 0
            } ?: 0

    private fun purgeExpiredLocked() {
        val cutoff = LocalDate.now(ZoneOffset.UTC).minusDays(RETENTION_DAYS.toLong())
        val formatter = DateTimeFormatter.BASIC_ISO_DATE
        telemetryDir.listFiles { file -> file.name.startsWith(PENDING_PREFIX) && file.name.endsWith(SUFFIX) }
            ?.forEach { file ->
                val dayId = file.name.removePrefix(PENDING_PREFIX).removeSuffix(SUFFIX)
                val fileDate = runCatching { LocalDate.parse(dayId, formatter) }.getOrNull() ?: return@forEach
                if (fileDate.isBefore(cutoff)) {
                    val removed = file.bufferedReader().use { reader ->
                        reader.lineSequence().count { it.isNotBlank() }
                    }
                    if (file.delete()) {
                        queueSize.updateAndGet { current -> max(0, current - removed) }
                    }
                }
            }
    }

    private fun decrementQueue(count: Int = 1) {
        if (count <= 0) return
        queueSize.updateAndGet { current -> max(0, current - count) }
    }

    @Serializable
    data class QueuedMessage(
        val createdAtUtc: Long,
        val sequence: Long,
        val payload: TelemetryPayloadV11,
        val targets: List<String>,
        val attempts: Int,
        val lastError: String?
    )

    companion object {
        private const val DIRECTORY = "telemetry"
        private const val PENDING_PREFIX = "pending_"
        private const val SUFFIX = ".jsonl"
        private const val MAX_BYTES_PER_DAY = 100L * 1024 * 1024
        private const val RETENTION_DAYS = 7
    }

    data class DrainOutcome(val processed: Int, val remaining: Int)
}
