package com.playly.player.data.favorites

import androidx.room.withTransaction
import com.playly.player.data.db.FavoriteEntity
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SQLITE_MAX_ARGS
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.sortedFor
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** A favourite as the Favourites page lists it. */
data class FavoriteTrack(val track: TrackListItem, val addedAt: Long)

/** Order of the Favourites page. Persisted by name; an unknown name means [Added]. */
enum class FavoriteSort {
    /** Most recently added first (as on the PC version). */
    Added,
    Title,
    Artist,
    Album,
    Duration;

    companion object {
        fun fromName(name: String?): FavoriteSort = entries.firstOrNull { it.name == name } ?: Added
    }
}

/**
 * Orders favourites, which must come in title order (as the database returns them). Every sort
 * is stable, so ties keep the title order; tag sorts are the library's own [TrackSort] rules.
 */
fun List<FavoriteTrack>.sortedFor(sort: FavoriteSort): List<FavoriteTrack> {
    val trackSort = when (sort) {
        FavoriteSort.Added -> return sortedByDescending { it.addedAt }
        FavoriteSort.Title -> return this
        FavoriteSort.Artist -> TrackSort.Artist
        FavoriteSort.Album -> TrackSort.Album
        FavoriteSort.Duration -> TrackSort.Duration
    }
    val byId = associateBy { it.track.id }
    return map { it.track }.sortedFor(trackSort).mapNotNull { byId[it.id] }
}

/** What an add or remove changed, so "Undo" can put exactly that back (with the original dates). */
data class FavoriteChange(val added: List<Long> = emptyList(), val removed: List<FavoriteEntity> = emptyList()) {
    val isEmpty: Boolean get() = added.isEmpty() && removed.isEmpty()
}

/** Favourite tracks (stage 8.1). Independent of playlists; files are never touched. */
class FavoritesRepository(private val database: PlaylyDatabase) {
    private val dao = database.favoriteDao()

    /** Every favourite id; one cheap query shared by heart buttons and menus. */
    val ids: Flow<Set<Long>> = dao.observeIds().map { it.toHashSet() }.distinctUntilChanged()

    /** Available favourites in title order; sort with [sortedFor]. */
    val tracks: Flow<List<FavoriteTrack>> = dao.observeTracks()
        .map { rows -> rows.map { FavoriteTrack(it.track, it.addedAt) } }

    fun isFavorite(trackId: Long): Flow<Boolean> = dao.observeIsFavorite(trackId).distinctUntilChanged()

    /** Adds the tracks; ones already there keep their date. Tracks that left the library are skipped. */
    suspend fun add(trackIds: Collection<Long>, now: Long = System.currentTimeMillis()): FavoriteChange {
        if (trackIds.isEmpty()) return FavoriteChange()
        return database.withTransaction {
            val entities = existing(trackIds.distinct()).map { FavoriteEntity(it, now) }
            val added = entities.chunked(SQLITE_MAX_ARGS).flatMap { chunk ->
                chunk.zip(dao.insertAll(chunk)).filter { (_, rowId) -> rowId != -1L }.map { (entity, _) -> entity.trackId }
            }
            FavoriteChange(added = added)
        }
    }

    suspend fun remove(trackIds: Collection<Long>): FavoriteChange {
        if (trackIds.isEmpty()) return FavoriteChange()
        return database.withTransaction {
            val removed = ArrayList<FavoriteEntity>()
            trackIds.distinct().chunked(SQLITE_MAX_ARGS).forEach { chunk ->
                removed += dao.byTrackIds(chunk)
                dao.deleteAll(chunk)
            }
            FavoriteChange(removed = removed)
        }
    }

    /** Heart button: favourite or not. */
    suspend fun set(trackId: Long, favorite: Boolean): FavoriteChange =
        if (favorite) add(listOf(trackId)) else remove(listOf(trackId))

    /** Reverts [change]: removes what it added, brings back what it removed with the old dates. */
    suspend fun undo(change: FavoriteChange) {
        if (change.isEmpty) return
        database.withTransaction {
            change.added.chunked(SQLITE_MAX_ARGS).forEach { dao.deleteAll(it) }
            val alive = existing(change.removed.map { it.trackId }).toHashSet()
            change.removed.filter { it.trackId in alive }.chunked(SQLITE_MAX_ARGS).forEach { dao.insertAll(it) }
        }
    }

    /** Ids still in the library, in the given order; a track deleted meanwhile is dropped. */
    private suspend fun existing(ids: List<Long>): List<Long> {
        val alive = ids.chunked(SQLITE_MAX_ARGS).flatMap { dao.existingTrackIds(it) }.toHashSet()
        return ids.filter { it in alive }
    }
}
