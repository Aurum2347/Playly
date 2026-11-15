package com.playly.player.core

import kotlin.math.max
import kotlin.math.min

/**
 * Picks the background tint for the full-screen player from a tiny copy of the cover.
 * Pure (ARGB ints in, ARGB int out) so it is unit-tested on the JVM.
 *
 * Colourful, bright pixels weigh more than grey or black ones, so a mostly dark cover with a
 * red title still reads as red. The result has a fixed, moderate brightness and capped
 * saturation: the UI blends only a small part of it into the background (spec §10: "very
 * delicate"), and a neon cover never turns the player neon.
 */
object ArtworkTint {
    const val MAX_SATURATION = 0.5f
    const val VALUE = 0.6f

    /** Null when there is nothing to go by (empty or fully transparent image). */
    fun fromPixels(pixels: IntArray): Int? {
        var r = 0.0
        var g = 0.0
        var b = 0.0
        var total = 0.0
        for (p in pixels) {
            if ((p ushr 24) < 128) continue
            val pr = (p shr 16) and 0xFF
            val pg = (p shr 8) and 0xFF
            val pb = p and 0xFF
            val hi = max(pr, max(pg, pb))
            val lo = min(pr, min(pg, pb))
            val saturation = if (hi == 0) 0.0 else (hi - lo).toDouble() / hi
            val weight = 0.1 + saturation * (hi / 255.0)
            r += pr * weight
            g += pg * weight
            b += pb * weight
            total += weight
        }
        if (total == 0.0) return null
        val hsv = rgbToHsv((r / total).toFloat(), (g / total).toFloat(), (b / total).toFloat())
        return hsvToArgb(hsv[0], min(hsv[1], MAX_SATURATION), VALUE)
    }

    /** [r], [g], [b] in 0..255; returns hue 0..360, saturation and value 0..1. */
    internal fun rgbToHsv(r: Float, g: Float, b: Float): FloatArray {
        val hi = max(r, max(g, b))
        val lo = min(r, min(g, b))
        val delta = hi - lo
        val hue = when {
            delta == 0f -> 0f
            hi == r -> 60f * (((g - b) / delta) % 6f)
            hi == g -> 60f * (((b - r) / delta) + 2f)
            else -> 60f * (((r - g) / delta) + 4f)
        }.let { if (it < 0f) it + 360f else it }
        val saturation = if (hi == 0f) 0f else delta / hi
        return floatArrayOf(hue, saturation, hi / 255f)
    }

    internal fun hsvToArgb(hue: Float, saturation: Float, value: Float): Int {
        val c = value * saturation
        val h = (hue % 360f) / 60f
        val x = c * (1f - kotlin.math.abs(h % 2f - 1f))
        val (r1, g1, b1) = when (h.toInt()) {
            0 -> Triple(c, x, 0f)
            1 -> Triple(x, c, 0f)
            2 -> Triple(0f, c, x)
            3 -> Triple(0f, x, c)
            4 -> Triple(x, 0f, c)
            else -> Triple(c, 0f, x)
        }
        val m = value - c
        fun channel(v: Float) = ((v + m) * 255f + 0.5f).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (channel(r1) shl 16) or (channel(g1) shl 8) or channel(b1)
    }
}
