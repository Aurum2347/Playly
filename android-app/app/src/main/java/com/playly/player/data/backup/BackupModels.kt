package com.playly.player.data.backup

import com.playly.player.data.db.TrackEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Stage 9.2: the backup file. Plain JSON, so it can be read and kept anywhere; tracks are
 * named by path and tags, never by database id. Covers picked for playlists are not included:
 * the permission to read them does not move to another install.
 */
@Serializable
data class BackupFile(
    /** No default: a JSON file without it is not a Playly backup and must not decode as one. */
    val format: String,
    val version: Int = VERSION,
    val createdAt: Long = 0,
    val appVersion: String? = null,
    val settings: Map<String, JsonElement> = emptyMap(),
    val playlists: List<BackupPlaylist> = emptyList(),
    val favorites: List<BackupFavorite> = emptyList(),
) {
    companion object {
        const val FORMAT = "playly-android-backup"
        const val VERSION = 1

        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            prettyPrint = true
            explicitNulls = false
        }
    }
}

@Serializable
data class BackupTrack(
    val path: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val durationMs: Long = 0,
    val sizeBytes: Long = 0,
) {
    fun toRef() = TrackRef(path, title, artist, durationMs, sizeBytes)

    companion object {
        fun of(track: TrackEntity, root: String?) = BackupTrack(
            path = LibraryPaths.relative(track, root),
            title = track.title,
            artist = track.artist,
            durationMs = track.durationMs,
            sizeBytes = track.sizeBytes,
        )
    }
}

@Serializable
data class BackupPlaylist(
    val name: String,
    val description: String? = null,
    /** PlaylistSort.code */
    val sort: Int = 0,
    val createdAt: Long = 0,
    val tracks: List<BackupTrack> = emptyList(),
)

@Serializable
data class BackupFavorite(val track: BackupTrack, val addedAt: Long = 0)

/** What a restore did, for the message after it. */
data class RestoreReport(
    val playlistsCreated: Int = 0,
    val playlistsMerged: Int = 0,
    val tracksFound: Int = 0,
    val tracksMissing: Int = 0,
    val favoritesAdded: Int = 0,
    val settingsRestored: Int = 0,
)

sealed interface RestoreResult {
    data class Restored(val report: RestoreReport) : RestoreResult
    /** Not JSON, another app's file, or a newer format this version cannot read. */
    data object NotABackup : RestoreResult
    data object Failed : RestoreResult
}
