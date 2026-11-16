package com.playly.player.playback.audio

import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/** Built-in equaliser preset; its label comes from resources by [id]. */
class EqPreset(val id: String, val gains: List<Float>)

/** The desktop 15-band equaliser (src/lib/equalizer.ts): bands, limits, presets. */
object Equalizer {
    val BANDS: List<Int> = listOf(25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000)
    private val LEGACY_BANDS = listOf(32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
    const val MIN_DB = -12f
    const val MAX_DB = 12f
    const val STEP_DB = 0.5f
    const val Q = 1.1
    /** "Own settings": the user's band values instead of a built-in preset. */
    const val CUSTOM = "custom"
    const val FLAT = "flat"
    val FLAT_GAINS: List<Float> = List(BANDS.size) { 0f }

    /** The desktop presets keep their 10 legacy values and are spread over 15 bands on load. */
    val PRESETS: List<EqPreset> = listOf(
        EqPreset(FLAT, FLAT_GAINS),
        legacy("bass", 7, 6, 5, 3, 1, 0, 0, 0, 0, 0),
        legacy("rock", 5, 4, 3, 1, -1, -1, 1, 3, 4, 5),
        legacy("pop", -1, 1, 3, 4, 3, 1, -1, -1, 0, 1),
        legacy("electronic", 5, 4, 1, 0, -2, 1, 0, 1, 4, 5),
        legacy("vocal", -2, -2, -1, 1, 3, 4, 4, 2, 0, -1),
        legacy("jazz", 3, 2, 1, 2, -1, -1, 0, 1, 2, 3),
        legacy("classic", 4, 3, 2, 1, -1, -1, 0, 2, 3, 4),
        legacy("treble", 0, 0, 0, 0, 0, 1, 3, 5, 6, 7),
    )

    private fun legacy(id: String, vararg gains: Int) = EqPreset(id, normalizeGains(gains.map { it.toFloat() }))

    fun preset(id: String): EqPreset? = PRESETS.firstOrNull { it.id == id }

    /** Rounds to the 0.5 dB step and keeps within ±12 dB; NaN becomes 0. */
    fun clampDb(value: Float): Float {
        if (!value.isFinite()) return 0f
        return ((value * 2).roundToInt() / 2f).coerceIn(MIN_DB, MAX_DB)
    }

    /**
     * Any stored list to exactly 15 valid gains. A 10-value list (the old desktop layout) is
     * interpolated on a logarithmic frequency axis, like the desktop normalizeGains.
     */
    fun normalizeGains(values: List<Float>?): List<Float> {
        var source: List<Float> = values ?: emptyList()
        if (source.size == LEGACY_BANDS.size) {
            val old = source.map { if (it.isFinite()) it else 0f }
            source = BANDS.map { freq ->
                if (freq <= LEGACY_BANDS[0]) return@map old[0]
                val hi = LEGACY_BANDS.indexOfFirst { it >= freq }
                if (hi < 0) return@map old.last()
                val t = ln(freq.toDouble() / LEGACY_BANDS[hi - 1]) / ln(LEGACY_BANDS[hi].toDouble() / LEGACY_BANDS[hi - 1])
                (old[hi - 1] + (old[hi] - old[hi - 1]) * t).toFloat()
            }
        }
        return BANDS.indices.map { i -> source.getOrNull(i)?.let(::clampDb) ?: 0f }
    }

    /** "1.6k", "630": the desktop band label. */
    fun bandLabel(freq: Int): String = when {
        freq < 1000 -> freq.toString()
        freq % 1000 == 0 -> "${freq / 1000}k"
        else -> "${freq / 1000}.${freq % 1000 / 100}k"
    }

    /** Pre-gain that keeps boosts from clipping: 10^(-maxBoost * 0.75 / 20). */
    fun preGain(gains: List<Float>): Double {
        val boost = gains.maxOrNull()?.coerceAtLeast(0f) ?: 0f
        return 10.0.pow(-boost * 0.75 / 20.0)
    }

    /** Stored form of the user's own bands: "0,1.5,-2,...". */
    fun encode(gains: List<Float>): String = normalizeGains(gains).joinToString(",") { g ->
        if (g == g.toInt().toFloat()) g.toInt().toString() else g.toString()
    }

    fun decode(raw: String?): List<Float> =
        normalizeGains(raw?.split(',')?.mapNotNull { it.trim().toFloatOrNull() }?.takeIf { it.isNotEmpty() })
}
