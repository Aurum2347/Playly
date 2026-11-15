package com.playly.player.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.ReorderableListState
import com.playly.player.designsystem.components.dragHandle
import com.playly.player.designsystem.components.rememberReorderableListState
import com.playly.player.designsystem.components.reorderable
import com.playly.player.playback.QueueEntry
import com.playly.player.playback.QueueSnapshot
import com.playly.player.playback.RepeatMode

/** Edits the queue sheet sends to the playback service; rows are addressed by uid. */
internal class QueueEdits(
    val onPlay: (QueueEntry) -> Unit,
    /** Move [uid] right after [afterUid] (0 = right after the current track); [toQueue]: into the user's queue. */
    val onMove: (uid: Long, afterUid: Long, toQueue: Boolean) -> Unit,
    val onRemove: (uid: Long) -> Unit,
    val onClear: () -> Unit,
)

/**
 * The queue as it will play (shuffle applied, spec §11): "Now playing", the user's own queue
 * ("In the queue": "Play next" / "Add to queue"), then the rest of the source ("Up next").
 * Rows are dragged by their handle, also from one section to the other; ✕ removes one, "Clear"
 * everything after the current track (after a confirmation). The current track stays put.
 */
@Composable
internal fun QueueSheet(queue: QueueSnapshot?, shuffle: Boolean, edits: QueueEdits, onDismiss: () -> Unit) {
    var confirmClear by rememberSaveable { mutableStateOf(false) }
    PlaylySheet(onDismiss = onDismiss) {
        Row(
            Modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs, top = PlaylyTheme.spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.queue_title),
                style = PlaylyTheme.typography.sectionTitle,
                color = PlaylyTheme.colors.textPrimary,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (queue != null && queue.upNext.isNotEmpty()) {
                val description = stringResource(R.string.queue_clear_description)
                PlaylyButton(
                    stringResource(R.string.queue_clear),
                    { confirmClear = true },
                    style = PlaylyButtonStyle.Text,
                    modifier = Modifier.semantics { this.contentDescription = description },
                )
            }
        }
        if (queue == null) {
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.xxxl))
            return@PlaylySheet
        }
        QueueList(queue, shuffle, edits)
    }
    if (confirmClear && queue != null) {
        val count = queue.upNext.size
        ConfirmDialog(
            title = stringResource(R.string.dialog_clear_queue_title),
            message = pluralStringResource(R.plurals.dialog_clear_queue_message, count, count),
            confirmLabel = stringResource(R.string.queue_clear),
            dangerous = true,
            onConfirm = {
                confirmClear = false
                edits.onClear()
            },
            onDismiss = { confirmClear = false },
        )
    }
}

/** Marks where the user's queue ends in the local drag order; drawn as the "Up next" header. */
private data object Boundary

@Composable
private fun QueueList(queue: QueueSnapshot, shuffle: Boolean, edits: QueueEdits) {
    val listState = rememberLazyListState()
    val base = remember(queue) { buildList { addAll(queue.upNext.take(queue.queuedCount)); add(Boundary); addAll(queue.upNext.drop(queue.queuedCount)) } }
    // The order shown while dragging; it gives way to the service's queue once that arrives.
    var dragOrder by remember { mutableStateOf<List<Any>?>(null) }
    val order = dragOrder ?: base
    val reorder = rememberReorderableListState(
        listState = listState,
        onMove = { from, to ->
            val list = dragOrder ?: base
            val a = list.indexOfFirst { keyOf(it) == from }
            val b = list.indexOfFirst { keyOf(it) == to }
            if (a >= 0 && b >= 0) dragOrder = list.toMutableList().apply { add(b, removeAt(a)) }
        },
        onDrop = { key -> dragOrder?.let { commit(it, key, edits) } },
        canMoveOver = { it == BOUNDARY_KEY || (it is String && it.startsWith(ROW_PREFIX)) },
    )
    LaunchedEffect(queue) { if (reorder.draggingKey == null) dragOrder = null }

    val boundaryAt = order.indexOf(Boundary)
    val rest = order.size - boundaryAt - 1
    LazyColumn(Modifier.fillMaxWidth(), state = listState) {
        queue.current?.let { current ->
            item(key = "now-header") { QueueHeader(stringResource(R.string.playback_now_playing), null) }
            item(key = "now") {
                MediaRow(
                    title = current.title,
                    subtitle = current.artist ?: stringResource(R.string.unknown_artist),
                    artwork = current.artwork,
                    isActive = true,
                )
            }
        }
        if (boundaryAt > 0) item(key = "queued-header") { QueueHeader(stringResource(R.string.queue_section_queued), countLabel(boundaryAt)) }
        itemsIndexed(order, key = { _, item -> keyOf(item) }, contentType = { _, item -> if (item is QueueEntry) "row" else "header" }) { index, item ->
            if (item is QueueEntry) {
                val key = keyOf(item)
                QueueRow(item, index, order, reorder, edits, modifier = if (reorder.draggingKey == key) Modifier.reorderable(reorder, key) else Modifier.animateItem())
            } else {
                val detail = countLabel(rest)
                QueueHeader(
                    stringResource(R.string.queue_up_next),
                    when {
                        rest == 0 -> null
                        shuffle && rest > 1 -> stringResource(R.string.summary_separator, detail, stringResource(R.string.queue_shuffled))
                        else -> detail
                    },
                    modifier = Modifier.animateItem(),
                )
            }
        }
        item(key = "footer") {
            val note = when {
                queue.repeat == RepeatMode.One -> R.string.queue_then_repeat_one
                queue.repeat == RepeatMode.All -> R.string.queue_then_repeat_all
                queue.upNext.isEmpty() -> R.string.queue_nothing_next
                else -> null
            }
            if (note != null) {
                Text(
                    stringResource(note),
                    style = PlaylyTheme.typography.subtitle,
                    color = PlaylyTheme.colors.textMuted,
                    modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.md),
                )
            }
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}

@Composable
private fun QueueRow(entry: QueueEntry, index: Int, order: List<Any>, reorder: ReorderableListState, edits: QueueEdits, modifier: Modifier) {
    val key = keyOf(entry)
    val editable = entry.uid != 0L
    val removeLabel = stringResource(R.string.queue_remove, entry.title)
    val up = stringResource(R.string.action_move_up)
    val down = stringResource(R.string.action_move_down)
    val next = stringResource(R.string.track_menu_play_next)
    val a11y = if (!editable) emptyList() else buildList {
        if (index > 0) add(CustomAccessibilityAction(up) { commit(order.moved(index, index - 1), key, edits); true })
        if (index < order.size - 1) add(CustomAccessibilityAction(down) { commit(order.moved(index, index + 1), key, edits); true })
        if (index > 0) add(CustomAccessibilityAction(next) { edits.onMove(entry.uid, 0L, true); true })
        add(CustomAccessibilityAction(removeLabel) { edits.onRemove(entry.uid); true })
    }
    MediaRow(
        title = entry.title,
        subtitle = entry.artist ?: stringResource(R.string.unknown_artist),
        artwork = entry.artwork,
        onClick = { edits.onPlay(entry) },
        leading = if (editable) {
            { DragHandle(reorder, key, stringResource(R.string.queue_drag, entry.title)) }
        } else {
            null
        },
        trailing = if (editable) {
            { PlaylyIconButton(R.drawable.ic_close, removeLabel, { edits.onRemove(entry.uid) }, tint = PlaylyTheme.colors.textMuted) }
        } else {
            null
        },
        accessibilityActions = a11y,
        modifier = modifier,
    )
}

@Composable
private fun DragHandle(state: ReorderableListState, key: Any, description: String) {
    Box(
        Modifier.size(PlaylyTheme.spacing.minTouch).dragHandle(state, key).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        PlaylyIcon(R.drawable.ic_drag_handle, contentDescription = null, tint = PlaylyTheme.colors.textMuted)
    }
}

/**
 * Sends where [key] ended up in [order]: after the row above it (0 = right after the current
 * track), in the user's queue when it sits above the boundary.
 */
private fun commit(order: List<Any>, key: Any, edits: QueueEdits) {
    val at = order.indexOfFirst { keyOf(it) == key }
    val entry = order.getOrNull(at) as? QueueEntry ?: return
    val toQueue = at < order.indexOf(Boundary)
    val after = order.subList(0, at).lastOrNull { it is QueueEntry } as QueueEntry?
    edits.onMove(entry.uid, after?.uid ?: 0L, toQueue)
}

private fun List<Any>.moved(from: Int, to: Int): List<Any> = toMutableList().apply { add(to, removeAt(from)) }

@Composable
private fun countLabel(count: Int) = pluralStringResource(R.plurals.tracks_count, count, count)

@Composable
private fun QueueHeader(title: String, detail: String?, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.page, top = PlaylyTheme.spacing.md, bottom = PlaylyTheme.spacing.xxs)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = PlaylyTheme.typography.label, color = PlaylyTheme.colors.textSecondary, modifier = Modifier.weight(1f))
        if (detail != null) Text(detail, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
    }
}

private const val ROW_PREFIX = "q"
private const val BOUNDARY_KEY = "next-header"

private fun keyOf(item: Any): Any = when (item) {
    is QueueEntry -> if (item.uid != 0L) "$ROW_PREFIX${item.uid}" else "i${item.index}"
    else -> BOUNDARY_KEY
}
