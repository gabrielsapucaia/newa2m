package com.example.sensorlogger.util

import android.content.Context
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class IdProvider(private val context: Context) {

    private val prefs by lazy {
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    val deviceId: String
        get() = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)

    suspend fun nextSequence(): Long = withContext(Dispatchers.IO) {
        val next = prefs.getLong(KEY_SEQ, 0L) + 1
        prefs.edit().putLong(KEY_SEQ, next).apply()
        next
    }

    fun peekSequence(): Long = prefs.getLong(KEY_SEQ, 0L)

    suspend fun setSequence(value: Long) = withContext(Dispatchers.IO) {
        prefs.edit().putLong(KEY_SEQ, value).apply()
    }

    companion object {
        private const val PREF_NAME = "sensorlogger_identity"
        private const val KEY_SEQ = "sequence"
    }
}
