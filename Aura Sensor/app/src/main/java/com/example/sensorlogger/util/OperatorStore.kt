package com.example.sensorlogger.util

import android.content.Context

class OperatorStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    var operatorId: String
        get() = prefs.getString(KEY_OPERATOR_ID, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_OPERATOR_ID, value).apply()
        }

    var operatorName: String
        get() = prefs.getString(KEY_NAME, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_NAME, value).apply()
        }

    var equipmentTag: String
        get() = prefs.getString(KEY_EQUIPMENT_TAG, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_EQUIPMENT_TAG, value).apply()
        }

    var autoStart: Boolean
        get() = prefs.getBoolean(KEY_AUTO_START, false)
        set(value) {
            prefs.edit().putBoolean(KEY_AUTO_START, value).apply()
        }

    var nmeaEnabled: Boolean
        get() = prefs.getBoolean(KEY_NMEA_ENABLED, true)
        set(value) {
            prefs.edit().putBoolean(KEY_NMEA_ENABLED, value).apply()
        }

    companion object {
        private const val PREF_NAME = "sensorlogger_operator"
        private const val KEY_OPERATOR_ID = "operator_code"
        private const val KEY_NAME = "operator_name"
        private const val KEY_EQUIPMENT_TAG = "equipment_tag"
        private const val KEY_AUTO_START = "auto_start"
        private const val KEY_NMEA_ENABLED = "nmea_enabled"
    }
}
