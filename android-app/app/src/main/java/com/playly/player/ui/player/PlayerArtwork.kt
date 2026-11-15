package com.playly.player.ui.player

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.core.graphics.scale
import coil3.BitmapImage
import coil3.Image
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.compose.asPainter
import coil3.memory.MemoryCache
import coil3.request.ImageRequest
import com.playly.player.R
import com.playly.player.core.ArtworkTint
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.playback.NowPlaying
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** What the cover slot shows: [image] null is the Playly placeholder. */
private data class ShownArt(val trackId: Long, val artwork: Artwork?, val image: Image?) {
    fun isFor(track: NowPlaying) = trackId == track.trackId && artwork == track.artwork
}

/**
 * The big cover. Changing tracks never flashes an empty box: the previous cover stays until the
 * next one is decoded, then the two cross-fade. Only a slow load (rare: covers come from the
 * disk cache) shows the placeholder in between, so the old cover never sits next to the new
 * title for long. Covers keep their proportions (centre crop into the square).
 *
 * [onTint] receives the cover's tint colour (or null) when the cover changes; pass null to skip
 * the extra work while the setting is off.
 */
@Composable
internal fun PlayerArtwork(track: NowPlaying, size: Dp, onTint: ((Color?) -> Unit)?) {
    val context = LocalContext.current
    val px = with(LocalDensity.current) { size.roundToPx() }.coerceAtLeast(1)
    val loader = SingletonImageLoader.get(context)
    val motion = PlaylyTheme.motion
    val colors = PlaylyTheme.colors

    // Opening the player (or rotating) with a cover that is already decoded shows it at once.
    var shown by remember { mutableStateOf(cached(loader, track, px)) }
    LaunchedEffect(track.trackId, track.artwork, px) {
        val art = track.artwork
        if (art == null) {
            shown = ShownArt(track.trackId, null, null)
            return@LaunchedEffect
        }
        if (shown?.isFor(track) == true && shown?.image != null && cachedImage(loader, art, px) === shown?.image) return@LaunchedEffect
        coroutineScope {
            val load = async { loader.execute(request(context, art, px)).image }
            val inTime = withTimeoutOrNull(SWAP_WAIT_MS) { load.await(); true }
            if (inTime == null && shown?.isFor(track) != true) shown = ShownArt(track.trackId, art, null)
            shown = ShownArt(track.trackId, art, load.await())
        }
    }

    val latestOnTint by rememberUpdatedState(onTint)
    val tintEnabled = onTint != null
    LaunchedEffect(shown, tintEnabled) {
        val current = shown ?: return@LaunchedEffect
        if (!tintEnabled || !current.isFor(track)) return@LaunchedEffect
        val image = current.image
        // A placeholder while a slow cover loads keeps the previous tint; a track without art clears it.
        if (image == null && current.artwork != null) return@LaunchedEffect
        val tint = image?.let { withContext(Dispatchers.Default) { tintOf(it) } }
        latestOnTint?.invoke(tint)
    }

    Crossfade(targetState = shown, animationSpec = motion.standard(), label = "playerArtwork") { art ->
        Box(
            Modifier
                .size(size)
                .clip(PlaylyTheme.shapes.large)
                .background(colors.surfaceRaised),
            contentAlignment = Alignment.Center,
        ) {
            val image = art?.image
            if (image != null) {
                Image(
                    painter = remember(image) { image.asPainter(context) },
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (art != null) {
                PlaylyIcon(R.drawable.ic_music_note, contentDescription = null, tint = colors.textFaint, size = (size * 0.25f).coerceAtMost(PLACEHOLDER_ICON_MAX))
            }
        }
    }
}

private fun cacheKey(art: Artwork, px: Int) = "player#${art.uri}#${art.version}#${art.sizeBytes}#$px"

private fun request(context: Context, art: Artwork, px: Int) = ImageRequest.Builder(context)
    .data(art)
    .size(px)
    .memoryCacheKey(cacheKey(art, px))
    .build()

private fun cachedImage(loader: ImageLoader, art: Artwork, px: Int): Image? =
    loader.memoryCache?.get(MemoryCache.Key(cacheKey(art, px)))?.image

private fun cached(loader: ImageLoader, track: NowPlaying, px: Int): ShownArt? {
    val art = track.artwork ?: return ShownArt(track.trackId, null, null)
    return cachedImage(loader, art, px)?.let { ShownArt(track.trackId, art, it) }
}

/** Averages a 16×16 copy; never touches the shared bitmap (it may be a hardware one). */
private fun tintOf(image: Image): Color? {
    val source = (image as? BitmapImage)?.bitmap ?: return null
    val software = if (source.config == Bitmap.Config.HARDWARE) source.copy(Bitmap.Config.ARGB_8888, false) ?: return null else source
    val small = software.scale(TINT_SAMPLE, TINT_SAMPLE)
    val pixels = IntArray(TINT_SAMPLE * TINT_SAMPLE)
    small.getPixels(pixels, 0, TINT_SAMPLE, 0, 0, TINT_SAMPLE, TINT_SAMPLE)
    if (small !== software) small.recycle()
    if (software !== source) software.recycle()
    return ArtworkTint.fromPixels(pixels)?.let { Color(it) }
}

private const val SWAP_WAIT_MS = 250L
private const val TINT_SAMPLE = 16
private val PLACEHOLDER_ICON_MAX = androidx.compose.ui.unit.Dp(96f)
