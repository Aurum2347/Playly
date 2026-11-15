package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyMotion
import com.playly.player.designsystem.PlaylyTheme

/**
 * Square cover with the Playly placeholder underneath. The placeholder stays visible for
 * tracks without art and while a cover loads, so rows never flash an empty box.
 */
@Composable
fun TrackArtwork(
    artwork: Artwork?,
    modifier: Modifier = Modifier,
    size: Dp = PlaylyTheme.spacing.listArt,
    @DrawableRes placeholderIcon: Int = R.drawable.ic_music_note,
    shape: Shape = PlaylyTheme.shapes.small,
    iconSize: Dp = 24.dp,
) {
    val context = LocalContext.current
    val reduced = PlaylyTheme.motion.reduced
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(PlaylyTheme.colors.surfaceRaised),
        contentAlignment = Alignment.Center,
    ) {
        PlaylyIcon(placeholderIcon, contentDescription = null, tint = PlaylyTheme.colors.textFaint, size = iconSize)
        if (artwork != null) {
            val request = remember(artwork, reduced) {
                ImageRequest.Builder(context)
                    .data(artwork)
                    .crossfade(if (reduced) 0 else PlaylyMotion.DURATION_MEDIUM)
                    .build()
            }
            AsyncImage(
                model = request,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
