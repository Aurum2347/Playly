package com.playly.player.ui.actions

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.data.db.TrackListItem
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar

/**
 * Multi-select of tracks (stage 7). Off until the user taps "Select"; while on, a row tap toggles
 * the row and the top bar offers bulk actions. Survives rotation and the back stack.
 */
@Stable
class TrackSelection internal constructor(initial: Set<Long>?) {
    /** Null while not selecting. */
    var ids: Set<Long>? by mutableStateOf(initial)
        private set

    val isActive: Boolean get() = ids != null

    fun start() {
        ids = emptySet()
    }

    fun close() {
        ids = null
    }

    fun toggle(id: Long) {
        val current = ids ?: return
        ids = if (id in current) current - id else current + id
    }

    fun setAll(tracks: List<TrackListItem>, selected: Boolean) {
        if (ids == null) return
        ids = if (selected) tracks.mapTo(LinkedHashSet()) { it.id } else emptySet()
    }

    /** Selected tracks in the order of [tracks] (the order the user sees). */
    fun pick(tracks: List<TrackListItem>): List<Long> {
        val current = ids ?: return emptyList()
        return tracks.mapNotNull { it.id.takeIf { id -> id in current } }
    }

    companion object {
        /** First element 1 = selecting, then the ids. */
        val Saver = Saver<TrackSelection, LongArray>(
            save = { s -> s.ids?.let { longArrayOf(1L) + it.toLongArray() } ?: longArrayOf(0L) },
            restore = { a -> TrackSelection(if (a.firstOrNull() == 1L) a.drop(1).toSet() else null) },
        )
    }
}

@Composable
fun rememberTrackSelection(): TrackSelection = rememberSaveable(saver = TrackSelection.Saver) { TrackSelection(null) }

/**
 * Top bar while selecting: "Done", count, select all / clear, and the bulk actions
 * ("Play next", "Add to queue", "Add to playlist"). Back ends the selection.
 */
@Composable
fun SelectionTopBar(selection: TrackSelection, tracks: List<TrackListItem>) {
    val actions = LocalTrackActions.current
    BackHandler(enabled = selection.isActive) { selection.close() }
    val picked = selection.pick(tracks)
    val allSelected = picked.size == tracks.size && tracks.isNotEmpty()
    PlaylyTopBar(
        title = if (picked.isEmpty()) stringResource(R.string.selection_nothing) else stringResource(R.string.selection_count, picked.size),
        leading = { PlaylyIconButton(R.drawable.ic_close, stringResource(R.string.selection_close), selection::close) },
        actions = {
            PlaylyIconButton(
                if (allSelected) R.drawable.ic_checkbox_off else R.drawable.ic_select_all,
                stringResource(if (allSelected) R.string.selection_none else R.string.selection_all),
                { selection.setAll(tracks, !allSelected) },
            )
            val enabled = picked.isNotEmpty() && actions != null
            PlaylyIconButton(R.drawable.ic_play_next, stringResource(R.string.track_menu_play_next), {
                actions?.queue(picked, next = true)
                selection.close()
            }, enabled = enabled)
            PlaylyIconButton(R.drawable.ic_queue_music, stringResource(R.string.track_menu_add_to_queue), {
                actions?.queue(picked, next = false)
                selection.close()
            }, enabled = enabled)
            PlaylyIconButton(R.drawable.ic_playlist_add, stringResource(R.string.track_menu_add_to_playlist), {
                actions?.openAddToPlaylist(picked)
                selection.close()
            }, enabled = enabled)
        },
    )
}
