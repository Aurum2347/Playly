package com.playly.player.data.artwork

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.os.Build
import android.util.Size
import androidx.core.graphics.scale
import androidx.core.net.toUri
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.disk.DiskCache
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.fetch.SourceFetchResult
import coil3.key.Keyer
import coil3.memory.MemoryCache
import coil3.request.Options
import coil3.size.pxOrElse
import com.playly.player.data.db.TrackListItem
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okio.Path.Companion.toOkioPath
import okio.buffer

/**
 * What identifies a track's artwork. [version] (file modification time) and [sizeBytes]
 * are part of the key, so edited tags or a replaced file never show a stale cover.
 */
data class Artwork(
    val uri: String,
    val mediaStoreId: Long?,
    val albumId: Long?,
    val version: Long,
    val sizeBytes: Long,
)

fun TrackListItem.artwork() = Artwork(uri, mediaStoreId, albumId, dateModified, sizeBytes)

/** The track has no cover; the UI keeps the Playly placeholder. */
class NoArtworkException : IOException("No artwork")

private class ArtworkKeyer : Keyer<Artwork> {
    override fun key(data: Artwork, options: Options): String = "${data.uri}#${data.version}#${data.sizeBytes}"
}

/**
 * Extracts a cover once, stores a small JPEG in Coil's size-limited disk cache and serves it
 * from there afterwards. "No cover" is cached too (an empty entry), so scrolling past
 * thousands of tracks without art does not reopen every file.
 */
private class ArtworkFetcher(
    private val data: Artwork,
    private val options: Options,
    private val context: Context,
    private val diskCache: DiskCache?,
) : Fetcher {

    override suspend fun fetch(): FetchResult {
        val requested = options.size.width.pxOrElse { LARGE }
        val edge = when {
            requested <= SMALL -> SMALL
            requested <= MEDIUM -> MEDIUM
            else -> LARGE
        }
        val key = "artwork/v1/$edge/${data.uri}#${data.version}#${data.sizeBytes}"
        val cache = diskCache

        cache?.openSnapshot(key)?.let { snapshot ->
            if (cache.fileSystem.metadata(snapshot.data).size == 0L) {
                snapshot.close()
                throw NoArtworkException()
            }
            return SourceFetchResult(
                source = ImageSource(snapshot.data, cache.fileSystem, key, snapshot),
                mimeType = "image/jpeg",
                dataSource = DataSource.DISK,
            )
        }

        // Access errors propagate (and are not cached): a regranted folder shows its covers again.
        val bitmap = extract(edge)
        cache?.openEditor(key)?.let { editor ->
            try {
                cache.fileSystem.sink(editor.data).buffer().use { sink ->
                    bitmap?.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, sink.outputStream())
                }
                editor.commit()
            } catch (e: Exception) {
                editor.abort()
            }
        }
        bitmap ?: throw NoArtworkException()
        return ImageFetchResult(image = bitmap.asImage(), isSampled = true, dataSource = DataSource.DISK)
    }

    /** Null means "this file has no cover". */
    private fun extract(edge: Int): Bitmap? {
        val uri = data.uri.toUri()
        if (data.mediaStoreId != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // The system thumbnailer reads embedded art and folder images, and caches the result.
            return try {
                context.contentResolver.loadThumbnail(uri, Size(edge, edge), null).fitInto(edge)
            } catch (_: IOException) {
                null
            }
        }
        if (data.mediaStoreId != null && data.albumId != null) {
            // Android 9: MediaStore's album art table.
            val albumArt = ContentUris.withAppendedId(ALBUM_ART_URI.toUri(), data.albumId)
            val fromAlbum = runCatching {
                context.contentResolver.openInputStream(albumArt)?.use { it.readBytes() }
            }.getOrNull()
            fromAlbum?.let { decodeSampled(it, edge) }?.let { return it }
        }
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.embeddedPicture?.let { decodeSampled(it, edge) }
        } catch (e: RuntimeException) {
            // A damaged file: treat as "no cover" rather than retrying on every scroll.
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun decodeSampled(bytes: ByteArray, edge: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= edge && bounds.outHeight / (sample * 2) >= edge) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        return decoded?.fitInto(edge)
    }

    private fun Bitmap.fitInto(edge: Int): Bitmap {
        val longest = maxOf(width, height)
        if (longest <= edge) return this
        val factor = edge.toFloat() / longest
        return scale((width * factor).toInt().coerceAtLeast(1), (height * factor).toInt().coerceAtLeast(1))
    }

    class Factory(private val context: Context) : Fetcher.Factory<Artwork> {
        override fun create(data: Artwork, options: Options, imageLoader: ImageLoader): Fetcher =
            ArtworkFetcher(data, options, context, imageLoader.diskCache)
    }

    private companion object {
        /** List rows and cards (52dp at 4x density ≈ 208px). */
        const val SMALL = 256
        /** Home cards (~140dp). */
        const val MEDIUM = 512
        /** Full-screen player. */
        const val LARGE = 1024
        const val JPEG_QUALITY = 88
        const val ALBUM_ART_URI = "content://media/external/audio/albumart"
    }
}

object ArtworkImageLoader {
    /** Decimal, as Android shows sizes: Settings reads "of 100 MB". */
    const val DISK_CACHE_BYTES = 100L * 1000 * 1000
    private const val MEMORY_CACHE_FRACTION = 0.15
    /** Cover extraction opens files; a few at a time keeps scrolling smooth without thrashing I/O. */
    private const val PARALLEL_EXTRACTIONS = 4

    fun directory(context: Context): File = context.cacheDir.resolve("artwork")

    fun create(context: Context): ImageLoader = ImageLoader.Builder(context)
        .components {
            add(ArtworkKeyer())
            add(ArtworkFetcher.Factory(context.applicationContext))
        }
        .memoryCache { MemoryCache.Builder().maxSizePercent(context, MEMORY_CACHE_FRACTION).build() }
        .diskCache {
            DiskCache.Builder()
                .directory(directory(context).toOkioPath())
                .maxSizeBytes(DISK_CACHE_BYTES)
                .build()
        }
        .fetcherCoroutineContext(Dispatchers.IO.limitedParallelism(PARALLEL_EXTRACTIONS))
        .build()
}

/**
 * Stage 9.2: "Cover cache" in Settings. Holds only resized copies of covers (the folder Coil
 * writes to); clearing it never touches music files, they are read again when needed.
 */
class CoverCache(private val context: Context) {
    private val loader get() = SingletonImageLoader.get(context)

    /**
     * Counted from the files, as the system storage screen does, without Coil's small journal
     * (an emptied cache reads 0).
     */
    suspend fun sizeBytes(): Long = withContext(Dispatchers.IO) {
        ArtworkImageLoader.directory(context).walkBottomUp().filter { it.isFile && !it.name.startsWith(JOURNAL) }.sumOf { it.length() }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        loader.memoryCache?.clear()
        loader.diskCache?.clear()
        // Leftovers Coil does not track (an interrupted write, an older cache version) go too.
        ArtworkImageLoader.directory(context).listFiles()?.filter { it.isFile && !it.name.startsWith(JOURNAL) }?.forEach { it.delete() }
    }

    companion object {
        const val MAX_BYTES = ArtworkImageLoader.DISK_CACHE_BYTES
        private const val JOURNAL = "journal"
    }
}
