package com.playly.player.playback

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.db.SQLITE_MAX_ARGS
import com.playly.player.data.db.TrackDao
import com.playly.player.data.db.TrackEntity

/**
 * The bridge between the library and the player. Controllers send only track ids
 * ([MediaItem.mediaId]); the service resolves them here, so a URI or tag edited since the list
 * was shown never plays stale, and other apps can only queue files that are in the library.
 */
class TrackMediaItems(private val tracks: TrackDao) {

    /** Playable items for [ids], same order, duplicates kept, missing or unavailable ones dropped. */
    suspend fun resolve(ids: List<Long>): List<MediaItem> {
        if (ids.isEmpty()) return emptyList()
        val byId = HashMap<Long, TrackEntity>(ids.size * 2)
        ids.distinct().chunked(SQLITE_MAX_ARGS).forEach { chunk ->
            tracks.byIds(chunk).forEach { if (it.isAvailable) byId[it.id] = it }
        }
        return ids.mapNotNull { id -> byId[id]?.let(::toMediaItem) }
    }

    companion object {
        /** A request item carries only the id; anything else is filled in by the service. */
        fun request(trackId: Long): MediaItem = MediaItem.Builder().setMediaId(trackId.toString()).build()

        fun trackId(item: MediaItem): Long? = item.mediaId.toLongOrNull()

        fun toMediaItem(track: TrackEntity): MediaItem {
            val metadata = MediaMetadata.Builder()
                .setTitle(track.title)
                .setArtist(track.artist)
                .setAlbumTitle(track.album)
                .setAlbumArtist(track.albumArtist)
                .setGenre(track.genre)
                .setTrackNumber(track.trackNumber)
                .setDiscNumber(track.discNumber)
                .setRecordingYear(track.year)
                .setDurationMs(track.durationMs.takeIf { it > 0 })
                .setArtworkUri(ArtworkUri.from(Artwork(track.uri, track.mediaStoreId, track.albumId, track.dateModified, track.sizeBytes)))
                .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                .setIsPlayable(true)
                .setIsBrowsable(false)
                .build()
            return MediaItem.Builder()
                .setMediaId(track.id.toString())
                .setUri(track.uri)
                .setMediaMetadata(metadata)
                .build()
        }
    }
}

/**
 * Artwork travels through the session as a private `playly-artwork:` URI. Only Playly's own
 * bitmap loader reads it (system surfaces receive the decoded bitmap), and the UI turns it back
 * into the same [Artwork] key the lists use, so covers come from the shared cache.
 */
object ArtworkUri {
    const val SCHEME = "playly-artwork"
    private const val P_URI = "u"
    private const val P_MEDIA_STORE = "m"
    private const val P_ALBUM = "a"
    private const val P_VERSION = "v"
    private const val P_SIZE = "s"

    fun from(artwork: Artwork): Uri = Uri.Builder()
        .scheme(SCHEME)
        .authority("track")
        .appendQueryParameter(P_URI, artwork.uri)
        .apply {
            artwork.mediaStoreId?.let { appendQueryParameter(P_MEDIA_STORE, it.toString()) }
            artwork.albumId?.let { appendQueryParameter(P_ALBUM, it.toString()) }
        }
        .appendQueryParameter(P_VERSION, artwork.version.toString())
        .appendQueryParameter(P_SIZE, artwork.sizeBytes.toString())
        .build()

    fun parse(uri: Uri?): Artwork? {
        if (uri == null || uri.scheme != SCHEME || uri.isOpaque) return null
        val fileUri = uri.getQueryParameter(P_URI) ?: return null
        return Artwork(
            uri = fileUri,
            mediaStoreId = uri.getQueryParameter(P_MEDIA_STORE)?.toLongOrNull(),
            albumId = uri.getQueryParameter(P_ALBUM)?.toLongOrNull(),
            version = uri.getQueryParameter(P_VERSION)?.toLongOrNull() ?: 0,
            sizeBytes = uri.getQueryParameter(P_SIZE)?.toLongOrNull() ?: 0,
        )
    }
}
