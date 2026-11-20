package com.playly.player.data.backup

import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackEntity

/**
 * Stage 9.2: a track as a backup or a playlist file names it. Ids do not survive a reinstall
 * or another phone, so a track is found again by its path, then by name, artist and length.
 *
 * @param path "Rock/Album/01 Song.mp3" (relative to the music folder) or any absolute path,
 *   with / or \ (an M3U written on Windows); null when unknown.
 */
data class TrackRef(
    val path: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val durationMs: Long = 0,
    val sizeBytes: Long = 0,
)

/** Finds library tracks for [TrackRef]s. Built once per import: lookups are hash-based. */
class TrackMatcher(tracks: List<TrackEntity>) {
    private class Entry(val track: TrackEntity, val segments: List<String>)

    private val byFileName: Map<String, List<Entry>> = tracks.asSequence()
        .map { Entry(it, segments(listOfNotNull(it.folderPath, it.fileName).joinToString("/"))) }
        .groupBy { it.segments.last() }
    private val byTitle: Map<String, List<TrackEntity>> = tracks.groupBy { titleKey(it.title, it.artist) }

    /** The best track for [ref], or null. With several equal candidates the first one wins. */
    fun match(ref: TrackRef): TrackEntity? = ref.path?.let(::byPath)?.let { pick(it, ref) } ?: byTags(ref)

    private fun byPath(path: String): List<Entry>? {
        val wanted = segments(path)
        if (wanted.isEmpty()) return null
        val candidates = byFileName[wanted.last()] ?: return null
        // The longest common tail wins: "D:\Music\Rock\a.mp3" finds ".../Rock/a.mp3" over ".../Pop/a.mp3".
        val scored = candidates.map { it to commonTail(it.segments, wanted) }
        val best = scored.maxOf { it.second }
        return scored.filter { it.second == best }.map { it.first }
    }

    private fun pick(candidates: List<Entry>, ref: TrackRef): TrackEntity {
        if (candidates.size == 1) return candidates[0].track
        return candidates.firstOrNull { ref.sizeBytes > 0 && it.track.sizeBytes == ref.sizeBytes }?.track
            ?: candidates.firstOrNull { ref.title != null && titleKey(it.track.title, it.track.artist) == titleKey(ref.title, ref.artist) }?.track
            ?: candidates[0].track
    }

    private fun byTags(ref: TrackRef): TrackEntity? {
        val title = ref.title?.takeIf { it.isNotBlank() } ?: return null
        val candidates = byTitle[titleKey(title, ref.artist)].orEmpty()
        if (ref.durationMs <= 0) return candidates.firstOrNull()
        return candidates.filter { it.durationMs <= 0 || kotlin.math.abs(it.durationMs - ref.durationMs) <= DURATION_SLACK_MS }
            .minByOrNull { kotlin.math.abs(it.durationMs - ref.durationMs) }
    }

    companion object {
        /** M3U lengths are whole seconds, tags and decoders disagree a little. */
        const val DURATION_SLACK_MS = 3_000L

        /** Lower-cased path parts, without a scheme, drive letter or empty parts. */
        fun segments(path: String): List<String> = path
            .removePrefix("file://")
            .replace('\\', '/')
            .split('/')
            .filter { it.isNotEmpty() && it != "." && !(it.length == 2 && it[1] == ':') }
            .map { it.lowercase() }

        private fun commonTail(a: List<String>, b: List<String>): Int {
            var n = 0
            while (n < a.size && n < b.size && a[a.size - 1 - n] == b[b.size - 1 - n]) n++
            return n
        }

        private fun titleKey(title: String, artist: String?): String = SearchText.key(title, artist.orEmpty())
    }
}
