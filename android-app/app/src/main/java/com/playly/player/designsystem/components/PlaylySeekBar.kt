package com.playly.player.designsystem.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.playly.player.designsystem.PlaylyTheme

/**
 * Seek bar: tap or drag anywhere on the 48dp-high strip. While the finger is down only the
 * local value moves ([onScrub]); the seek itself happens once, on release ([onSeek]), so
 * dragging never floods the player with seeks. TalkBack can set the position directly.
 *
 * @param fraction current position, 0..1
 */
@Composable
fun PlaylySeekBar(
    fraction: Float,
    onScrub: (Float) -> Unit,
    onSeek: (Float) -> Unit,
    contentDescription: String,
    stateDescription: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = PlaylyTheme.colors
    var dragging by remember { mutableStateOf(false) }
    val thumb by animateDpAsState(
        targetValue = if (dragging) 16.dp else 12.dp,
        animationSpec = PlaylyTheme.motion.press(),
        label = "seekThumb",
    )
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val latestScrub by rememberUpdatedState(onScrub)
    val latestSeek by rememberUpdatedState(onSeek)
    val value = fraction.coerceIn(0f, 1f)
    val active = if (enabled) colors.textPrimary else colors.textFaint
    val inactive = colors.surfaceRaised

    fun fractionAt(x: Float, width: Int): Float {
        if (width <= 0) return 0f
        val f = (x / width).coerceIn(0f, 1f)
        return if (rtl) 1f - f else f
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(PlaylyTheme.spacing.minTouch)
            .semantics {
                this.contentDescription = contentDescription
                this.stateDescription = stateDescription
                progressBarRangeInfo = ProgressBarRangeInfo(value, 0f..1f)
                if (enabled) {
                    setProgress { target ->
                        latestSeek(target.coerceIn(0f, 1f))
                        true
                    }
                }
            }
            .then(
                if (!enabled) Modifier
                else Modifier
                    .pointerInput(rtl) {
                        detectTapGestures { offset -> latestSeek(fractionAt(offset.x, size.width)) }
                    }
                    .pointerInput(rtl) {
                        var last = 0f
                        detectHorizontalDragGestures(
                            onDragStart = { offset ->
                                dragging = true
                                last = fractionAt(offset.x, size.width)
                                latestScrub(last)
                            },
                            onDragEnd = {
                                dragging = false
                                latestSeek(last)
                            },
                            onDragCancel = {
                                dragging = false
                                latestSeek(last)
                            },
                            onHorizontalDrag = { change, _ ->
                                change.consume()
                                last = fractionAt(change.position.x, size.width)
                                latestScrub(last)
                            },
                        )
                    },
            )
            .drawBehind {
                val track = 4.dp.toPx()
                val radius = thumb.toPx() / 2
                val y = size.height / 2
                val corner = CornerRadius(track / 2)
                drawRoundRect(inactive, Offset(0f, y - track / 2), Size(size.width, track), corner)
                val filled = size.width * value
                val start = if (rtl) size.width - filled else 0f
                drawRoundRect(active, Offset(start, y - track / 2), Size(filled, track), corner)
                val x = if (rtl) size.width - filled else filled
                drawCircle(active, radius, Offset(x.coerceIn(radius, size.width - radius), y))
            },
    )
}
