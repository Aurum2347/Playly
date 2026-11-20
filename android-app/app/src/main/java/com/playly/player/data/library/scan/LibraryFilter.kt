package com.playly.player.data.library.scan

import com.playly.player.data.db.TrackEntity

/**
 * Stage 9.1: what the user keeps out of the library. A hidden file is treated like one that is
 * not in the folder: it is forgotten, or flagged unavailable when a playlist or favourite needs it.
 *
 * @param minDurationMs tracks shorter than this are hidden (ringtones, notification sounds);
 *   0 hides nothing. A track whose length is unknown (0) is kept.
 * @param excludedFolders folder paths as the library stores them ("Music/Voice"); a folder hides
 *   its subfolders too.
 */
data class LibraryFilter(
    val minDurationMs: Long = 0,
    val excludedFolders: Set<String> = emptySet(),
) {
    val isEmpty: Boolean get() = minDurationMs <= 0 && excludedFolders.isEmpty()

    fun hides(track: TrackEntity): Boolean =
        isShort(track.durationMs) || isExcluded(track.folderPath)

    private fun isShort(durationMs: Long) = minDurationMs > 0 && durationMs in 1 until minDurationMs

    fun isExcluded(folderPath: String?): Boolean {
        if (excludedFolders.isEmpty()) return false
        val path = normalize(folderPath) ?: return false
        return excludedFolders.any { path == it || path.startsWith("$it/") }
    }

    companion object {
        /** Choices of the "Hide tracks shorter than" setting, in seconds. */
        val MIN_DURATION_CHOICES = listOf(0, 10, 30, 60)

        fun normalize(folderPath: String?): String? = folderPath?.trim('/')?.takeIf { it.isNotEmpty() }
    }
}

/**
 * Rows of [existing] that went missing in [result] only because the filter hid their file
 * ([kept] before the filter, [visible] after it), not because the file is gone.
 */
internal fun hiddenRowIds(
    existing: List<TrackEntity>,
    kept: List<TrackEntity>,
    visible: List<TrackEntity>,
    result: ReconcileResult,
): List<Long> {
    val visibleUris = visible.mapTo(HashSet()) { it.uri }
    val hiddenUris = kept.asSequence().map { it.uri }.filterNot(visibleUris::contains).toHashSet()
    if (hiddenUris.isEmpty()) return emptyList()
    val missing = result.missingIds.toHashSet()
    return existing.filter { it.id in missing && it.uri in hiddenUris }.map { it.id }
}
