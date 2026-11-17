package com.playly.player.data.library.duplicates

/** What duplicate search needs of a track. */
data class DupTrack(val id: Long, val title: String, val artist: String?, val durationMs: Long, val sizeBytes: Long)

data class DuplicateGroup(val kind: Kind, val ids: List<Long>) {
    enum class Kind {
        /** Identical file contents. */
        Exact,
        /** Different files with the same title and artist and nearly the same length (within 3 s). */
        Similar,
    }
}

/**
 * Duplicate search as on the desktop (libraryMatch.ts): exact copies by content fingerprint,
 * likely ones by normalised title + artist with durations within 3 seconds. Pure: hashing is
 * the caller's job, and only files that share their size with another need it.
 */
object Duplicates {
    private const val SIMILAR_SECONDS = 3

    /**
     * "Song (Remastered) [Official]" and "song" are the same title: lower case, bracketed parts
     * dropped (an opener up to the next closer of any kind), every run of other than letters and digits
     * becomes one space.
     */
    fun normTitle(s: String): String {
        val text = s.lowercase()
        val out = StringBuilder(text.length)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c in OPENERS) {
                val close = text.indexOfAny(CLOSERS, i + 1)
                if (close >= 0) {
                    out.append(' ')
                    i = close + 1
                    continue
                }
            }
            out.append(if (isWordChar(c)) c else ' ')
            i++
        }
        return out.toString().split(' ').filter { it.isNotEmpty() }.joinToString(" ")
    }

    private val OPENERS = charArrayOf('(', '[', '{')
    private val CLOSERS = charArrayOf(')', ']', '}')

    private fun isWordChar(c: Char): Boolean = c.isLetter() || when (Character.getType(c).toByte()) {
        Character.DECIMAL_DIGIT_NUMBER, Character.LETTER_NUMBER, Character.OTHER_NUMBER -> true
        else -> false
    }

    /** Tracks whose file size another track shares: only those can be exact copies. */
    fun hashCandidates(tracks: List<DupTrack>): List<DupTrack> =
        tracks.filter { it.sizeBytes > 0 }.groupBy { it.sizeBytes }.values.filter { it.size > 1 }.flatten()

    /** The desktop compares whole seconds ("m:ss"). */
    private fun seconds(t: DupTrack) = t.durationMs / 1000

    /** [hashes]: track id to content fingerprint, for the tracks that were hashed. */
    fun find(tracks: List<DupTrack>, hashes: Map<Long, String>): List<DuplicateGroup> {
        val groups = ArrayList<DuplicateGroup>()
        val byHash = LinkedHashMap<String, MutableList<Long>>()
        for (t in tracks) hashes[t.id]?.let { byHash.getOrPut(it) { ArrayList() } += t.id }
        val exactOf = HashMap<Long, String>()
        for ((hash, ids) in byHash) {
            if (ids.size < 2) continue
            groups += DuplicateGroup(DuplicateGroup.Kind.Exact, ids)
            ids.forEach { exactOf[it] = hash }
        }
        val byMeta = LinkedHashMap<String, MutableList<DupTrack>>()
        for (t in tracks) {
            val title = normTitle(t.title)
            if (title.isEmpty()) continue
            byMeta.getOrPut(title + '\u0000' + normTitle(t.artist.orEmpty())) { ArrayList() } += t
        }
        for (list in byMeta.values) {
            if (list.size < 2) continue
            // Within one title: runs of close durations.
            var bucket = ArrayList<DupTrack>()
            fun flush() {
                // Exact copies already have their own group: one of each copy set is enough here.
                val seen = HashSet<String>()
                val ids = bucket.filter { t -> exactOf[t.id]?.let(seen::add) ?: true }.map { it.id }
                if (ids.size > 1) groups += DuplicateGroup(DuplicateGroup.Kind.Similar, ids)
                bucket = ArrayList()
            }
            for (t in list.sortedBy(::seconds)) {
                val last = bucket.lastOrNull()
                if (last != null && seconds(t) - seconds(last) > SIMILAR_SECONDS) flush()
                bucket += t
            }
            flush()
        }
        return groups
    }

    /** "Select extras": in every group all but the earliest added track. */
    fun extras(groups: List<DuplicateGroup>, addedAt: (Long) -> Long): Set<Long> =
        groups.flatMapTo(LinkedHashSet()) { g -> g.ids.sortedBy(addedAt).drop(1) }
}
