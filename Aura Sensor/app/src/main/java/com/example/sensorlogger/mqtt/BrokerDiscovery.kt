package com.example.sensorlogger.mqtt

import java.net.InetSocketAddress
import java.net.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object BrokerDiscovery {

    suspend fun scan(
        prefix: String,
        rangeSpec: String,
        port: Int,
        timeoutMs: Int,
        maxResults: Int = 3
    ): List<String> = withContext(Dispatchers.IO) {
        val hosts = parseRange(rangeSpec)
        if (hosts.isEmpty()) return@withContext emptyList<String>()

        val detected = mutableListOf<String>()
        for (host in hosts) {
            val address = "$prefix.$host"
            if (probe(address, port, timeoutMs)) {
                detected += address
                if (detected.size >= maxResults) break
            }
        }
        detected
    }

    private fun parseRange(rangeSpec: String): List<Int> {
        val tokens = rangeSpec
            .split(',', ';', ' ')
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (tokens.isEmpty()) {
            return (1..254).toList()
        }

        val values = mutableListOf<Int>()
        for (token in tokens) {
            val rangeParts = token.split('-').map { it.trim() }.filter { it.isNotEmpty() }
            when (rangeParts.size) {
                1 -> {
                    val value = rangeParts[0].toIntOrNull()
                    if (value != null && value in 0..255) {
                        values += value
                    }
                }
                2 -> {
                    val start = rangeParts[0].toIntOrNull()
                    val end = rangeParts[1].toIntOrNull()
                    if (start != null && end != null) {
                        val progression = if (start <= end) start..end else end..start
                        progression.forEach { candidate ->
                            if (candidate in 0..255) {
                                values += candidate
                            }
                        }
                    }
                }
            }
        }
        return values.distinct().sorted()
    }

    private fun probe(address: String, port: Int, timeoutMs: Int): Boolean =
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(address, port), timeoutMs)
            }
            true
        } catch (_: Exception) {
            false
        }
}
