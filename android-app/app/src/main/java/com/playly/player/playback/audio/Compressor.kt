package com.playly.player.playback.audio

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.tanh

/**
 * Volume normalisation as on the desktop: a gentle compressor (threshold -20 dB, knee 20 dB,
 * ratio 2.5, attack 10 ms, release 300 ms) with automatic make-up gain, so quiet and loud
 * tracks end up closer. The channels share one gain, so the stereo image stays put. Turning it
 * on or off crossfades dry and compressed sound over 120 ms. Single-threaded.
 */
class Compressor {
    private var enabled = false
    private var mix = 0.0
    private var mixStep = 1.0
    private var channels = 2
    private var attack = 0.0
    private var release = 0.0
    private var envelope = 0.0
    private var reductionDb = 0.0

    /** Off and fully faded out: the chain may skip it. */
    val isIdle: Boolean get() = !enabled && mix == 0.0

    fun configure(sampleRate: Int, channels: Int) {
        this.channels = channels
        val rate = sampleRate.toDouble()
        attack = exp(-1 / (ATTACK_S * rate))
        release = exp(-1 / (RELEASE_S * rate))
        mixStep = 1 / (FADE_S * rate)
        snap()
    }

    fun setEnabled(on: Boolean) {
        enabled = on
    }

    /** Start of a stream: no fade, no leftover gain from the previous track position. */
    fun snap() {
        mix = if (enabled) 1.0 else 0.0
        envelope = 0.0
        reductionDb = 0.0
    }

    fun process(buf: FloatArray, frames: Int) {
        val ch = channels
        val target = if (enabled) 1.0 else 0.0
        var k = 0
        for (frame in 0 until frames) {
            var level = 0.0
            for (c in 0 until ch) level = maxOf(level, abs(buf[k + c].toDouble()))
            // Peak follower: rises at once, falls with the release time.
            envelope = if (level > envelope) level else envelope * release + level * (1 - release)
            val wanted = gainReductionDb(20 * log10(maxOf(envelope, 1e-9)))
            val coef = if (wanted < reductionDb) attack else release
            reductionDb = wanted + (reductionDb - wanted) * coef
            if (mix != target) mix = if (mix < target) minOf(target, mix + mixStep) else maxOf(target, mix - mixStep)
            val wet = 10.0.pow((reductionDb + MAKEUP_DB) / 20)
            val gain = (1 - mix + mix * wet).toFloat()
            for (c in 0 until ch) buf[k + c] *= gain
            k += ch
        }
        if (isIdle) snap()
    }

    companion object {
        const val THRESHOLD_DB = -20.0
        const val KNEE_DB = 20.0
        const val RATIO = 2.5
        const val ATTACK_S = 0.01
        const val RELEASE_S = 0.3
        const val FADE_S = 0.12

        /** Static curve with a soft knee: how many dB (≤ 0) a steady level is turned down. */
        fun gainReductionDb(levelDb: Double): Double {
            val over = levelDb - THRESHOLD_DB
            val slope = 1 / RATIO - 1
            return when {
                2 * over < -KNEE_DB -> 0.0
                2 * abs(over) <= KNEE_DB -> slope * (over + KNEE_DB / 2).pow(2) / (2 * KNEE_DB)
                else -> slope * over
            }
        }

        /** Make-up ≈ 0.6 × the reduction of a full-scale signal (Web Audio's rule): +7.2 dB. */
        val MAKEUP_DB: Double = -0.6 * gainReductionDb(0.0)
    }
}

/** Last stage: leaves everything below 0.9 alone and bends louder peaks smoothly under 1.0. */
object SoftLimiter {
    private const val KNEE = 0.9f

    fun limit(x: Float): Float {
        val a = abs(x)
        if (a <= KNEE || a.isNaN()) return if (a.isNaN()) 0f else x
        val bent = KNEE + (1 - KNEE) * tanh((a - KNEE) / (1 - KNEE))
        return if (x < 0) -bent else bent
    }

    fun process(buf: FloatArray, samples: Int) {
        for (i in 0 until samples) {
            val x = buf[i]
            if (x > KNEE || x < -KNEE || x.isNaN()) buf[i] = limit(x)
        }
    }
}
