package com.playly.player.playback

import android.os.Bundle
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.roundToInt

/**
 * The sleep timer as every controller sees it (session extras, stage 8.1). It lives in the
 * playback service, so it runs on with the app closed. Times use SystemClock.elapsedRealtime,
 * one clock for every process on the device, so the app can show the countdown itself.
 */
sealed interface SleepTimer {
    /** Pauses at [deadlineElapsedMs]; the last seconds fade out. [totalMs] is the length chosen. */
    data class At(val deadlineElapsedMs: Long, val totalMs: Long) : SleepTimer {
        fun remainingMs(nowElapsedMs: Long): Long = (deadlineElapsedMs - nowElapsedMs).coerceAtLeast(0)
    }

    /** Pauses when the playing track ends (whichever track that is by then). */
    data object EndOfTrack : SleepTimer

    fun toBundle(): Bundle = Bundle().apply {
        when (this@SleepTimer) {
            is At -> {
                putLong(KEY_DEADLINE, deadlineElapsedMs)
                putLong(KEY_TOTAL, totalMs)
            }
            EndOfTrack -> putBoolean(KEY_END_OF_TRACK, true)
        }
    }

    companion object {
        private const val KEY_DEADLINE = "playly.sleep.deadline"
        private const val KEY_TOTAL = "playly.sleep.total"
        private const val KEY_END_OF_TRACK = "playly.sleep.end_of_track"

        fun from(bundle: Bundle?): SleepTimer? {
            if (bundle == null) return null
            if (bundle.getBoolean(KEY_END_OF_TRACK)) return EndOfTrack
            val deadline = bundle.getLong(KEY_DEADLINE, 0L).takeIf { it > 0 } ?: return null
            return At(deadline, bundle.getLong(KEY_TOTAL, 0L))
        }
    }
}

/** Pure sleep-timer rules, unit-tested without a device. */
object SleepTimerRules {
    /** Choices in the sheet, in minutes. */
    val PRESET_MINUTES = listOf(10, 15, 30, 45, 60, 90)

    /** "+10 min" while a timer runs. */
    const val EXTEND_MINUTES = 10

    /** Longest timer, also after extending: half a day. */
    const val MAX_MS = 12 * 60 * 60_000L

    /** The audio fades out over the last seconds instead of stopping mid-phrase. */
    const val FADE_MS = 10_000L

    fun start(nowElapsedMs: Long, minutes: Int): SleepTimer.At {
        val total = (minutes.coerceAtLeast(1) * 60_000L).coerceAtMost(MAX_MS)
        return SleepTimer.At(nowElapsedMs + total, total)
    }

    /** Adds [minutes] to what is left (an expired timer from now); capped at [MAX_MS] from now. */
    fun extend(timer: SleepTimer.At, nowElapsedMs: Long, minutes: Int): SleepTimer.At {
        val remaining = timer.remainingMs(nowElapsedMs)
        val newRemaining = (remaining + minutes * 60_000L).coerceAtMost(MAX_MS)
        return SleepTimer.At(nowElapsedMs + newRemaining, (timer.totalMs + (newRemaining - remaining)).coerceAtMost(MAX_MS))
    }

    /** Fade length for a timer of [totalMs]: never more than half of a very short timer. */
    fun fadeMs(totalMs: Long): Long = minOf(FADE_MS, totalMs / 2).coerceAtLeast(0)

    /**
     * Player volume with [remainingMs] left. Full until the fade starts, then down to silence on a
     * squared curve, which sounds even to the ear (loudness is not linear in amplitude).
     */
    fun volumeAt(remainingMs: Long, fadeMs: Long): Float {
        if (fadeMs <= 0 || remainingMs >= fadeMs) return 1f
        val x = (remainingMs.toFloat() / fadeMs).coerceIn(0f, 1f)
        return x * x
    }
}

/** Playback speed rules (stage 8.1). Pitch is kept, as on the PC version. */
object PlaybackSpeed {
    const val MIN = 0.5f
    const val MAX = 2f
    const val NORMAL = 1f
    /** Slider step; matches the PC version's speed control. */
    const val STEP = 0.05f
    /** Quick choices, the PC version's presets. */
    val PRESETS = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)

    /** Clamped to [MIN]..[MAX] and rounded to a [STEP], so 1.2499 and 1.25 are the same speed. */
    fun snap(value: Float): Float {
        if (value.isNaN()) return NORMAL
        val steps = (value.coerceIn(MIN, MAX) / STEP).roundToInt()
        return (steps * 5) / 100f
    }

    fun fraction(speed: Float): Float = ((snap(speed) - MIN) / (MAX - MIN)).coerceIn(0f, 1f)

    fun fromFraction(fraction: Float): Float = snap(MIN + fraction.coerceIn(0f, 1f) * (MAX - MIN))

    fun isNormal(speed: Float): Boolean = snap(speed) == NORMAL

    /** "1×", "1.25×" / "1,25×": at most two decimals, the locale's separator. */
    fun label(speed: Float, locale: Locale): String {
        val format = DecimalFormat("0.##", DecimalFormatSymbols.getInstance(locale))
        return format.format(snap(speed).toDouble()) + "×"
    }
}
