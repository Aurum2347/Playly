package com.playly.player.playback.audio

import kotlin.math.abs
import kotlin.math.exp

/**
 * The 15 equaliser filters in series on every channel, after the pre-gain. New gains glide
 * there over ~40 ms (like the desktop setTargetAtTime), so a preset change never clicks.
 * Single-threaded: only the audio thread calls it.
 */
class EqualizerDsp {
    private val count = Equalizer.BANDS.size
    private var sampleRate = 44_100.0
    private var channels = 2
    private val target = DoubleArray(count)
    private val current = DoubleArray(count)
    private var targetPre = 1.0
    private var currentPre = 1.0
    private val coef = Array(count) { Biquad.IDENTITY }
    private var z1 = Array(count) { DoubleArray(channels) }
    private var z2 = Array(count) { DoubleArray(channels) }
    private var glide = 0.0

    /** Nothing to do now and nothing changing: the chain may skip the equaliser. */
    val isNeutral: Boolean
        get() = currentPre == 1.0 && targetPre == 1.0 && (0 until count).all { current[it] == 0.0 && target[it] == 0.0 }

    fun configure(sampleRate: Int, channels: Int) {
        this.sampleRate = sampleRate.toDouble()
        this.channels = channels
        z1 = Array(count) { DoubleArray(channels) }
        z2 = Array(count) { DoubleArray(channels) }
        glide = 1 - exp(-BLOCK / (this.sampleRate * GLIDE_SECONDS))
        snap()
    }

    /** Band gains in dB; null = equaliser off (all bands glide to 0 dB). */
    fun setGains(gains: List<Float>?) {
        val values = gains?.let(Equalizer::normalizeGains) ?: Equalizer.FLAT_GAINS
        for (i in 0 until count) target[i] = values[i].toDouble()
        targetPre = if (gains == null) 1.0 else Equalizer.preGain(values)
    }

    /** Jumps to the target (start of a stream) and clears the filter memory. */
    fun snap() {
        target.copyInto(current)
        currentPre = targetPre
        for (i in 0 until count) {
            design(i)
            z1[i].fill(0.0)
            z2[i].fill(0.0)
        }
    }

    /** Filters [frames] interleaved frames of [buf] in place. */
    fun process(buf: FloatArray, frames: Int) {
        var start = 0
        while (start < frames) {
            val end = minOf(frames, start + BLOCK)
            step()
            processBlock(buf, start, end)
            start = end
        }
    }

    private fun step() {
        for (i in 0 until count) {
            if (current[i] == target[i]) continue
            val next = current[i] + (target[i] - current[i]) * glide
            current[i] = if (abs(target[i] - next) < 0.01) target[i] else next
            design(i)
        }
        if (currentPre != targetPre) {
            val next = currentPre + (targetPre - currentPre) * glide
            currentPre = if (abs(targetPre - next) < 1e-4) targetPre else next
        }
    }

    private fun design(i: Int) {
        val c = Biquad.design(Biquad.typeOf(i), Equalizer.BANDS[i].toDouble(), current[i], Equalizer.Q, sampleRate)
        if (c === Biquad.IDENTITY && coef[i] !== Biquad.IDENTITY) {
            z1[i].fill(0.0)
            z2[i].fill(0.0)
        }
        coef[i] = c
    }

    private fun processBlock(buf: FloatArray, start: Int, end: Int) {
        val ch = channels
        val pre = currentPre
        if (pre != 1.0) {
            val p = pre.toFloat()
            for (k in start * ch until end * ch) buf[k] *= p
        }
        for (i in 0 until count) {
            val c = coef[i]
            if (c === Biquad.IDENTITY) continue
            val s1 = z1[i]
            val s2 = z2[i]
            for (channel in 0 until ch) {
                var w1 = s1[channel]
                var w2 = s2[channel]
                var k = start * ch + channel
                val stop = end * ch
                while (k < stop) {
                    val x = buf[k].toDouble()
                    val y = c.b0 * x + w1
                    w1 = c.b1 * x - c.a1 * y + w2
                    w2 = c.b2 * x - c.a2 * y
                    buf[k] = y.toFloat()
                    k += ch
                }
                // Decaying memory in silence would turn into slow denormals.
                s1[channel] = if (abs(w1) < TINY) 0.0 else w1
                s2[channel] = if (abs(w2) < TINY) 0.0 else w2
            }
        }
    }

    private companion object {
        const val BLOCK = 64
        const val GLIDE_SECONDS = 0.04
        const val TINY = 1e-25
    }
}
