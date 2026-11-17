package com.playly.player.data.library.duplicates

import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.library.TrackFiles

/** One search: the groups and the rows they refer to (as they were when the search ran). */
data class DuplicateScan(val groups: List<DuplicateGroup>, val tracks: Map<Long, TrackEntity>)

/**
 * Runs a duplicate search over the music folder (stage 8.4), like the desktop's Duplicates
 * window: only files that share their size with another are read and hashed.
 */
class DuplicateFinder(private val library: LibraryRepository, private val files: TrackFiles) {
    /** [onProgress]: files hashed so far and how many need hashing. */
    suspend fun scan(onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): DuplicateScan {
        val rows = library.availableFolderTracks()
        val tracks = rows.map { DupTrack(it.id, it.title, it.artist, it.durationMs, it.sizeBytes) }
        val byId = rows.associateBy { it.id }
        val candidates = Duplicates.hashCandidates(tracks)
        val hashes = HashMap<Long, String>()
        onProgress(0, candidates.size)
        candidates.forEachIndexed { index, candidate ->
            byId[candidate.id]?.let { files.fingerprint(it) }?.let { hashes[candidate.id] = it }
            onProgress(index + 1, candidates.size)
        }
        return DuplicateScan(Duplicates.find(tracks, hashes), byId)
    }
}
