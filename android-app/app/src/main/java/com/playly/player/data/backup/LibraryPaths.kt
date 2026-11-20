package com.playly.player.data.backup

import android.provider.DocumentsContract
import androidx.core.net.toUri
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.TrackEntity

/**
 * Stage 9.2: where a track sits inside the music folder ("Rock/Album/01.mp3"). Backups and M3U
 * files store this, so they still work after the folder is picked again on another phone.
 */
object LibraryPaths {
    private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

    /** The folder's own path as the scanner stores track folders ("Music/Stage7"). */
    fun rootOf(source: LibrarySourceEntity): String {
        val uri = source.treeUri.toUri()
        if (uri.authority == EXTERNAL_STORAGE_AUTHORITY) {
            val id = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
            if (id != null && ':' in id) return id.substringAfter(':').trim('/')
        }
        return source.displayName.trim('/')
    }

    /** [track]'s path below [root]; the full stored path when it is not under it. */
    fun relative(track: TrackEntity, root: String?): String {
        val folder = track.folderPath?.trim('/').orEmpty()
        val full = if (folder.isEmpty()) track.fileName else "$folder/${track.fileName}"
        if (root.isNullOrEmpty()) return full
        return if (full.startsWith("$root/")) full.removePrefix("$root/") else full
    }
}
