package com.playly.player.data.playlists

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import androidx.room.withTransaction
import com.playly.player.data.db.PlaylistEntity
import com.playly.player.data.db.PlaylistEntryEntity
import com.playly.player.data.db.PlaylistTrackRow
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SQLITE_MAX_ARGS
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

/** What "Add to playlist" did: the new entries (for "Undo") and how many duplicates it left out. */
data class AddToPlaylistResult(val playlistId: Long, val addedEntryIds: List<Long>, val skippedDuplicates: Int)

/** Entries taken out of a playlist with their former places, so "Undo" puts them back exactly. */
data class RemovedEntries(val playlistId: Long, val entries: List<Pair<Int, PlaylistEntryEntity>>) {
    val count: Int get() = entries.size
}

/**
 * Playlists: create, edit, delete, add and remove tracks, manual order. Removing a track from a
 * playlist never touches the file. Positions are kept dense (0..n-1) inside transactions, so
 * the order survives any crash in one piece.
 */
class PlaylistRepository(
    private val resolver: ContentResolver,
    private val database: PlaylyDatabase,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val dao = database.playlistDao()

    /** Every playlist, recently changed first, with its automatic cover. */
    val cards: Flow<List<PlaylistCard>> = combine(dao.observeSummaries(), dao.observeCoverTracks()) { summaries, covers ->
        val byPlaylist = covers.groupBy({ it.playlistId }, { it.track })
        summaries.map { summary ->
            val tracks = byPlaylist[summary.playlist.id].orEmpty()
            PlaylistCard(summary, PlaylistRules.coverArtworks(tracks))
        }
    }.distinctUntilChanged().flowOn(Dispatchers.Default)

    fun playlist(id: Long): Flow<PlaylistEntity?> = dao.observe(id)

    fun tracks(playlistId: Long): Flow<List<PlaylistTrackRow>> = dao.observeTracks(playlistId)

    /** Ids of the playlists that already contain [trackId]. */
    fun containing(trackId: Long): Flow<Set<Long>> = dao.observeContaining(trackId).map { it.toSet() }.distinctUntilChanged()

    /** Playable tracks in the order the playlist page shows them (its saved sort). */
    suspend fun playableTrackIds(id: Long): List<Long> = withContext(io) {
        val playlist = dao.get(id) ?: return@withContext emptyList()
        PlaylistRules.sorted(dao.observeTracks(id).first(), PlaylistSort.fromCode(playlist.sortOrder))
            .filter { it.isAvailable }
            .map { it.track.id }
    }

    /** Returns the new id, or null when the name is blank. */
    suspend fun create(name: String, description: String? = null): Long? = withContext(io) {
        val clean = PlaylistRules.cleanName(name) ?: return@withContext null
        val now = clock()
        dao.insert(PlaylistEntity(name = clean, description = PlaylistRules.cleanDescription(description), createdAt = now, updatedAt = now))
    }

    /** False when the name is blank (nothing is saved then). */
    suspend fun updateDetails(id: Long, name: String, description: String?): Boolean = withContext(io) {
        val clean = PlaylistRules.cleanName(name) ?: return@withContext false
        dao.updateDetails(id, clean, PlaylistRules.cleanDescription(description), clock())
        true
    }

    /**
     * Uses the picture at [uri] (from the system picker) as the cover, or the automatic cover when
     * null. The read grant is persisted for the new picture and given back for the old one.
     * False when the provider refuses a lasting grant.
     */
    suspend fun setCover(id: Long, uri: Uri?): Boolean = withContext(io) {
        val old = dao.get(id)?.coverUri
        val new = uri?.toString()
        if (old == new) return@withContext true
        if (uri != null) {
            try {
                resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
                return@withContext false
            }
        }
        dao.updateCover(id, new, clock())
        if (old != null) releaseCover(old)
        true
    }

    /** Deletes the playlist and its entries. Tracks and files stay. */
    suspend fun delete(id: Long) = withContext(io) {
        val cover = dao.get(id)?.coverUri
        dao.delete(id)
        cover?.let(::releaseCover)
    }

    suspend fun setSort(id: Long, sort: PlaylistSort) = withContext(io) { dao.updateSort(id, sort.code) }

    /**
     * Appends [trackIds] in order. Tracks already in the playlist are left out unless
     * [allowDuplicates] (the user confirmed "add again"); the result says how many were skipped.
     */
    suspend fun add(playlistId: Long, trackIds: List<Long>, allowDuplicates: Boolean = false): AddToPlaylistResult = withContext(io) {
        database.withTransaction {
            if (dao.get(playlistId) == null) return@withTransaction AddToPlaylistResult(playlistId, emptyList(), 0)
            val wanted = if (allowDuplicates) {
                trackIds
            } else {
                val present = dao.trackIds(playlistId).toHashSet()
                trackIds.filter { present.add(it) }
            }
            val start = dao.maxPosition(playlistId) + 1
            val now = clock()
            val ids = dao.insertEntries(
                wanted.mapIndexed { i, trackId -> PlaylistEntryEntity(playlistId = playlistId, trackId = trackId, position = start + i, addedAt = now) },
            )
            if (ids.isNotEmpty()) dao.touch(playlistId, now)
            AddToPlaylistResult(playlistId, ids, trackIds.size - wanted.size)
        }
    }

    /** Takes entries out of the playlist (never off the device). */
    suspend fun remove(playlistId: Long, entryIds: Collection<Long>): RemovedEntries = withContext(io) {
        database.withTransaction {
            val order = dao.positions(playlistId).map { it.id }
            val wanted = entryIds.toHashSet()
            val entities = entryIds.chunked(SQLITE_MAX_ARGS).flatMap { dao.entries(it) }
                .filter { it.playlistId == playlistId }
                .associateBy { it.id }
            val removed = order.withIndex().mapNotNull { (index, id) -> entities[id]?.let { index to it } }
            if (removed.isEmpty()) return@withTransaction RemovedEntries(playlistId, emptyList())
            removed.map { it.second.id }.chunked(SQLITE_MAX_ARGS).forEach { dao.deleteEntries(it) }
            renumber(playlistId, order.filter { it !in wanted })
            dao.touch(playlistId, clock())
            RemovedEntries(playlistId, removed)
        }
    }

    /** "Undo" for [remove] or [add]: puts removed entries back at their former places. */
    suspend fun restore(removed: RemovedEntries) = withContext(io) {
        if (removed.entries.isEmpty()) return@withContext
        database.withTransaction {
            if (dao.get(removed.playlistId) == null) return@withTransaction
            val order = dao.positions(removed.playlistId).map { it.id }.toMutableList()
            // A track that left the library meanwhile has nothing to put back. Filtered first, not
            // caught: a foreign-key failure inside Room's insert rolls back this whole transaction.
            val alive = removed.entries.map { it.second.trackId }.distinct()
                .chunked(SQLITE_MAX_ARGS).flatMap { dao.existingTrackIds(it) }.toHashSet()
            removed.entries.filter { it.second.trackId in alive }.sortedBy { it.first }.forEach { (index, entry) ->
                if (dao.insertEntries(listOf(entry)).isNotEmpty()) order.add(index.coerceIn(0, order.size), entry.id)
            }
            renumber(removed.playlistId, order)
            dao.touch(removed.playlistId, clock())
        }
    }

    /** "Undo" for [add]. */
    suspend fun undoAdd(result: AddToPlaylistResult) {
        if (result.addedEntryIds.isNotEmpty()) remove(result.playlistId, result.addedEntryIds)
    }

    /** Moves an entry to [toIndex] of the manual order. */
    suspend fun move(playlistId: Long, entryId: Long, toIndex: Int) = withContext(io) {
        database.withTransaction {
            val order = dao.positions(playlistId).map { it.id }
            val from = order.indexOf(entryId)
            if (from < 0 || from == toIndex) return@withTransaction
            renumber(playlistId, PlaylistRules.moved(order, from, toIndex))
            dao.touch(playlistId, clock())
        }
    }

    /** Writes positions 0..n-1 for [order], touching only rows whose position changes. */
    private suspend fun renumber(playlistId: Long, order: List<Long>) {
        val current = dao.positions(playlistId).associate { it.id to it.position }
        order.forEachIndexed { index, id -> if (current[id] != index) dao.setPosition(id, index) }
    }

    private fun releaseCover(uri: String) {
        try {
            resolver.releasePersistableUriPermission(uri.toUri(), Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            // Already gone; nothing to give back.
        }
    }
}
