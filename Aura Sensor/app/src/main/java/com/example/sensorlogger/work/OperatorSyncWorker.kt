package com.example.sensorlogger.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.example.sensorlogger.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import timber.log.Timber
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.util.concurrent.TimeUnit

class OperatorSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val lastUpdatedAt = prefs.getString(KEY_UPDATED_AT, null)
        val cachedEtag = prefs.getString(KEY_ETAG, null)
        val urlString = buildUrl(lastUpdatedAt)

        val connection = openConnection(urlString, cachedEtag)
        try {
            val code = connection.responseCode
            when (code) {
                HttpURLConnection.HTTP_NOT_MODIFIED -> {
                    Timber.v("Operator sync returned 304 Not Modified")
                    Result.success()
                }

                HttpURLConnection.HTTP_OK -> {
                    val responseBody = connection.inputStream.bufferedReader().use { it.readText() }
                    val newEtag = connection.getHeaderField("ETag") ?: cachedEtag
                    val updatedAt = extractUpdatedAt(responseBody) ?: Instant.now().toString()
                    prefs.edit()
                        .putString(KEY_LAST_RESPONSE, responseBody)
                        .putString(KEY_UPDATED_AT, updatedAt)
                        .putString(KEY_ETAG, newEtag)
                        .apply()
                    Timber.v("Operator sync success | updated_at=%s etag=%s", updatedAt, newEtag)
                    Result.success()
                }

                else -> {
                    Timber.v("Operator sync ignored response code=%d", code)
                    Result.success()
                }
            }
        } catch (t: Throwable) {
            Timber.v(t, "Operator sync failed")
            Result.success()
        } finally {
            connection.disconnect()
        }
    }

    private fun buildUrl(lastUpdatedAt: String?): String {
        if (lastUpdatedAt.isNullOrBlank()) {
            return BuildConfig.OPERATORS_ENDPOINT
        }
        val encoded = URLEncoder.encode(lastUpdatedAt, "UTF-8")
        val separator = if (BuildConfig.OPERATORS_ENDPOINT.contains("?")) "&" else "?"
        return "${BuildConfig.OPERATORS_ENDPOINT}$separator" + "since=$encoded"
    }

    private fun openConnection(urlString: String, etag: String?): HttpURLConnection {
        val connection = URL(urlString).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        connection.setRequestProperty("Accept", "application/json")
        if (!etag.isNullOrBlank()) {
            connection.setRequestProperty("If-None-Match", etag)
        }
        return connection
    }

    private fun extractUpdatedAt(payload: String?): String? {
        if (payload.isNullOrBlank()) return null
        return runCatching {
            val root = JSONObject(payload)
            root.optString("updated_at").takeIf { it.isNotBlank() }
        }.getOrNull()
    }

    companion object {
        private const val PREF_NAME = "operator_sync_cache"
        private const val KEY_UPDATED_AT = "updated_at"
        private const val KEY_ETAG = "etag"
        private const val KEY_LAST_RESPONSE = "body"

        private const val UNIQUE_PERIODIC = "operator_sync_periodic"
        private const val UNIQUE_IMMEDIATE = "operator_sync_now"

        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<OperatorSyncWorker>(1, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun enqueueImmediate(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<OperatorSyncWorker>()
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                UNIQUE_IMMEDIATE,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }
    }
}
