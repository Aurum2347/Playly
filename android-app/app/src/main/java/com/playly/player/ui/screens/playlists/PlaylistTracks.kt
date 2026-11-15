package com.playly.player.ui.screens.playlists

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.artwork.artwork
import com.playly.player.data.db.PlaylistTrackRow
import com.playly.player.data.playlists.PlaylistRules
import com.playly.player.data.playlists.PlaylistSort
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.ReorderableListState
import com.playly.player.designsystem.components.dragHandle
import com.playly.player.designsystem.components.rememberReorderableListState
import com.playly.player.designsystem.components.reorderable
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.PlaylistEntryRef
import com.playly.player.ui.actions.TrackTarget
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.rememberListOrigin
import com.playly.player.ui.screens.library.revealHeader
import com.playly.player.ui.screens.library.trackSubtitle

/**
 * Header and the playlist's tracks. In the user's own order every row has a drag handle
 * (and "move up / down" for TalkBack); the new order is saved when the finger lifts.
 * Unavailable files stay in place, dimmed.
 */
@Composable
internal fun PlaylistTracks(page: PlaylistPage, nowPlayingId: Long?, viewModel: PlaylistViewModel, onAddTracks: () -> Unit) {
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)
    val launcher = LocalPlayerLauncher.current
    val actions = LocalTrackActions.current
    val scope = rememberCoroutineScope()
    val manual = page.sort == PlaylistSort.Manual
    val name = page.card.name

    // While dragging, the list shows this local order; it gives way to the saved one afterwards.
    var dragOrder by remember { mutableStateOf<List<PlaylistTrackRow>?>(null) }
    val rows = dragOrder ?: page.rows
    val reorder = rememberReorderableListState(
        listState = listState,
        onMove = { from, to ->
            val list = dragOrder ?: page.rows
            val a = list.indexOfFirst { rowKey(it) == from }
            val b = list.indexOfFirst { rowKey(it) == to }
            if (a >= 0 && b >= 0) dragOrder = PlaylistRules.moved(list, a, b)
        },
        onDrop = { key ->
            val list = dragOrder
            val at = list?.indexOfFirst { rowKey(it) == key } ?: -1
            if (list != null && at >= 0) viewModel.move(list[at].entryId, at)
        },
        canMoveOver = { it is String && it.startsWith(ROW_PREFIX) },
    )
    LaunchedEffect(page.rows) { if (reorder.draggingKey == null) dragOrder = null }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().then(origins.modifier),
        contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
    ) {
        item(key = HEADER, contentType = "header") {
            PlaylistHeader(
                page = page,
                onPlay = { shuffle -> viewModel.commands.play(page.card.id, name, shuffle) { launcher.trackStarted(origins.of(HEADER)) } },
                onAddTracks = onAddTracks,
                onSort = { sort ->
                    scope.revealHeader(listState, headerIndex = 0)
                    viewModel.setSort(sort)
                },
            )
        }
        if (rows.isEmpty()) item(key = "empty") { PlaylistEmptyNote() }
        itemsIndexed(rows, key = { _, row -> rowKey(row) }, contentType = { _, _ -> "track" }) { index, row ->
            val key = rowKey(row)
            val subtitle = trackSubtitle(row.track)
            MediaRow(
                title = row.track.title,
                subtitle = subtitle,
                trailingText = if (row.track.durationMs > 0) formatClock(row.track.durationMs) else null,
                artwork = row.track.artwork(),
                isActive = row.isAvailable && row.track.id == nowPlayingId,
                dimmed = !row.isAvailable,
                onClick = {
                    viewModel.play(rows, row, name)
                    if (row.isAvailable) launcher.trackStarted(origins.of(key))
                },
                onMore = actions?.let { a ->
                    {
                        a.open(
                            TrackTarget(
                                row.track.id, row.track.title, subtitle, row.track.artwork(),
                                playlistEntry = PlaylistEntryRef(page.card.id, name, row.entryId),
                            ),
                        )
                    }
                },
                leading = if (manual) {
                    { DragHandle(reorder, key) }
                } else {
                    null
                },
                accessibilityActions = if (manual) moveActions(index, rows.size) { to -> viewModel.move(row.entryId, to) } else emptyList(),
                modifier = if (reorder.draggingKey == key) Modifier.reorderable(reorder, key) else Modifier.animateItem(),
            )
        }
    }
}

@Composable
private fun DragHandle(state: ReorderableListState, key: Any) {
    Box(Modifier.size(PlaylyTheme.spacing.minTouch).dragHandle(state, key), contentAlignment = Alignment.Center) {
        PlaylyIcon(R.drawable.ic_drag_handle, contentDescription = null, tint = PlaylyTheme.colors.textMuted)
    }
}

/** TalkBack cannot drag: "Move up" / "Move down" do the same one step at a time. */
@Composable
internal fun moveActions(index: Int, size: Int, move: (Int) -> Unit): List<CustomAccessibilityAction> {
    val up = stringResource(R.string.action_move_up)
    val down = stringResource(R.string.action_move_down)
    return buildList {
        if (index > 0) add(CustomAccessibilityAction(up) { move(index - 1); true })
        if (index in 0 until size - 1) add(CustomAccessibilityAction(down) { move(index + 1); true })
    }
}

private const val HEADER = "playlist-header"
private const val ROW_PREFIX = "e"
private fun rowKey(row: PlaylistTrackRow): Any = "$ROW_PREFIX${row.entryId}"
