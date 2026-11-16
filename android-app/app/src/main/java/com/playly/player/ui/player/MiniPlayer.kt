package com.playly.player.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.TrackArtwork
import com.playly.player.playback.PlaybackErrorKind
import com.playly.player.playback.PlaybackPosition

/** Pure rules of the mini-player, kept apart for unit tests (spec §9). */
object MiniPlayerRules {
    /** Panel height without the progress line (spec §9: about 64dp). */
    val HEIGHT = 64.dp

    /** The progress line on the top edge. */
    val PROGRESS = 2.dp

    /** Swipe up this far, or fling up this fast, to open the full-screen player. */
    val OPEN_DISTANCE = 48.dp
    const val OPEN_VELOCITY_DP = 600f

    /** Share of the track already played, 0..1; 0 while the duration is unknown. */
    fun progress(positionMs: Long, durationMs: Long): Float =
        if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)

    /** Drag deltas are negative upwards: a long enough or fast enough swipe up opens the player. */
    fun opensOnRelease(dragPx: Float, velocityPx: Float, distancePx: Float, velocityThresholdPx: Float): Boolean =
        dragPx <= -distancePx || (velocityPx <= -velocityThresholdPx && dragPx < 0f)

    fun issueText(kind: PlaybackErrorKind): Int = when (kind) {
        PlaybackErrorKind.Missing -> R.string.mini_issue_missing
        PlaybackErrorKind.NoAccess -> R.string.mini_issue_no_access
        PlaybackErrorKind.Unsupported -> R.string.mini_issue_unsupported
        PlaybackErrorKind.Damaged -> R.string.mini_issue_damaged
        PlaybackErrorKind.Other -> R.string.mini_issue_other
    }
}

/**
 * The bar above the bottom navigation while a track is current (spec §9): cover, title and
 * artist, previous / play-pause / next and a thin progress line. A tap outside the buttons or a
 * swipe up opens the full-screen player, which grows out of this bar and shrinks back into it.
 * Collects the playback state itself, so a track change recomposes only the bar.
 */
@Composable
fun MiniPlayer(viewModel: PlayerViewModel, launcher: PlayerLauncher, modifier: Modifier = Modifier) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Keep the last track while the bar animates away.
    val last = remember { ShownTrack() }
    state.nowPlaying?.let { last.value = it }
    val track = last.value ?: return
    val colors = PlaylyTheme.colors
    val motion = PlaylyTheme.motion
    val density = LocalDensity.current
    val distancePx = with(density) { MiniPlayerRules.OPEN_DISTANCE.toPx() }
    val velocityPx = with(density) { MiniPlayerRules.OPEN_VELOCITY_DP.dp.toPx() }
    val drag = remember { DragTotal() }
    val dragState = rememberDraggableState { drag.value += it }
    val issueText = state.issue?.let { stringResource(MiniPlayerRules.issueText(it)) }
    val description = if (track.artist.isNullOrBlank()) {
        stringResource(R.string.now_playing_open_no_artist, track.title)
    } else {
        stringResource(R.string.now_playing_open, track.title, track.artist)
    }
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surface)
            .onGloballyPositioned { launcher.reportButton(it.boundsInRoot().center) },
    ) {
        MiniProgress(state.position)
        Row(
            Modifier
                .fillMaxWidth()
                .height(MiniPlayerRules.HEIGHT)
                .draggable(
                    state = dragState,
                    orientation = Orientation.Vertical,
                    onDragStarted = { drag.value = 0f },
                    onDragStopped = { velocity ->
                        if (MiniPlayerRules.opensOnRelease(drag.value, velocity, distancePx, velocityPx)) launcher.open()
                        drag.value = 0f
                    },
                )
                .clickable(role = Role.Button, onClick = { launcher.open() })
                .semantics {
                    contentDescription = description
                    // The visible error line is cleared below; TalkBack hears it here.
                    if (issueText != null) stateDescription = issueText
                }
                .padding(start = PlaylyTheme.spacing.sm, end = PlaylyTheme.spacing.xxs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AnimatedContent(
                targetState = track,
                contentKey = { it.trackId },
                transitionSpec = { fadeIn(motion.standard()) togetherWith fadeOut(motion.exit()) },
                label = "miniTrack",
                modifier = Modifier.weight(1f).fillMaxHeight().clearAndSetSemantics { },
            ) { shown ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TrackArtwork(artwork = shown.artwork, size = 44.dp, shape = PlaylyTheme.shapes.small, iconSize = 22.dp)
                    Spacer(Modifier.width(PlaylyTheme.spacing.sm))
                    Column(Modifier.weight(1f)) {
                        Text(
                            shown.title,
                            style = PlaylyTheme.typography.title,
                            color = colors.textPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val second = issueText ?: shown.artist
                        if (!second.isNullOrBlank()) {
                            Text(
                                second,
                                style = PlaylyTheme.typography.subtitle,
                                color = if (issueText != null) colors.danger else colors.textMuted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
            PlaylyIconButton(
                R.drawable.ic_skip_previous,
                stringResource(R.string.player_previous),
                viewModel::previous,
                enabled = state.hasPrevious,
            )
            PlaylyIconButton(
                if (state.showPlayButton) R.drawable.ic_play else R.drawable.ic_pause,
                stringResource(if (state.showPlayButton) R.string.player_play else R.string.player_pause),
                // After a failed track "play" retries it, as in the full player.
                viewModel::togglePlayPause,
                iconSize = 28.dp,
            )
            PlaylyIconButton(
                R.drawable.ic_skip_next,
                stringResource(R.string.player_next),
                viewModel::next,
                enabled = state.hasNext,
            )
        }
    }
}

/** The thin line on the top edge; reads the clock only here, so ticks redraw nothing else. */
@Composable
private fun MiniProgress(position: PlaybackPosition) {
    val live = rememberLivePosition(position)
    val fraction = MiniPlayerRules.progress(live, position.durationMs)
    val colors = PlaylyTheme.colors
    Box(
        Modifier
            .fillMaxWidth()
            .height(MiniPlayerRules.PROGRESS)
            .background(colors.border)
            .drawBehind {
                drawRect(colors.textSecondary, topLeft = Offset.Zero, size = Size(size.width * fraction, size.height))
            },
    )
}

private class ShownTrack {
    var value: com.playly.player.playback.NowPlaying? = null
}

private class DragTotal {
    var value = 0f
}
