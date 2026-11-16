package com.playly.player

import com.playly.player.playback.audio.Compressor
import com.playly.player.playback.audio.Equalizer
import com.playly.player.playback.audio.SoftLimiter
import com.playly.player.playback.audio.SoundChain
import com.playly.player.playback.audio.SoundParams
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.3: the sound chain on plain float buffers (mono, equaliser, normaliser, limiter). */
class SoundChainTest {
    private val rate = 48_000

    private fun sine(freq: Double, amp: Double, seconds: Double, channels: Int = 2): FloatArray {
        val frames = (rate * seconds).toInt()
        return FloatArray(frames * channels) { k -> (amp * sin(2 * PI * freq * (k / channels) / rate)).toFloat() }
    }

    /** Runs [input] through [chain] in 1024-frame buffers, like the audio sink does. */
    private fun run(chain: SoundChain, params: SoundParams, input: FloatArray, channels: Int = 2): FloatArray {
        val out = input.copyOf()
        var frame = 0
        val frames = input.size / channels
        while (frame < frames) {
            val n = minOf(1024, frames - frame)
            val buf = out.copyOfRange(frame * channels, (frame + n) * channels)
            if (!chain.prepare(params)) chain.process(buf, n)
            buf.copyInto(out, frame * channels)
            frame += n
        }
        return out
    }

    private fun rmsDb(buf: FloatArray, from: Int): Double {
        var sum = 0.0
        for (i in from until buf.size) sum += buf[i].toDouble() * buf[i]
        return 10 * log10(sum / (buf.size - from))
    }

    private fun chain(params: SoundParams) = SoundChain().apply { configure(rate, 2, params) }

    @Test
    fun flatEqualiserAndEverythingOffLeaveTheSoundUntouched() {
        val input = sine(440.0, 0.8, 0.2)
        for (params in listOf(SoundParams.OFF, SoundParams(eqGains = Equalizer.FLAT_GAINS))) {
            val chain = chain(params)
            assertTrue(chain.prepare(params))
            assertArrayEquals(input, run(chain, params, input), 0f)
        }
    }

    @Test
    fun bandBoostMatchesItsGainMinusThePreGain() {
        val gains = Equalizer.FLAT_GAINS.toMutableList().also { it[8] = 6f } // 1 kHz
        val params = SoundParams(eqGains = gains)
        val input = sine(1000.0, 0.1, 1.0)
        val out = run(chain(params), params, input)
        val skip = rate / 5 * 2
        // +6 dB band, -4.5 dB pre-gain (0.75 of the largest boost).
        assertEquals(1.5, rmsDb(out, skip) - rmsDb(input, skip), 0.05)
        // A tone far from the band only gets the pre-gain.
        val low = sine(100.0, 0.1, 1.0)
        assertEquals(-4.5, rmsDb(run(chain(params), params, low), skip) - rmsDb(low, skip), 0.1)
    }

    @Test
    fun monoSendsTheAverageToBothEars() {
        val params = SoundParams(mono = true)
        val chain = chain(params)
        assertFalse(chain.prepare(params))
        val buf = floatArrayOf(0.5f, -0.1f, 1f, 1f, -0.3f, 0.3f)
        chain.process(buf, 3)
        assertArrayEquals(floatArrayOf(0.2f, 0.2f, 1f, 1f, 0f, 0f), buf, 1e-6f)
        // A mono stream has nothing to mix.
        val single = SoundChain().apply { configure(rate, 1, params) }
        assertTrue(single.prepare(params))
    }

    @Test
    fun compressorCurveAndMakeUp() {
        assertEquals(0.0, Compressor.gainReductionDb(-40.0), 1e-9)
        assertEquals(0.0, Compressor.gainReductionDb(-30.0), 1e-9)
        assertEquals(-12.0, Compressor.gainReductionDb(0.0), 1e-9)
        assertEquals(7.2, Compressor.MAKEUP_DB, 1e-9)
        // The knee joins both straight parts smoothly.
        assertEquals(-6.0, Compressor.gainReductionDb(-10.0), 1e-9)
        assertEquals(-1.5, Compressor.gainReductionDb(-20.0), 1e-9)
    }

    @Test
    fun normaliserLiftsQuietAndTamesLoudTracks() {
        val params = SoundParams(normalize = true)
        val skip = rate / 2 * 2
        val quiet = sine(440.0, 0.01, 1.5)
        assertEquals(7.2, rmsDb(run(chain(params), params, quiet), skip) - rmsDb(quiet, skip), 0.2)
        val loud = sine(440.0, 1.0, 1.5)
        val gain = rmsDb(run(chain(params), params, loud), skip) - rmsDb(loud, skip)
        assertTrue("loud gain $gain", gain < -3)
    }
}
