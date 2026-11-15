package com.playly.player.data.library.scan

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Log
import androidx.core.net.toUri
import com.playly.player.core.SearchText
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.TrackEntity
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

sealed interface FolderScanResult {
    /** [unreadable] counts audio-looking files whose tags or duration could not be read. */
    data class Found(val tracks: List<TrackEntity>, val unreadable: Int) : FolderScanResult
    /** The grant was revoked, or the volume (SD card, USB drive) is not mounted. */
    data object Inaccessible : FolderScanResult
}

/**
 * Walks a folder granted through the Storage Access Framework. Files whose size and modification
 * time are unchanged reuse the stored row; only new or changed files are opened to read tags.
 */
class FolderScanner(private val context: Context) {
    private val resolver = context.contentResolver

    private class Entry(val documentId: String, val name: String, val mime: String?, val size: Long, val modified: Long)

    /**
     * @param known stored rows for this folder, by document URI.
     * @param now first-seen time for new files.
     */
    suspend fun scan(
        source: LibrarySourceEntity,
        known: Map<String, TrackEntity>,
        now: Long,
        onProgress: (Int) -> Unit,
    ): FolderScanResult {
        val treeUri = source.treeUri.toUri()
        val granted = resolver.persistedUriPermissions.any { it.uri == treeUri && it.isReadPermission }
        if (!granted) return FolderScanResult.Inaccessible
        val rootId = runCatching { DocumentsContract.getTreeDocumentId(treeUri) }.getOrNull()
            ?: return FolderScanResult.Inaccessible
        // External storage ids carry the real path ("primary:Music/x.mp3"), which lets
        // a folder file and its MediaStore twin be recognised as one track.
        val externalStorage = treeUri.authority == EXTERNAL_STORAGE_AUTHORITY

        val coroutine = currentCoroutineContext()
        val tracks = ArrayList<TrackEntity>()
        var unreadable = 0
        // Iterative walk: deep trees cannot overflow the stack.
        val pending = ArrayDeque<Pair<String, String>>() // documentId to display path
        pending += rootId to source.displayName
        var first = true
        while (pending.isNotEmpty()) {
            coroutine.ensureActive()
            val (dirId, dirPath) = pending.removeLast()
            val children = list(treeUri, dirId)
            if (children == null) {
                // The root itself failing means the folder is gone; a subfolder failing is skipped.
                if (first) return FolderScanResult.Inaccessible
                continue
            }
            val isRoot = first
            first = false
            // Like MediaStore, honour ".nomedia" below the folder the user picked explicitly.
            if (!isRoot && children.any { it.name == NO_MEDIA }) continue
            for (child in children) {
                if (child.mime == Document.MIME_TYPE_DIR) {
                    if (!child.name.startsWith('.')) pending += child.documentId to "$dirPath/${child.name}"
                    continue
                }
                if (!MetadataParsing.isAudioFile(child.name, child.mime)) continue
                val uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, child.documentId)
                val folder = if (externalStorage) MetadataParsing.folderFromExternalDocumentId(child.documentId) else dirPath
                val stored = known[uri.toString()]
                val track = if (stored != null && stored.sizeBytes == child.size && stored.dateModified == child.modified) {
                    stored.copy(sourceId = source.id, folderPath = folder ?: stored.folderPath)
                } else {
                    read(uri, child, folder ?: dirPath, source.id, now)
                }
                if (track == null) unreadable++ else tracks += track
                if ((tracks.size + unreadable) % PROGRESS_STEP == 0) onProgress(tracks.size)
            }
        }
        onProgress(tracks.size)
        return FolderScanResult.Found(tracks, unreadable)
    }

    private fun list(treeUri: Uri, parentId: String): List<Entry>? {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        val projection = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
        )
        return try {
            resolver.query(childrenUri, projection, null, null, null)?.use { c ->
                buildList(c.count.coerceAtLeast(0)) {
                    while (c.moveToNext()) {
                        val id = c.getString(0) ?: continue
                        add(
                            Entry(
                                documentId = id,
                                name = c.getString(1) ?: id.substringAfterLast('/'),
                                mime = c.getString(2),
                                size = if (c.isNull(3)) 0 else c.getLong(3),
                                modified = if (c.isNull(4)) 0 else c.getLong(4),
                            ),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            // SecurityException (revoked), IllegalArgumentException / FileNotFound (unmounted).
            Log.w(TAG, "Cannot list $childrenUri", e)
            null
        }
    }

    /** Reads tags and duration. Null for files the platform cannot parse (corrupt or not audio). */
    private fun read(uri: Uri, entry: Entry, folder: String, sourceId: Long, now: Long): TrackEntity? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            fun tag(key: Int) = MetadataParsing.cleanTag(retriever.extractMetadata(key))
            val duration = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0
            val hasAudio = tag(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)
            if (duration <= 0 && hasAudio != "yes") return null
            val title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE) ?: MetadataParsing.titleFromFileName(entry.name)
            val artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST)
            val album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM)
            TrackEntity(
                uri = uri.toString(),
                sourceId = sourceId,
                title = title,
                artist = artist,
                album = album,
                albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
                genre = tag(MediaMetadataRetriever.METADATA_KEY_GENRE),
                year = MetadataParsing.parseYear(tag(MediaMetadataRetriever.METADATA_KEY_YEAR))
                    ?: MetadataParsing.parseYear(tag(MediaMetadataRetriever.METADATA_KEY_DATE)),
                trackNumber = MetadataParsing.parseNumber(tag(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)),
                discNumber = MetadataParsing.parseNumber(tag(MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)),
                durationMs = duration,
                sizeBytes = entry.size,
                mimeType = entry.mime ?: tag(MediaMetadataRetriever.METADATA_KEY_MIMETYPE),
                fileName = entry.name,
                folderPath = folder,
                dateAdded = now,
                dateModified = entry.modified,
                searchKey = SearchText.key(title, artist, album),
            )
        } catch (e: Exception) {
            // IllegalArgumentException / RuntimeException from the extractor: a damaged or
            // unsupported file is skipped, it never stops the scan.
            Log.i(TAG, "Unreadable audio file ${entry.name}: ${e.message}")
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private companion object {
        const val TAG = "PlaylyFolderScan"
        const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
        const val NO_MEDIA = ".nomedia"
        const val PROGRESS_STEP = 50
    }
}
