package com.playly.player.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * A playlist's cover (spec §7): the picture the user chose, else a 2×2 grid of four album
 * covers, else the first track's cover, else the Playly placeholder. The automatic cover stays
 * underneath a chosen picture, so a deleted image file never leaves an empty square.
 */
@Composable
fun PlaylistCover(
    covers: List<Artwork>,
    coverUri: String?,
    modifier: Modifier = Modifier,
    size: Dp = PlaylyTheme.spacing.listArt,
    shape: Shape = PlaylyTheme.shapes.small,
) {
    val iconSize = (size * 0.4f).coerceAtMost(PlaylyTheme.spacing.xxxl)
    Box(
        modifier
            .size(size)
            .clip(shape)
            .background(PlaylyTheme.colors.surfaceRaised),
        contentAlignment = Alignment.Center,
    ) {
        when {
            covers.size >= 4 -> Column(Modifier.fillMaxSize()) {
                for (row in 0 until 2) {
                    Row(Modifier.weight(1f)) {
                        for (col in 0 until 2) {
                            TrackArtwork(covers[row * 2 + col], size = size / 2, shape = RectangleShape, iconSize = iconSize / 2)
                        }
                    }
                }
            }
            covers.isNotEmpty() -> TrackArtwork(covers.first(), size = size, shape = RectangleShape, iconSize = iconSize)
            else -> PlaylyIcon(R.drawable.ic_playlists, contentDescription = null, tint = PlaylyTheme.colors.textFaint, size = iconSize)
        }
        if (coverUri != null) {
            AsyncImage(
                model = coverUri,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
