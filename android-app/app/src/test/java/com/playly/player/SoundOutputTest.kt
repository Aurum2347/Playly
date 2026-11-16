package com.playly.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import com.playly.player.playback.audio.Equalizer
import com.playly.player.playback.audio.PlaylyAudioProcessor
import com.playly.player.playback.audio.SoftLimiter
import com.playly.player.playback.audio.SoundChain
import com.playly.player.playback.audio.SoundParams
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.3: output stays within ±1, effects switch off cleanly, the Media3 processor. */
class SoundOutputTest {
    private val rate = 44_100

    @Test
    fun loudestSettingsNeverLeaveFullScale() {
        val params = SoundParams(eqGains = List(15) { 12f }, mono = true, normalize = true)
        val chain = SoundChain().apply { configure(rate, 2, params) }
        var peak = 0f
        for (freq in listOf(30.0, 1000.0, 12_000.0)) {
            val buf = FloatArray(rate * 2) { k -> if ((k / 2 * freq / rate).toInt() % 2 == 0) 1f else -1f }
            assertFalse(chain.prepare(params))
            chain.process(buf, rate)
            peak = maxOf(peak, buf.maxOf { abs(it) })
        }
        assertTrue("peak $peak", peak <= 1f)
        assertEquals(0.5f, SoftLimiter.limit(0.5f))
        assertTrue(SoftLimiter.limit(40f) <= 1f && SoftLimiter.limit(-40f) >= -1f)
        assertEquals(0f, SoftLimiter.limit(Float.NaN))
    }

    @Test
    fun switchingEffectsOffFadesBackToTheUntouchedSignal() {
        val on = SoundParams(eqGains = Equalizer.preset("rock")!!.gains, normalize = true)
        val chain = SoundChain().apply { configure(rate, 2, on) }
        val buf = FloatArray(4096) { k -> (0.3 * sin(2 * PI * 440 * (k / 2) / rate)).toFloat() }
        assertFalse(chain.prepare(on))
        chain.process(buf.copyOf(), 2048)
        val off = SoundParams.OFF
        // Equaliser glide (~40 ms) and the 120 ms normaliser crossfade, then a clean bypass.
        var frames = 0
        while (!chain.prepare(off)) {
            chain.process(buf.copyOf(), 2048)
            frames += 2048
            assertTrue("still processing after $frames frames", frames < rate)
        }
        assertTrue(frames >= rate * 0.12 - 2048)
    }

    private fun pcm16(vararg samples: Int): ByteBuffer {
        val b = ByteBuffer.allocateDirect(samples.size * 2).order(ByteOrder.nativeOrder())
        samples.forEach { b.putShort(it.toShort()) }
        b.flip()
        return b
    }

    private fun PlaylyAudioProcessor.feed(input: ByteBuffer): ShortArray {
        queueInput(input)
        val out = output.asShortBuffer()
        return ShortArray(out.remaining()).also { out.get(it) }
    }

    @Test
    fun processorCopiesPcm16AsIsAndMixesMonoWhenAsked() {
        val processor = PlaylyAudioProcessor()
        val format = AudioProcessor.AudioFormat(rate, 2, C.ENCODING_PCM_16BIT)
        assertEquals(format, processor.configure(format))
        processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
        assertTrue(processor.isActive)
        assertArrayEquals(shortArrayOf(1000, -2000, 32767, -32768), processor.feed(pcm16(1000, -2000, 32767, -32768)))
        processor.params = SoundParams(mono = true)
        assertArrayEquals(shortArrayOf(-500, -500, 0, 0), processor.feed(pcm16(1000, -2000, 32767, -32767)))
    }

    @Test
    fun processorRefusesOtherEncodings() {
        val processor = PlaylyAudioProcessor()
        assertThrows(AudioProcessor.UnhandledAudioFormatException::class.java) {
            processor.configure(AudioProcessor.AudioFormat(rate, 2, C.ENCODING_PCM_24BIT))
        }
        val float = AudioProcessor.AudioFormat(rate, 1, C.ENCODING_PCM_FLOAT)
        assertEquals(float, processor.configure(float))
    }
}
