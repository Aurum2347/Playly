package com.playly.player.core

import java.util.Locale

/** Whole hours and remaining minutes of a duration, for "3 ч 20 мин" style labels. */
data class HoursMinutes(val hours: Long, val minutes: Long)

fun splitDuration(totalMs: Long): HoursMinutes {
    val totalMinutes = (totalMs.coerceAtLeast(0) + 30_000) / 60_000
    return HoursMinutes(totalMinutes / 60, totalMinutes % 60)
}

/** "m:ss" or "h:mm:ss" for track rows. */
fun formatClock(ms: Long): String {
    val totalSeconds = ms.coerceAtLeast(0) / 1000
    val h = totalSeconds / 3600
    val m = (totalSeconds % 3600) / 60
    val s = totalSeconds % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
}
