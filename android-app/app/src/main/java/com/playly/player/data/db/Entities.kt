package com.playly.player.data.db

import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A folder the user granted through the Storage Access Framework.
 * The persisted URI permission is owned by this row: removing the row releases it.
 */
@Entity(
    tableName = "library_sources",
    indices = [Index(value = ["tree_uri"], unique = true)],
)
data class LibrarySourceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "tree_uri") val treeUri: String,
    @ColumnInfo(name = "display_name") val displayName: String,
    @ColumnInfo(name = "added_at") val addedAt: Long,
    @ColumnInfo(name = "last_scan_at") val lastScanAt: Long? = null,
    /** False when the grant was revoked or the volume (e.g. an SD card) is gone. Since v2. */
    @ColumnInfo(name = "is_accessible", defaultValue = "1") val isAccessible: Boolean = true,
)

/**
 * One audio file. [id] is Playly's stable identifier; [uri] is how the file is opened
 * (MediaStore or SAF document URI). Files that disappear are flagged, not deleted,
 * so playlists keep their entries until the user decides.
 */
@Entity(
    tableName = "tracks",
    foreignKeys = [
        ForeignKey(
            entity = LibrarySourceEntity::class,
            parentColumns = ["id"],
            childColumns = ["source_id"],
            onDelete = ForeignKey.SET_NULL,
        ),
    ],
    indices = [
        Index(value = ["uri"], unique = true),
        Index(value = ["media_store_id"], unique = true),
        Index(value = ["source_id"]),
        Index(value = ["album"]),
        Index(value = ["artist"]),
        Index(value = ["folder_path"]),
    ],
)
data class TrackEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val uri: String,
    @ColumnInfo(name = "media_store_id") val mediaStoreId: Long? = null,
    @ColumnInfo(name = "source_id") val sourceId: Long? = null,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    /** MediaStore album id: shared artwork on Android 9 and album grouping. Since v2. */
    @ColumnInfo(name = "album_id") val albumId: Long? = null,
    @ColumnInfo(name = "album_artist") val albumArtist: String? = null,
    val genre: String? = null,
    val year: Int? = null,
    @ColumnInfo(name = "track_number") val trackNumber: Int? = null,
    @ColumnInfo(name = "disc_number") val discNumber: Int? = null,
    @ColumnInfo(name = "duration_ms") val durationMs: Long = 0,
    @ColumnInfo(name = "size_bytes") val sizeBytes: Long = 0,
    @ColumnInfo(name = "mime_type") val mimeType: String? = null,
    @ColumnInfo(name = "file_name") val fileName: String,
    /** Volume-relative folder, e.g. "Music/Album" (no trailing slash). */
    @ColumnInfo(name = "folder_path") val folderPath: String? = null,
    /** Epoch milliseconds. */
    @ColumnInfo(name = "date_added") val dateAdded: Long,
    /** Epoch milliseconds of the file's last change; artwork cache keys depend on it. */
    @ColumnInfo(name = "date_modified") val dateModified: Long,
    /** Normalised "title artist album" (see SearchText) for Unicode-aware search. */
    @ColumnInfo(name = "search_key") val searchKey: String,
    @ColumnInfo(name = "is_available", defaultValue = "1") val isAvailable: Boolean = true,
    @ColumnInfo(name = "missing_since") val missingSince: Long? = null,
)

@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String? = null,
    /** A picture the user chose (persisted SAF grant); null means the automatic cover. */
    @ColumnInfo(name = "cover_uri") val coverUri: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
    /** PlaylistSort.code of the playlist page; 0 = the user's own order. Since v4. */
    @ColumnInfo(name = "sort_order", defaultValue = "0") val sortOrder: Int = 0,
)

/**
 * Ordered playlist membership. Entries have their own id, so the same track may appear
 * twice: the UI adds a duplicate only after the user confirms it (stage 6 rule).
 */
@Entity(
    tableName = "playlist_entries",
    foreignKeys = [
        ForeignKey(
            entity = PlaylistEntity::class,
            parentColumns = ["id"],
            childColumns = ["playlist_id"],
            onDelete = ForeignKey.CASCADE,
        ),
        ForeignKey(
            entity = TrackEntity::class,
            parentColumns = ["id"],
            childColumns = ["track_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["playlist_id", "position"]),
        Index(value = ["track_id"]),
    ],
)
data class PlaylistEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "playlist_id") val playlistId: Long,
    @ColumnInfo(name = "track_id") val trackId: Long,
    val position: Int,
    @ColumnInfo(name = "added_at") val addedAt: Long,
)

/** One row of a track list: only what a row and its artwork need. */
data class TrackListItem(
    val id: Long,
    val uri: String,
    @ColumnInfo(name = "media_store_id") val mediaStoreId: Long?,
    @ColumnInfo(name = "album_id") val albumId: Long?,
    val title: String,
    val artist: String?,
    val album: String?,
    @ColumnInfo(name = "duration_ms") val durationMs: Long,
    @ColumnInfo(name = "size_bytes") val sizeBytes: Long,
    @ColumnInfo(name = "date_modified") val dateModified: Long,
    @ColumnInfo(name = "date_added") val dateAdded: Long,
    @ColumnInfo(name = "track_number") val trackNumber: Int?,
    @ColumnInfo(name = "disc_number") val discNumber: Int?,
)

/**
 * One start of a track (stage 4, "Recently played" on Home). Rows go with their track, and
 * the table is trimmed to the newest [PlayHistoryDao.KEEP] entries, so it never grows unbounded.
 */
@Entity(
    tableName = "play_history",
    foreignKeys = [
        ForeignKey(
            entity = TrackEntity::class,
            parentColumns = ["id"],
            childColumns = ["track_id"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["track_id"]), Index(value = ["played_at"])],
)
data class PlayHistoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "track_id") val trackId: Long,
    @ColumnInfo(name = "played_at") val playedAt: Long,
)

/** Identity facts used to spot the same file reached through MediaStore and a folder. */
data class TrackLocation(
    val id: Long,
    @ColumnInfo(name = "media_store_id") val mediaStoreId: Long?,
    @ColumnInfo(name = "source_id") val sourceId: Long?,
    @ColumnInfo(name = "folder_path") val folderPath: String?,
    @ColumnInfo(name = "file_name") val fileName: String,
    @ColumnInfo(name = "size_bytes") val sizeBytes: Long,
)

data class SourceSummary(
    @Embedded val source: LibrarySourceEntity,
    @ColumnInfo(name = "track_count") val trackCount: Int,
)

data class LibrarySummary(
    @ColumnInfo(name = "track_count") val trackCount: Int,
    @ColumnInfo(name = "total_duration_ms") val totalDurationMs: Long,
)

data class PlaylistSummary(
    @Embedded val playlist: PlaylistEntity,
    @ColumnInfo(name = "track_count") val trackCount: Int,
    @ColumnInfo(name = "total_duration_ms") val totalDurationMs: Long,
)

/** One row of a playlist page: the entry (its own id and order) and its track, available or not. */
data class PlaylistTrackRow(
    @ColumnInfo(name = "entry_id") val entryId: Long,
    @ColumnInfo(name = "entry_added_at") val entryAddedAt: Long,
    @ColumnInfo(name = "is_available") val isAvailable: Boolean,
    @Embedded val track: TrackListItem,
)

/** One of the first tracks of a playlist, for its automatic cover. */
data class PlaylistCoverTrack(
    @ColumnInfo(name = "playlist_id") val playlistId: Long,
    @Embedded val track: TrackListItem,
)

data class EntryPosition(val id: Long, val position: Int)

/** A track with the tags the library tabs group by (stage 7): albums, artists, genres, folders. */
data class BrowseTrack(
    @Embedded val track: TrackListItem,
    @ColumnInfo(name = "album_artist") val albumArtist: String?,
    val genre: String?,
    val year: Int?,
    @ColumnInfo(name = "folder_path") val folderPath: String?,
    @ColumnInfo(name = "search_key") val searchKey: String,
)
