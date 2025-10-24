package com.example.sensorlogger.sensors

import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Test

class StatsAccumulatorTest {

    @Test
    fun `sigma zero when insufficient samples`() {
        val stats = StatsAccumulator()
        stats.add(1f)
        assertEquals(1f, stats.rms()!!)
        assertEquals(1f, stats.mean()!!)
        assertEquals(1f, stats.min()!!)
        assertEquals(1f, stats.max()!!)
        assertEquals(1, stats.count())
        assertEquals(0f, stats.sigma())
    }

    @Test
    fun `rms and sigma computed for symmetric data`() {
        val stats = StatsAccumulator()
        listOf(-2f, -1f, 1f, 2f).forEach(stats::add)
        assertEquals(0f, stats.mean()!!, 1e-6f)
        assertEquals(sqrt(2.5f.toDouble()).toFloat(), stats.rms()!!, 1e-6f)
        assertEquals(sqrt(1.6666666f.toDouble()).toFloat(), stats.sigma()!!, 1e-6f)
    }

    @Test
    fun `ignores NaN and infinite`() {
        val stats = StatsAccumulator()
        stats.add(Float.NaN)
        stats.add(Float.POSITIVE_INFINITY)
        stats.add(3f)
        assertEquals(3f, stats.mean()!!)
        assertEquals(3f, stats.rms()!!)
        assertEquals(0f, stats.sigma())
    }
}
