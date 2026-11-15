package com.playly.player.designsystem.components

import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * The top-bar entry into the full-screen player (spec §9): a small cover and a quiet level
 * indicator. It offers no playback buttons of its own; it is a way in, not a mini-player.
 *
 * The bars move only while audio plays and motion is allowed; their animation is read in the
 * draw phase, so it never recomposes anything. Paused, they rest still and dimmed.
 */
@Composable
fun NowPlayingButton(
    artwork: Artwork?,
    isPlaying: Boolean,
    contentDescription: String,
    stateDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PlaylyTheme.colors
    val animate = isPlaying && !PlaylyTheme.motion.reduced
    Box(
        modifier = modifier
            .height(PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {
                this.contentDescription = contentDescription
                this.stateDescription = stateDescription
            }
            .padding(horizontal = PlaylyTheme.spacing.xxs),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .height(40.dp)
                .clip(PlaylyTheme.shapes.pill)
                .background(colors.surfaceRaised)
                .padding(start = PlaylyTheme.spacing.xxs, end = PlaylyTheme.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TrackArtwork(artwork = artwork, size = 32.dp, shape = PlaylyTheme.shapes.pill, iconSize = 18.dp)
            Spacer(Modifier.width(PlaylyTheme.spacing.xs))
            val tint = if (isPlaying) colors.textPrimary else colors.textMuted
            if (animate) AnimatedLevelBars(tint) else LevelBars(tint, RESTING)
        }
    }
}

@Composable
private fun AnimatedLevelBars(color: Color) {
    val transition = rememberInfiniteTransition(label = "nowPlayingBars")
    val bars = List(BAR_COUNT) { index ->
        transition.animateFloat(
            initialValue = 0.25f,
            targetValue = 1f,
            animationSpec = barSpec(index),
            label = "bar$index",
        )
    }
    BarsCanvas(color) { index -> bars[index].value }
}

@Composable
private fun LevelBars(color: Color, heights: FloatArray) {
    BarsCanvas(color) { index -> heights[index] }
}

@Composable
private fun BarsCanvas(color: Color, height: (Int) -> Float) {
    Box(
        Modifier
            .size(14.dp)
            .drawBehind { drawBars(color, height) },
    )
}

private fun DrawScope.drawBars(color: Color, height: (Int) -> Float) {
    val gap = size.width / (BAR_COUNT * 3 - 1)
    val barWidth = gap * 2
    for (index in 0 until BAR_COUNT) {
        val h = size.height * height(index).coerceIn(0.1f, 1f)
        drawRoundRect(
            color = color,
            topLeft = Offset(index * (barWidth + gap), size.height - h),
            size = Size(barWidth, h),
            cornerRadius = CornerRadius(barWidth / 2),
        )
    }
}

private fun barSpec(index: Int): InfiniteRepeatableSpec<Float> = infiniteRepeatable(
    animation = tween(durationMillis = BAR_DURATIONS[index], easing = LinearEasing),
    repeatMode = RepeatMode.Reverse,
    initialStartOffset = StartOffset(index * 140),
)

private const val BAR_COUNT = 3
private val BAR_DURATIONS = intArrayOf(520, 380, 460)
private val RESTING = floatArrayOf(0.35f, 0.6f, 0.45f)
