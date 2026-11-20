package com.playly.player.ui.screens.playlists

import android.net.Uri
import com.playly.player.R
import com.playly.player.data.backup.BackupRepository
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.playback.QueueAddResult
import com.playly.player.ui.UiMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * Whole-playlist actions shared by the Playlists tab and a playlist's page, so both menus do
 * exactly the same thing. Results go to [send] (the screen's snackbar).
 */
class PlaylistCommands(
    private val playlists: PlaylistRepository,
    private val playback: PlaybackController,
    private val backup: BackupRepository,
    private val scope: CoroutineScope,
    private val send: suspend (UiMessage) -> Unit,
) {
    /** "Play" from the top or "Shuffle" from a random track, in the page's order; gone files are left out. */
    fun play(id: Long, name: String, shuffle: Boolean, onStarted: () -> Unit = {}) {
        scope.launch {
            val ids = playlists.playableTrackIds(id)
            if (ids.isEmpty()) {
                send(UiMessage(R.string.playlist_all_unavailable))
                return@launch
            }
            val start = if (shuffle) Random.nextInt(ids.size) else 0
            playback.playTracks(ids, start, shuffle = shuffle, source = source(name))
            onStarted()
        }
    }

    /** Every playable track of the playlist goes to the end of the user's queue. */
    fun addToQueue(id: Long, playNext: Boolean = false) {
        scope.launch {
            val ids = playlists.playableTrackIds(id)
            if (ids.isEmpty()) {
                send(UiMessage(R.string.playlist_all_unavailable))
                return@launch
            }
            val message = when (val result = playback.addToQueue(ids, playNext)) {
                is QueueAddResult.Added -> if (result.started) {
                    UiMessage(R.string.queue_message_started)
                } else {
                    UiMessage(R.plurals.queue_message_added_many, listOf(result.count), quantity = result.count)
                }
                QueueAddResult.Unavailable -> UiMessage(R.string.queue_message_unavailable)
                QueueAddResult.Failed -> UiMessage(R.string.queue_message_failed)
            }
            send(message)
        }
    }

    fun create(name: String, onCreated: (Long) -> Unit = {}) {
        scope.launch {
            val id = playlists.create(name) ?: return@launch
            send(UiMessage(R.string.playlist_message_created, listOf(name.trim())))
            onCreated(id)
        }
    }

    fun edit(id: Long, name: String, description: String?) {
        scope.launch { playlists.updateDetails(id, name, description) }
    }

    /** A picture from the system picker, or null for the automatic cover. */
    fun setCover(id: Long, uri: Uri?) {
        scope.launch {
            if (!playlists.setCover(id, uri)) send(UiMessage(R.string.playlist_message_cover_failed))
        }
    }

    /** Deletes after the user confirmed; tracks and files stay. */
    fun delete(id: Long, name: String) {
        scope.launch {
            playlists.delete(id)
            send(UiMessage(R.string.playlist_message_deleted, listOf(name)))
        }
    }

    /** Stage 9.2: writes the playlist to [uri] (picked in "save as") as M3U8. */
    fun export(id: Long, name: String, uri: Uri) {
        scope.launch {
            val count = backup.exportPlaylist(id, name, uri)
            send(
                if (count == null) {
                    UiMessage(R.string.playlist_message_export_failed)
                } else {
                    UiMessage(R.plurals.playlist_message_exported, listOf(count, name), quantity = count)
                },
            )
        }
    }

    /** Stage 9.2: a new playlist from an M3U / M3U8 file, then [onImported] opens it. */
    fun import(uri: Uri, onImported: (Long) -> Unit = {}) {
        scope.launch {
            val result = backup.importPlaylist(uri)
            if (result == null) {
                send(UiMessage(R.string.playlist_message_import_failed))
                return@launch
            }
            send(
                if (result.missing == 0) {
                    UiMessage(R.plurals.playlist_message_imported, listOf(result.found, result.name), quantity = result.found)
                } else {
                    UiMessage(R.string.playlist_message_imported_partly, listOf(result.name, result.found, result.missing))
                },
            )
            onImported(result.playlistId)
        }
    }

    companion object {
        fun source(name: String) = PlaybackSource(PlaybackSource.Kind.Playlist, name)

        /** "Rock.m3u8"; characters that file systems refuse become "_". */
        fun exportFileName(name: String): String =
            name.map { if (it in FORBIDDEN || it.isISOControl()) '_' else it }.joinToString("").trim().ifEmpty { "playlist" } + ".m3u8"

        private const val FORBIDDEN = "\\/:*?\"<>|"
        const val M3U_MIME = "audio/x-mpegurl"

        /** File managers give .m3u / .m3u8 many types; the content is what counts. */
        val M3U_OPEN_MIMES = arrayOf(
            "audio/x-mpegurl", "audio/mpegurl", "application/vnd.apple.mpegurl", "application/x-mpegurl",
            "text/plain", "application/octet-stream",
        )
    }
}
