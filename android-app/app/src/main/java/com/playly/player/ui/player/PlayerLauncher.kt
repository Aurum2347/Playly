package com.playly.player.ui.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.NowPlayingButton

/**
 * Whether the full-screen player is open, and where its open / close animation is anchored
 * (spec §3: the player grows out of the "Now playing" button or the row that started the track).
 * Open-ness survives rotation and process death through [Saver]; anchors are layout facts and
 * are simply measured again.
 */
@Stable
class PlayerLauncher(initiallyOpen: Boolean = false) {
    var isOpen by mutableStateOf(initiallyOpen)
        private set

    /** Animation origin in root coordinates; null means "from the bottom centre". */
    var origin by mutableStateOf<Offset?>(null)
        private set

    /** Start a track from a list also opens the player (user setting, spec §9). */
    var openOnPlay = false

    /** Centre of the visible "Now playing" button: the natural place to collapse into. */
    private var buttonCentre: Offset? = null

    fun open(from: Offset? = null) {
        origin = from ?: buttonCentre
        isOpen = true
    }

    fun close() {
        buttonCentre?.let { origin = it }
        isOpen = false
    }

    /** Call after a list started playback; opens the player only if the user asked for that. */
    fun trackStarted(from: Offset?) {
        if (openOnPlay) open(from)
    }

    internal fun reportButton(centre: Offset) {
        buttonCentre = centre
    }

    companion object {
        val Saver: Saver<PlayerLauncher, Boolean> = Saver(save = { it.isOpen }, restore = { PlayerLauncher(it) })
    }
}

val LocalPlayerLauncher = staticCompositionLocalOf { PlayerLauncher() }

/** Dynamic on purpose: only the buttons that read it recompose when the track or play state changes. */
val LocalNowPlayingBadge = compositionLocalOf<NowPlayingBadge?> { null }

/**
 * The "Now playing" for a top bar. Takes no space without a current track (spec §9);
 * appears and disappears with a short expand / fade.
 */
@Composable
fun NowPlayingAction(modifier: Modifier = Modifier) {
    val badge = LocalNowPlayingBadge.current
    val launcher = LocalPlayerLauncher.current
    val motion = PlaylyTheme.motion
    // Keep the last track while the button animates away.
    val shown = remember { ShownBadge() }
    if (badge != null) shown.value = badge
    AnimatedVisibility(
        visible = badge != null,
        modifier = modifier,
        enter = fadeIn(motion.enter()) + expandHorizontally(motion.enter()),
        exit = fadeOut(motion.exit()) + shrinkHorizontally(motion.exit()),
    ) {
        val current = shown.value ?: return@AnimatedVisibility
        val description = if (current.artist.isNullOrBlank()) {
            stringResource(R.string.now_playing_open_no_artist, current.title)
        } else {
            stringResource(R.string.now_playing_open, current.title, current.artist)
        }
        NowPlayingButton(
            artwork = current.artwork,
            isPlaying = current.isPlaying,
            contentDescription = description,
            stateDescription = stringResource(
                if (current.isPlaying) R.string.now_playing_state_playing else R.string.now_playing_state_paused,
            ),
            onClick = { launcher.open() },
            modifier = Modifier.onGloballyPositioned { launcher.reportButton(it.boundsInRoot().center) },
        )
    }
}

private class ShownBadge {
    var value: NowPlayingBadge? = null
}

/**
 * Finds where a visible list item sits on screen, so the player can grow out of the row (or
 * card) that started a track. Reads the list's layout info only when asked, on a tap.
 */
@Stable
class ListOrigin(private val state: LazyListState, private val orientation: Orientation = Orientation.Vertical) {
    private var bounds = Rect.Zero

    val modifier: Modifier = Modifier.onGloballyPositioned { bounds = it.boundsInRoot() }

    fun of(key: Any): Offset? {
        val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return null
        val along = item.offset + item.size / 2f
        return when (orientation) {
            Orientation.Vertical -> Offset(bounds.center.x, bounds.top + along)
            Orientation.Horizontal -> Offset(bounds.left + along, bounds.center.y)
        }
    }
}

@Composable
fun rememberListOrigin(state: LazyListState, orientation: Orientation = Orientation.Vertical): ListOrigin =
    remember(state, orientation) { ListOrigin(state, orientation) }
