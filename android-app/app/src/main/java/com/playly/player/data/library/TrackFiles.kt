package com.playly.player.data.library

import android.content.ContentResolver
import android.provider.DocumentsContract
import android.util.Log
import androidx.core.net.toUri
import com.playly.player.data.db.TrackEntity
import java.io.FileNotFoundException
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

/** What "Delete from disk" did. [deleted] rows are gone from the library as well. */
data class DeleteResult(val deleted: List<Long>, val noAccess: Int, val failed: Int) {
    val requested: Int get() = deleted.size + noAccess + failed
}

/**
 * Files of the music folder (stage 8.4): deleting them through the folder grant and hashing
 * their contents for duplicate search. The library is a SAF folder, so files go through
 * [DocumentsContract], not MediaStore (whose delete request only covers its own rows).
 */
class TrackFiles(
    private val resolver: ContentResolver,
    private val library: LibraryRepository,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    /** Whether "Delete file" is offered for [track]: a file of the music folder that is there now. */
    fun canDelete(track: TrackEntity): Boolean = track.isAvailable && track.sourceId != null

    /**
     * Deletes the files of [trackIds] for good (there is no trash in SAF), then forgets their
     * rows: playlists, favourites and history lose them. A file that is already gone counts as
     * deleted. Files of a folder granted for reading only are left alone ([DeleteResult.noAccess]).
     */
    suspend fun delete(trackIds: Collection<Long>): DeleteResult = withContext(io) {
        val deleted = ArrayList<Long>()
        var noAccess = 0
        var failed = 0
        val writable = HashMap<Long, Boolean>()
        for (id in trackIds.distinct()) {
            coroutineContext.ensureActive()
            val track = library.track(id)
            if (track == null) {
                // Already gone from the library: nothing left to delete.
                continue
            }
            val sourceId = track.sourceId
            val canWrite = sourceId != null && writable.getOrPut(sourceId) {
                library.source(sourceId)?.let(library::canWrite) == true
            }
            if (!canWrite) {
                noAccess++
                continue
            }
            when (deleteDocument(track)) {
                Outcome.Deleted -> deleted += id
                Outcome.NoAccess -> noAccess++
                Outcome.Failed -> failed++
            }
        }
        if (deleted.isNotEmpty()) library.forgetTracks(deleted)
        DeleteResult(deleted, noAccess, failed)
    }

    private enum class Outcome { Deleted, NoAccess, Failed }

    private fun deleteDocument(track: TrackEntity): Outcome = try {
        if (DocumentsContract.deleteDocument(resolver, track.uri.toUri())) Outcome.Deleted else Outcome.Failed
    } catch (_: FileNotFoundException) {
        Outcome.Deleted
    } catch (e: SecurityException) {
        Log.w(TAG, "No access to delete ${track.fileName}", e)
        Outcome.NoAccess
    } catch (e: IllegalArgumentException) {
        // The externalstorage provider reports a missing document this way.
        if (fileExists(track)) {
            Log.w(TAG, "Deleting ${track.fileName} failed", e)
            Outcome.Failed
        } else {
            Outcome.Deleted
        }
    } catch (e: Exception) {
        Log.w(TAG, "Deleting ${track.fileName} failed", e)
        Outcome.Failed
    }

    private fun fileExists(track: TrackEntity): Boolean = runCatching {
        resolver.query(track.uri.toUri(), arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
            ?.use { it.moveToFirst() } == true
    }.getOrDefault(false)

    /**
     * Content fingerprint: byte count plus SHA-256 of every byte, so equal fingerprints mean
     * equal files (the desktop hashes the whole file too). Null when the file cannot be read.
     */
    suspend fun fingerprint(track: TrackEntity): String? = withContext(io) {
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            val stream = resolver.openInputStream(track.uri.toUri()) ?: return@withContext null
            stream.use { input ->
                val buffer = ByteArray(BUFFER)
                while (true) {
                    coroutineContext.ensureActive()
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                    total += read
                }
            }
            total.toString(16) + "-" + digest.digest().joinToString("") { "%02x".format(it) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.i(TAG, "Cannot hash ${track.fileName}: ${e.message}")
            null
        }
    }

    private companion object {
        const val TAG = "PlaylyFiles"
        const val BUFFER = 64 * 1024
    }
}
