package com.playly.player.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/** SQLite's bound-parameter limit is 999 on older Android versions; stay below it. */
const val SQLITE_MAX_ARGS = 900

/** How many leading entries per playlist are read to compose its automatic cover. */
const val PLAYLIST_COVER_CANDIDATES = 12

/** Columns of [TrackListItem]; queries select exactly these so rows stay light. */
const val TRACK_LIST_COLUMNS = "id, uri, media_store_id, album_id, title, artist, album, duration_ms, size_bytes, " +
    "date_modified, date_added, track_number, disc_number"

@Dao
interface TrackDao {
    @Query(
        "SELECT COUNT(*) AS track_count, COALESCE(SUM(duration_ms), 0) AS total_duration_ms " +
            "FROM tracks WHERE is_available = 1",
    )
    fun observeSummary(): Flow<LibrarySummary>

    /** [escapedKey] must be normalised with SearchText and escaped with SearchText.escapeLike. */
    @Query(
        "SELECT * FROM tracks WHERE is_available = 1 AND search_key LIKE '%' || :escapedKey || '%' ESCAPE '\\' " +
            "ORDER BY title COLLATE NOCASE LIMIT :limit",
    )
    suspend fun search(escapedKey: String, limit: Int): List<TrackEntity>

    /** Visible library, ordered by search key: case- and accent-insensitive, Cyrillic-aware. */
    @Query(
        "SELECT $TRACK_LIST_COLUMNS FROM tracks WHERE is_available = 1 ORDER BY search_key, id",
    )
    fun observeList(): Flow<List<TrackListItem>>

    /** The visible library with grouping tags, in the same order as [observeList]. */
    @Query(
        "SELECT $TRACK_LIST_COLUMNS, album_artist, genre, year, folder_path, search_key FROM tracks " +
            "WHERE is_available = 1 ORDER BY search_key, id",
    )
    fun observeBrowse(): Flow<List<BrowseTrack>>

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. Order is not guaranteed. */
    @Query("SELECT * FROM tracks WHERE id IN (:ids)")
    suspend fun byIds(ids: List<Long>): List<TrackEntity>

    @Query("SELECT COUNT(*) FROM tracks WHERE is_available = 0")
    fun observeUnavailableCount(): Flow<Int>

    @Query("SELECT * FROM tracks WHERE media_store_id IS NOT NULL")
    suspend fun mediaStoreTracks(): List<TrackEntity>

    /** Rows a folder scan may claim: its own plus folder rows orphaned by a removed source. */
    @Query("SELECT * FROM tracks WHERE media_store_id IS NULL AND (source_id = :sourceId OR source_id IS NULL)")
    suspend fun folderTracks(sourceId: Long): List<TrackEntity>

    @Query("SELECT id, media_store_id, source_id, folder_path, file_name, size_bytes FROM tracks WHERE is_available = 1")
    suspend fun availableLocations(): List<TrackLocation>

    /** Playable tracks of the music folder: what duplicate search compares (stage 8.4). */
    @Query("SELECT * FROM tracks WHERE is_available = 1 AND source_id IS NOT NULL")
    suspend fun availableFolderTracks(): List<TrackEntity>

    /** Returns -1 for rows skipped because their URI is already indexed. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(tracks: List<TrackEntity>): List<Long>

    @Update
    suspend fun updateAll(tracks: List<TrackEntity>)

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("UPDATE tracks SET is_available = 0, missing_since = :now WHERE id IN (:ids) AND is_available = 1")
    suspend fun markMissing(ids: List<Long>, now: Long)

    /** Rows from the old "all music on the device" mode (MediaStore); the library is one chosen folder now. */
    @Query("DELETE FROM tracks WHERE media_store_id IS NOT NULL AND id NOT IN (SELECT track_id FROM playlist_entries) " +
            "AND id NOT IN (SELECT track_id FROM favorites)")
    suspend fun deleteUnreferencedMediaStore(): Int

    @Query("UPDATE tracks SET is_available = 0, missing_since = :now WHERE media_store_id IS NOT NULL AND is_available = 1")
    suspend fun markMediaStoreMissing(now: Long): Int

    @Query("UPDATE tracks SET is_available = 0, missing_since = :now WHERE source_id = :sourceId AND is_available = 1")
    suspend fun markSourceMissing(sourceId: Long, now: Long)

    /** Forgets a source's tracks that no playlist or favourite needs; the rest stay, flagged unavailable. */
    @Query("DELETE FROM tracks WHERE source_id = :sourceId AND id NOT IN (SELECT track_id FROM playlist_entries) " +
            "AND id NOT IN (SELECT track_id FROM favorites)")
    suspend fun deleteUnreferencedFromSource(sourceId: Long)

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("DELETE FROM tracks WHERE id IN (:ids)")
    suspend fun deleteAll(ids: List<Long>)

    @Query("DELETE FROM tracks WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface LibrarySourceDao {
    @Query("SELECT * FROM library_sources ORDER BY display_name COLLATE NOCASE")
    fun observeAll(): Flow<List<LibrarySourceEntity>>

    @Query(
        "SELECT s.*, COUNT(t.id) AS track_count FROM library_sources s " +
            "LEFT JOIN tracks t ON t.source_id = s.id AND t.is_available = 1 " +
            "GROUP BY s.id ORDER BY s.display_name COLLATE NOCASE",
    )
    fun observeSummaries(): Flow<List<SourceSummary>>

    @Query("SELECT * FROM library_sources ORDER BY id")
    suspend fun all(): List<LibrarySourceEntity>

    @Query("UPDATE library_sources SET is_accessible = :accessible, last_scan_at = COALESCE(:scannedAt, last_scan_at) WHERE id = :id")
    suspend fun updateScanState(id: Long, accessible: Boolean, scannedAt: Long?)

    @Query("SELECT * FROM library_sources WHERE id = :id")
    suspend fun get(id: Long): LibrarySourceEntity?

    @Query("SELECT * FROM library_sources WHERE tree_uri = :treeUri")
    suspend fun findByUri(treeUri: String): LibrarySourceEntity?

    /** Returns -1 when the folder is already a source. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(source: LibrarySourceEntity): Long

    @Query("DELETE FROM library_sources WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface PlaylistDao {
    /** Which of [trackIds] are still in the library. Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("SELECT id FROM tracks WHERE id IN (:trackIds)")
    suspend fun existingTrackIds(trackIds: List<Long>): List<Long>

    @Query(
        "SELECT p.*, COUNT(e.id) AS track_count, COALESCE(SUM(t.duration_ms), 0) AS total_duration_ms " +
            "FROM playlists p " +
            "LEFT JOIN playlist_entries e ON e.playlist_id = p.id " +
            "LEFT JOIN tracks t ON t.id = e.track_id " +
            "GROUP BY p.id ORDER BY p.updated_at DESC",
    )
    fun observeSummaries(): Flow<List<PlaylistSummary>>

    @Insert
    suspend fun insert(playlist: PlaylistEntity): Long

    @Insert
    suspend fun insertEntries(entries: List<PlaylistEntryEntity>): List<Long>

    @Query("SELECT * FROM playlists WHERE id = :id")
    fun observe(id: Long): Flow<PlaylistEntity?>

    @Query("SELECT * FROM playlists WHERE id = :id")
    suspend fun get(id: Long): PlaylistEntity?

    /** Every entry with its track, in the user's order; unavailable files included (shown dimmed). */
    @Query(
        "SELECT e.id AS entry_id, e.added_at AS entry_added_at, t.is_available, " +
            "t.id, t.uri, t.media_store_id, t.album_id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, " +
            "t.date_modified, t.date_added, t.track_number, t.disc_number " +
            "FROM playlist_entries e JOIN tracks t ON t.id = e.track_id " +
            "WHERE e.playlist_id = :playlistId ORDER BY e.position, e.id",
    )
    fun observeTracks(playlistId: Long): Flow<List<PlaylistTrackRow>>

    /**
     * The first [PLAYLIST_COVER_CANDIDATES] entries of every playlist (available files only), for
     * automatic covers. A correlated count instead of a window function: Android 9 ships SQLite 3.22.
     */
    @Query(
        "SELECT e.playlist_id AS playlist_id, " +
            "t.id, t.uri, t.media_store_id, t.album_id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, " +
            "t.date_modified, t.date_added, t.track_number, t.disc_number " +
            "FROM playlist_entries e JOIN tracks t ON t.id = e.track_id " +
            "WHERE t.is_available = 1 AND (SELECT COUNT(*) FROM playlist_entries e2 WHERE e2.playlist_id = e.playlist_id " +
            "AND (e2.position < e.position OR (e2.position = e.position AND e2.id < e.id))) < $PLAYLIST_COVER_CANDIDATES " +
            "ORDER BY e.playlist_id, e.position, e.id",
    )
    fun observeCoverTracks(): Flow<List<PlaylistCoverTrack>>

    /** Playlists that already hold [trackId] ("Add to playlist" marks them). */
    @Query("SELECT DISTINCT playlist_id FROM playlist_entries WHERE track_id = :trackId")
    fun observeContaining(trackId: Long): Flow<List<Long>>

    @Query("UPDATE playlists SET name = :name, description = :description, updated_at = :now WHERE id = :id")
    suspend fun updateDetails(id: Long, name: String, description: String?, now: Long)

    @Query("UPDATE playlists SET cover_uri = :coverUri, updated_at = :now WHERE id = :id")
    suspend fun updateCover(id: Long, coverUri: String?, now: Long)

    @Query("UPDATE playlists SET sort_order = :sortOrder WHERE id = :id")
    suspend fun updateSort(id: Long, sortOrder: Int)

    @Query("UPDATE playlists SET updated_at = :now WHERE id = :id")
    suspend fun touch(id: Long, now: Long)

    @Query("SELECT COALESCE(MAX(position), -1) FROM playlist_entries WHERE playlist_id = :playlistId")
    suspend fun maxPosition(playlistId: Long): Int

    @Query("SELECT track_id FROM playlist_entries WHERE playlist_id = :playlistId")
    suspend fun trackIds(playlistId: Long): List<Long>

    @Query("SELECT id, position FROM playlist_entries WHERE playlist_id = :playlistId ORDER BY position, id")
    suspend fun positions(playlistId: Long): List<EntryPosition>

    @Query("UPDATE playlist_entries SET position = :position WHERE id = :entryId")
    suspend fun setPosition(entryId: Long, position: Int)

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("SELECT * FROM playlist_entries WHERE id IN (:ids)")
    suspend fun entries(ids: List<Long>): List<PlaylistEntryEntity>

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("DELETE FROM playlist_entries WHERE id IN (:ids)")
    suspend fun deleteEntries(ids: List<Long>)

    /** Re-points entries when two rows turn out to be the same file, so no playlist loses it. */
    @Query("UPDATE playlist_entries SET track_id = :to WHERE track_id = :from")
    suspend fun moveEntries(from: Long, to: Long)

    @Query("SELECT COUNT(*) FROM playlist_entries WHERE playlist_id = :playlistId")
    suspend fun entryCount(playlistId: Long): Int

    @Query("DELETE FROM playlists WHERE id = :id")
    suspend fun delete(id: Long)
}

@Dao
interface PlayHistoryDao {
    @Insert
    suspend fun insert(entry: PlayHistoryEntity)

    /** Keeps the newest [keep] rows. */
    @Query("DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC, id DESC LIMIT :keep)")
    suspend fun trim(keep: Int)

    @Transaction
    suspend fun record(trackId: Long, playedAt: Long) {
        insert(PlayHistoryEntity(trackId = trackId, playedAt = playedAt))
        trim(KEEP)
    }

    /** Distinct available tracks, most recently started first. */
    @Query(
        "SELECT t.id, t.uri, t.media_store_id, t.album_id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, " +
            "t.date_modified, t.date_added, t.track_number, t.disc_number " +
            "FROM tracks t JOIN (SELECT track_id, MAX(played_at) AS last_played, MAX(id) AS last_id " +
            "FROM play_history GROUP BY track_id) h ON h.track_id = t.id " +
            "WHERE t.is_available = 1 ORDER BY h.last_played DESC, h.last_id DESC LIMIT :limit",
    )
    fun observeRecent(limit: Int): Flow<List<TrackListItem>>

    @Query("SELECT COUNT(*) FROM play_history")
    suspend fun count(): Int

    companion object {
        const val KEEP = 1000
    }
}

@Dao
interface FavoriteDao {
    /** Ids of every favourite, available or not: the heart buttons read this. */
    @Query("SELECT track_id FROM favorites")
    fun observeIds(): Flow<List<Long>>

    @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE track_id = :trackId)")
    fun observeIsFavorite(trackId: Long): Flow<Boolean>

    /** Available favourites by title order (the base every sort starts from), with when they were added. */
    @Query(
        "SELECT f.added_at AS favorite_added_at, " +
            "t.id, t.uri, t.media_store_id, t.album_id, t.title, t.artist, t.album, t.duration_ms, t.size_bytes, " +
            "t.date_modified, t.date_added, t.track_number, t.disc_number " +
            "FROM favorites f JOIN tracks t ON t.id = f.track_id " +
            "WHERE t.is_available = 1 ORDER BY t.search_key, t.id",
    )
    fun observeTracks(): Flow<List<FavoriteTrackRow>>

    /**
     * Which of [trackIds] are still in the table. Filter before inserting: a foreign-key failure
     * inside Room's insert would silently roll back the caller's whole transaction.
     * Pass at most [SQLITE_MAX_ARGS] ids per call.
     */
    @Query("SELECT id FROM tracks WHERE id IN (:trackIds)")
    suspend fun existingTrackIds(trackIds: List<Long>): List<Long>

    /** Already-favourite tracks keep their original date. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(favorites: List<FavoriteEntity>): List<Long>

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("SELECT * FROM favorites WHERE track_id IN (:trackIds)")
    suspend fun byTrackIds(trackIds: List<Long>): List<FavoriteEntity>

    /** Pass at most [SQLITE_MAX_ARGS] ids per call. */
    @Query("DELETE FROM favorites WHERE track_id IN (:trackIds)")
    suspend fun deleteAll(trackIds: List<Long>)

    @Query("SELECT COUNT(*) FROM favorites")
    suspend fun count(): Int
}
