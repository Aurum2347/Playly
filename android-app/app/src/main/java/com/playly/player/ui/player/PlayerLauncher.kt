package com.playly.player.ui.player

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
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

/**
 * Whether the full-screen player is open, and where its open / close animation is anchored
 * (spec §3, §9: the player grows out of the mini-player or the row that started the track).
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

    /** Centre of the mini-player: the natural place to collapse into. */
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
