package com.example.sensorlogger.util

import android.os.SystemClock
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object Time {
    private val utcFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS")
            .withLocale(Locale.US)
            .withZone(ZoneId.of("UTC"))

    private val dateIdFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyyMMdd")
            .withLocale(Locale.US)
            .withZone(ZoneId.of("UTC"))

    fun nowUtcMillis(): Long = Instant.now().toEpochMilli()

    fun elapsedRealtimeNanos(): Long = SystemClock.elapsedRealtimeNanos()

    fun formatUtc(timestampMillis: Long): String = utcFormatter.format(Instant.ofEpochMilli(timestampMillis))

    fun currentDateId(): String = dateIdFormatter.format(Instant.ofEpochMilli(nowUtcMillis()))

    fun dateIdFrom(millis: Long): String = dateIdFormatter.format(Instant.ofEpochMilli(millis))
}
