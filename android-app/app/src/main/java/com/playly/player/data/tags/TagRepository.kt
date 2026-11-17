package com.playly.player.data.tags

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.core.net.toUri
import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.LibraryRepository
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface TagSaveResult {
    data class Saved(val track: TrackEntity) : TagSaveResult
    /** The format (or this variant of it) is not written; the file is unchanged. */
    data object Unsupported : TagSaveResult
    /** The file is not what its name says or is broken; unchanged. */
    data object Damaged : TagSaveResult
    /** The folder was granted for reading only (picked before stage 8.4): pick it again. */
    data object NoWriteAccess : TagSaveResult
    /** The file is gone or the track left the library. */
    data object Missing : TagSaveResult
    /** Reading or writing failed midway; the original was put back. */
    data object Failed : TagSaveResult
}

/**
 * Tag editing (stage 8.4), like the desktop's write_track_tags: the file is copied to the
 * cache, rewritten there, checked by reading the tags back, and only then written over the
 * original through the folder grant. If that last write fails, the original bytes go back.
 */
class TagRepository(
    context: Context,
    private val library: LibraryRepository,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val resolver: ContentResolver = context.contentResolver
    private val workDir = File(context.cacheDir, "tag-edit")
    private val mutex = Mutex()

    /** Whether "Edit tags" is offered for [track]: a supported format in the music folder. */
    fun canEdit(track: TrackEntity): Boolean =
        track.isAvailable && track.sourceId != null && TagFormat.of(track.fileName, track.mimeType) != null

    suspend fun save(trackId: Long, edit: TagEdit): TagSaveResult = withContext(io) {
        mutex.withLock {
            val track = library.track(trackId)?.takeIf { it.isAvailable } ?: return@withLock TagSaveResult.Missing
            val format = TagFormat.of(track.fileName, track.mimeType) ?: return@withLock TagSaveResult.Unsupported
            val source = track.sourceId?.let { library.source(it) } ?: return@withLock TagSaveResult.NoWriteAccess
            if (!library.canWrite(source)) return@withLock TagSaveResult.NoWriteAccess
            val clean = edit.cleaned()
            require(clean.isValid) { "Title must not be blank" }
            workDir.mkdirs()
            val original = File(workDir, "original")
            val edited = File(workDir, "edited")
            try {
                rewrite(track, format, clean, original, edited).also { result ->
                    // The library shows the new tags at once; the next scan sees the same size and time and keeps them.
                    if (result is TagSaveResult.Saved) library.updateTrack(result.track)
                }
            } finally {
                original.delete()
                edited.delete()
            }
        }
    }

    private fun rewrite(track: TrackEntity, format: TagFormat, edit: TagEdit, original: File, edited: File): TagSaveResult {
        val uri = track.uri.toUri()
        try {
            val input = resolver.openInputStream(uri) ?: return TagSaveResult.Missing
            input.use { s -> original.outputStream().use { s.copyTo(it, BUFFER) } }
        } catch (_: FileNotFoundException) {
            return TagSaveResult.Missing
        } catch (e: Exception) {
            // SecurityException (grant gone), IllegalArgumentException (volume gone), IOException.
            Log.w(TAG, "Cannot read ${track.fileName}", e)
            return TagSaveResult.Missing
        }
        try {
            TagWriter.rewrite(original, edited, format, edit)
        } catch (e: TagWriteException) {
            Log.i(TAG, "Not rewriting ${track.fileName}: ${e.message}")
            return if (e.reason == TagWriteException.Reason.Unsupported) TagSaveResult.Unsupported else TagSaveResult.Damaged
        }
        // Belt and braces: the new file must read back exactly as edited before it replaces anything.
        val verified = runCatching { TagReader.matches(edited, format, edit) }.getOrDefault(false)
        if (!verified) {
            Log.w(TAG, "Rewritten ${track.fileName} does not read back; original kept")
            return TagSaveResult.Damaged
        }
        try {
            writeOver(uri, edited)
        } catch (e: SecurityException) {
            Log.w(TAG, "No write access to ${track.fileName}", e)
            return TagSaveResult.NoWriteAccess
        } catch (e: Exception) {
            Log.w(TAG, "Writing ${track.fileName} failed; restoring the original", e)
            runCatching { writeOver(uri, original) }.onFailure { Log.e(TAG, "Restoring ${track.fileName} failed", it) }
            return TagSaveResult.Failed
        }
        return TagSaveResult.Saved(updatedRow(track, edit, uri, edited.length()))
    }

    /** Truncates and rewrites the document, then syncs it to storage. */
    private fun writeOver(uri: Uri, from: File) {
        val pfd = resolver.openFileDescriptor(uri, "rwt") ?: throw IOException("No descriptor for $uri")
        pfd.use {
            FileOutputStream(it.fileDescriptor).use { out ->
                from.inputStream().use { s -> s.copyTo(out, BUFFER) }
                out.flush()
                runCatching { out.fd.sync() }
            }
        }
    }

    /** The row with the new tags and the file's new size and time, so the next scan reuses it. */
    private fun updatedRow(track: TrackEntity, edit: TagEdit, uri: Uri, length: Long): TrackEntity {
        val (size, modified) = runCatching {
            resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getLong(0) to c.getLong(1) else null }
        }.getOrNull() ?: (length to clock())
        val artist = edit.artist.ifBlank { null }
        val album = edit.album.ifBlank { null }
        return track.copy(
            title = edit.title,
            artist = artist,
            album = album,
            genre = edit.genre.ifBlank { null },
            searchKey = SearchText.key(edit.title, artist, album),
            sizeBytes = size,
            dateModified = modified,
        )
    }

    private companion object {
        const val TAG = "PlaylyTags"
        const val BUFFER = 64 * 1024
    }
}
