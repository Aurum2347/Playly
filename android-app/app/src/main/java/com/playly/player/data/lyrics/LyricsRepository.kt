package com.playly.player.data.lyrics

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import android.util.LruCache
import androidx.core.net.toUri
import com.playly.player.core.readNBytesCompat
import com.playly.player.data.library.LibraryRepository
import java.io.FileInputStream
import java.io.FileNotFoundException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A track's text, by the desktop's rule (spec §13): first "<name>.lrc" next to the file, then
 * the tag inside the file. Works offline; a broken file or tag only means "no text".
 */
class LyricsRepository(context: Context, private val library: LibraryRepository) {
    private val resolver = context.contentResolver

    /** Found texts only: a missing one is looked for again, so a new .lrc shows up. */
    private val cache = LruCache<String, FoundLyrics>(CACHE_SIZE)

    suspend fun load(trackId: Long): FoundLyrics? = withContext(Dispatchers.IO) {
        val track = library.track(trackId) ?: return@withContext null
        val key = "${track.id}:${track.dateModified}"
        cache.get(key)?.let { return@withContext it }
        val uri = track.uri.toUri()
        val found = sidecar(uri) ?: embedded(uri)
        if (found != null) cache.put(key, found)
        found
    }

    private fun sidecar(uri: Uri): FoundLyrics? {
        // Folder documents on internal storage and SD cards carry the path in their id.
        if (uri.authority != EXTERNAL_STORAGE) return null
        val (treeId, documentId) = runCatching {
            DocumentsContract.getTreeDocumentId(uri) to DocumentsContract.getDocumentId(uri)
        }.getOrNull() ?: return null
        val tree = DocumentsContract.buildTreeDocumentUri(EXTERNAL_STORAGE, treeId)
        for (id in LyricsFiles.sidecarIds(documentId)) {
            val lrc = DocumentsContract.buildDocumentUriUsingTree(tree, id)
            val bytes = try {
                resolver.openInputStream(lrc)?.use { it.readNBytesCompat(LyricsFiles.MAX_BYTES) }
            } catch (_: FileNotFoundException) {
                null
            } catch (_: IllegalArgumentException) {
                // How the storage provider reports a missing file inside the folder.
                null
            } catch (e: Exception) {
                Log.w(TAG, "Cannot read $lrc", e)
                null
            } ?: continue
            val lyrics = LrcParser.parse(LyricsText.decode(bytes)) ?: continue
            return FoundLyrics(lyrics, LyricsOrigin.File)
        }
        return null
    }

    private fun embedded(uri: Uri): FoundLyrics? {
        val raw = try {
            resolver.openFileDescriptor(uri, "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).channel.use { EmbeddedLyrics.read(it) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Cannot read tags of $uri", e)
            null
        } ?: return null
        val lyrics = LrcParser.parse(raw) ?: return null
        return FoundLyrics(lyrics, LyricsOrigin.Tag)
    }

    private companion object {
        const val TAG = "PlaylyLyrics"
        const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
        const val CACHE_SIZE = 16
    }
}
