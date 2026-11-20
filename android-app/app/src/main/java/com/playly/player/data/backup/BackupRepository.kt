package com.playly.player.data.backup

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.playly.player.core.readNBytesCompat
import com.playly.player.data.db.FavoriteEntity
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SQLITE_MAX_ARGS
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.favorites.FavoritesRepository
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.data.playlists.PlaylistSort
import com.playly.player.data.settings.SettingsRepository
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException

/** Stage 9.2: what importing an M3U file did. */
data class PlaylistImport(val playlistId: Long, val name: String, val found: Int, val missing: Int)

/**
 * Stage 9.2: backups (playlists, favourites, settings) and M3U playlist files, read and
 * written through files the user picks in the system dialog. Restoring only adds: nothing
 * already in the app is deleted, playlists of the same name are merged.
 */
class BackupRepository(
    private val resolver: ContentResolver,
    private val database: PlaylyDatabase,
    private val settings: SettingsRepository,
    private val playlists: PlaylistRepository,
    private val favorites: FavoritesRepository,
    private val appVersion: String,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val tracks = database.trackDao()

    /** Writes a backup to [uri]; the number of playlists in it, or null when the file could not be written. */
    suspend fun exportBackup(uri: Uri): Int? = withContext(io) {
        guarded("export backup") {
            val roots = roots()
            val lists = playlists.allWithTracks()
            val favs = database.favoriteDao().all()
            val byId = rows(lists.flatMap { it.second } + favs.map { it.trackId })
            fun ref(id: Long) = byId[id]?.let { BackupTrack.of(it, roots[it.sourceId]) }
            val file = BackupFile(
                format = BackupFile.FORMAT,
                createdAt = clock(),
                appVersion = appVersion,
                settings = settings.exportBackup(),
                playlists = lists.map { (playlist, ids) ->
                    BackupPlaylist(playlist.name, playlist.description, playlist.sortOrder, playlist.createdAt, ids.mapNotNull(::ref))
                },
                favorites = favs.mapNotNull { fav -> ref(fav.trackId)?.let { BackupFavorite(it, fav.addedAt) } },
            )
            write(uri, BackupFile.json.encodeToString(BackupFile.serializer(), file))
            file.playlists.size
        }
    }

    suspend fun restoreBackup(uri: Uri): RestoreResult = withContext(io) {
        val text = guarded("read backup") { read(uri) } ?: return@withContext RestoreResult.Failed
        val file = try {
            BackupFile.json.decodeFromString(BackupFile.serializer(), text)
        } catch (e: SerializationException) {
            Log.i(TAG, "Not a backup: ${e.message}")
            return@withContext RestoreResult.NotABackup
        } catch (e: IllegalArgumentException) {
            Log.i(TAG, "Not a backup: ${e.message}")
            return@withContext RestoreResult.NotABackup
        }
        if (file.format != BackupFile.FORMAT || file.version > BackupFile.VERSION) return@withContext RestoreResult.NotABackup
        guarded("restore backup") { RestoreResult.Restored(restore(file)) } ?: RestoreResult.Failed
    }

    private suspend fun restore(file: BackupFile): RestoreReport {
        val matcher = TrackMatcher(library())
        var found = 0
        var missing = 0
        fun resolve(refs: List<BackupTrack>): List<Long> = refs.mapNotNull { ref ->
            matcher.match(ref.toRef())?.id.also { if (it == null) missing++ else found++ }
        }
        var created = 0
        var merged = 0
        for (playlist in file.playlists) {
            val ids = resolve(playlist.tracks)
            val result = playlists.restore(playlist.name, playlist.description, PlaylistSort.fromCode(playlist.sort), ids, merge = true)
                ?: continue
            if (result.created) created++ else if (result.added > 0) merged++
        }
        val favs = file.favorites.mapNotNull { fav ->
            val id = matcher.match(fav.track.toRef())?.id
            if (id == null) missing++ else found++
            id?.let { FavoriteEntity(it, fav.addedAt.takeIf { at -> at > 0 } ?: clock()) }
        }
        val favoritesAdded = favorites.restore(favs)
        val settingsRestored = settings.importBackup(file.settings)
        return RestoreReport(created, merged, found, missing, favoritesAdded, settingsRestored)
    }

    /** Writes the playlist as M3U8; the number of tracks written, or null on failure. */
    suspend fun exportPlaylist(playlistId: Long, name: String, uri: Uri): Int? = withContext(io) {
        guarded("export playlist") {
            val roots = roots()
            val ids = playlists.entryTrackIds(playlistId)
            val byId = rows(ids)
            val entries = ids.mapNotNull { id ->
                byId[id]?.let { M3uEntry(LibraryPaths.relative(it, roots[it.sourceId]), it.title, it.artist, it.durationMs) }
            }
            write(uri, M3u.write(name, entries))
            entries.size
        }
    }

    /** Makes a new playlist from an M3U / M3U8 file; null when the file could not be read. */
    suspend fun importPlaylist(uri: Uri): PlaylistImport? = withContext(io) {
        guarded("import playlist") {
            val bytes = readBytes(uri)
            val parsed = M3u.parse(M3u.decode(bytes))
            val matcher = TrackMatcher(library())
            val ids = parsed.entries.mapNotNull { matcher.match(it.toRef())?.id }
            val name = parsed.name ?: displayName(uri)?.substringBeforeLast('.')?.takeIf { it.isNotBlank() } ?: DEFAULT_NAME
            val result = playlists.restore(name, null, PlaylistSort.Manual, ids, merge = false) ?: return@guarded null
            PlaylistImport(result.id, name, ids.size, parsed.entries.size - ids.size)
        }
    }

    private suspend fun library(): List<TrackEntity> = tracks.availableTracks()

    private suspend fun roots(): Map<Long, String> = database.librarySourceDao().all().associate { it.id to LibraryPaths.rootOf(it) }

    private suspend fun rows(ids: Collection<Long>): Map<Long, TrackEntity> =
        ids.distinct().chunked(SQLITE_MAX_ARGS).flatMap { tracks.byIds(it) }.associateBy { it.id }

    private fun write(uri: Uri, text: String) {
        // "wt" truncates: a shorter backup over an older file leaves no tail behind.
        val out = resolver.openOutputStream(uri, "wt") ?: throw IOException("No output for $uri")
        out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
    }

    private fun read(uri: Uri): String = readBytes(uri).toString(Charsets.UTF_8).removePrefix("\uFEFF")

    private fun readBytes(uri: Uri): ByteArray {
        val input = resolver.openInputStream(uri) ?: throw IOException("No input for $uri")
        return input.use { stream ->
            val bytes = stream.readNBytesCompat(MAX_FILE_BYTES + 1)
            if (bytes.size > MAX_FILE_BYTES) throw IOException("File too large")
            bytes
        }
    }

    private fun displayName(uri: Uri): String? = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    /** Files from other apps fail in many ways (revoked, deleted, provider crash); none may crash Playly. */
    private suspend fun <T> guarded(what: String, block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "Cannot $what", e)
        null
    }

    private companion object {
        const val TAG = "PlaylyBackup"
        /** Far above any real backup (10k tracks ≈ 3 MB); stops a wrong pick from filling memory. */
        const val MAX_FILE_BYTES = 32 * 1024 * 1024
        const val DEFAULT_NAME = "Playlist"
    }
}
