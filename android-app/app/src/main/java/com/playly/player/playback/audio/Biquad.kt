package com.playly.player.playback.audio

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

enum class FilterType { LowShelf, Peaking, HighShelf }

/** Normalised biquad coefficients (a0 = 1), RBJ cookbook formulas as in the Web Audio spec. */
class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
    /** Magnitude response in dB at [freq], for tests and checks. */
    fun responseDb(freq: Double, sampleRate: Double): Double {
        val w = 2 * PI * freq / sampleRate
        val c1 = cos(w); val s1 = sin(w); val c2 = cos(2 * w); val s2 = sin(2 * w)
        val num = hypot(b0 + b1 * c1 + b2 * c2, -(b1 * s1 + b2 * s2))
        val den = hypot(1 + a1 * c1 + a2 * c2, -(a1 * s1 + a2 * s2))
        return 20 * log10(num / den)
    }

    companion object {
        val IDENTITY = Biquad(1.0, 0.0, 0.0, 0.0, 0.0)

        /**
         * Shelves use slope S = 1 like Web Audio's lowshelf / highshelf; peaking uses [q]. A band
         * at or above Nyquist has nothing to act on and stays neutral.
         */
        fun design(type: FilterType, freq: Double, gainDb: Double, q: Double, sampleRate: Double): Biquad {
            if (gainDb == 0.0 || freq >= sampleRate * 0.49) return IDENTITY
            val a = 10.0.pow(gainDb / 40)
            val w0 = 2 * PI * freq / sampleRate
            val cw = cos(w0)
            val sw = sin(w0)
            return when (type) {
                FilterType.Peaking -> {
                    val alpha = sw / (2 * q)
                    norm(1 + alpha * a, -2 * cw, 1 - alpha * a, 1 + alpha / a, -2 * cw, 1 - alpha / a)
                }
                FilterType.LowShelf -> {
                    val k = 2 * sqrt(a) * (sw / 2 * sqrt(2.0))
                    norm(
                        a * ((a + 1) - (a - 1) * cw + k), 2 * a * ((a - 1) - (a + 1) * cw), a * ((a + 1) - (a - 1) * cw - k),
                        (a + 1) + (a - 1) * cw + k, -2 * ((a - 1) + (a + 1) * cw), (a + 1) + (a - 1) * cw - k,
                    )
                }
                FilterType.HighShelf -> {
                    val k = 2 * sqrt(a) * (sw / 2 * sqrt(2.0))
                    norm(
                        a * ((a + 1) + (a - 1) * cw + k), -2 * a * ((a - 1) + (a + 1) * cw), a * ((a + 1) + (a - 1) * cw - k),
                        (a + 1) - (a - 1) * cw + k, 2 * ((a - 1) - (a + 1) * cw), (a + 1) - (a - 1) * cw - k,
                    )
                }
            }
        }

        private fun norm(b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double) =
            Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)

        fun typeOf(band: Int): FilterType = when (band) {
            0 -> FilterType.LowShelf
            Equalizer.BANDS.lastIndex -> FilterType.HighShelf
            else -> FilterType.Peaking
        }
    }
}
