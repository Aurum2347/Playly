package com.playly.player.playback

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.media3.common.util.BitmapLoader
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import com.google.common.util.concurrent.ListenableFuture
import com.playly.player.data.artwork.Artwork
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.withContext

/**
 * Covers for the notification, lock screen and system media controls. Reads `playly-artwork:`
 * URIs through the app's Coil loader, so the file is opened at most once per size and the
 * result is shared with the lists. Bitmaps are software ones: they cross into the system process.
 */
@OptIn(UnstableApi::class)
class ArtworkBitmapLoader(context: Context, private val scope: CoroutineScope) : BitmapLoader {
    private val context = context.applicationContext

    override fun supportsMimeType(mimeType: String): Boolean = Util.isBitmapFactorySupportedMimeType(mimeType)

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = scope.future(Dispatchers.Default) {
        BitmapFactory.decodeByteArray(data, 0, data.size) ?: throw IOException("Undecodable artwork")
    }

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = scope.future {
        val artwork = ArtworkUri.parse(uri) ?: throw IOException("Unsupported artwork URI")
        load(context, artwork)
    }

    companion object {
        /** Large enough for the expanded notification and lock screen, small enough for binder. */
        private const val EDGE_PX = 512
        private const val JPEG_QUALITY = 85

        suspend fun load(context: Context, artwork: Artwork): Bitmap {
            val request = ImageRequest.Builder(context)
                .data(artwork)
                .size(EDGE_PX)
                .allowHardware(false)
                .build()
            val result = context.imageLoader.execute(request)
            return (result as? SuccessResult)?.image?.toBitmap() ?: throw IOException("No artwork")
        }

        /** Compressed cover for System UI's resumption card, which cannot read private URIs. */
        suspend fun loadBytes(context: Context, artwork: Artwork): ByteArray? {
            val bitmap = try {
                load(context, artwork)
            } catch (_: IOException) {
                return null
            }
            return withContext(Dispatchers.Default) {
                ByteArrayOutputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
                    out.toByteArray()
                }
            }
        }
    }
}
