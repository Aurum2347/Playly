package com.playly.player.designsystem.components

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListItemInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.zIndex
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Drag-to-reorder for a LazyColumn whose rows have stable keys (spec §11: neighbours slide
 * smoothly, the list scrolls when the row nears an edge). The caller keeps its own list:
 * [onMove] swaps two keys in it while the finger moves, [onDrop] commits once it lifts.
 * Rows that must not move (headers, the current track) are excluded by [canMoveOver].
 */
@Stable
class ReorderableListState internal constructor(
    val listState: LazyListState,
    private val scope: CoroutineScope,
) {
    internal var onMove: (from: Any, to: Any) -> Unit = { _, _ -> }
    internal var onDrop: (key: Any) -> Unit = {}
    internal var canMoveOver: (key: Any) -> Boolean = { true }

    /** Key of the row under the finger, or null. */
    var draggingKey by mutableStateOf<Any?>(null)
        private set
    private var dragged by mutableFloatStateOf(0f)
    private var startOffset = 0
    private var autoScroll: Job? = null

    /** How far the dragged row is drawn from its laid-out place. */
    val displacement: Float
        get() = draggingInfo()?.let { startOffset + dragged - it.offset } ?: 0f

    internal fun start(key: Any): Boolean {
        val info = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key } ?: return false
        draggingKey = key
        startOffset = info.offset
        dragged = 0f
        autoScroll?.cancel()
        autoScroll = scope.launch {
            while (isActive) {
                withFrameNanos { }
                val speed = edgeSpeed()
                if (speed != 0f) {
                    listState.scrollBy(speed)
                    swapIfNeeded()
                }
            }
        }
        return true
    }

    internal fun drag(deltaY: Float) {
        if (draggingKey == null) return
        dragged += deltaY
        swapIfNeeded()
    }

    internal fun end() {
        val key = draggingKey
        stop()
        if (key != null) onDrop(key)
    }

    internal fun stop() {
        autoScroll?.cancel()
        autoScroll = null
        draggingKey = null
        dragged = 0f
    }

    private fun draggingInfo(): LazyListItemInfo? {
        val key = draggingKey ?: return null
        return listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key }
    }

    private fun swapIfNeeded() {
        val info = draggingInfo() ?: return
        val top = info.offset + displacement
        val middle = top + info.size / 2f
        val target = listState.layoutInfo.visibleItemsInfo.firstOrNull { item ->
            item.key != info.key && middle >= item.offset && middle <= item.offset + item.size
        } ?: return
        if (!canMoveOver(target.key)) return
        // Keep the viewport still when the first visible row takes part in the swap.
        if (info.index == listState.firstVisibleItemIndex || target.index == listState.firstVisibleItemIndex) {
            listState.requestScrollToItem(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset)
        }
        onMove(info.key, target.key)
    }

    /** Pixels per frame to scroll while the dragged row sits past an edge of the list. */
    private fun edgeSpeed(): Float {
        val info = draggingInfo() ?: return 0f
        val layout = listState.layoutInfo
        val top = info.offset + displacement
        val bottom = top + info.size
        val zone = info.size * 0.6f
        val start = layout.viewportStartOffset + zone
        val end = layout.viewportEndOffset - zone
        return when {
            bottom > end && dragged > 0 -> ((bottom - end) / zone).coerceIn(0f, 1f) * MAX_SCROLL_PX
            top < start && dragged < 0 -> -((start - top) / zone).coerceIn(0f, 1f) * MAX_SCROLL_PX
            else -> 0f
        }
    }

    private companion object {
        const val MAX_SCROLL_PX = 24f
    }
}

@Composable
fun rememberReorderableListState(
    listState: LazyListState,
    onMove: (from: Any, to: Any) -> Unit,
    onDrop: (key: Any) -> Unit,
    canMoveOver: (key: Any) -> Boolean = { true },
): ReorderableListState {
    val scope = rememberCoroutineScope()
    val state = remember(listState, scope) { ReorderableListState(listState, scope) }
    val move by rememberUpdatedState(onMove)
    val drop by rememberUpdatedState(onDrop)
    val can by rememberUpdatedState(canMoveOver)
    state.onMove = { a, b -> move(a, b) }
    state.onDrop = { drop(it) }
    state.canMoveOver = { can(it) }
    return state
}

/** The dragged row floats above its neighbours and follows the finger. */
fun Modifier.reorderable(state: ReorderableListState, key: Any): Modifier =
    if (state.draggingKey == key) {
        zIndex(1f).graphicsLayer { translationY = state.displacement }
    } else {
        this
    }

/** Put on the drag handle: dragging it moves the row [key]. */
@Composable
fun Modifier.dragHandle(state: ReorderableListState, key: Any): Modifier {
    val haptics = LocalHapticFeedback.current
    return pointerInput(state, key) {
        detectDragGestures(
            onDragStart = { if (state.start(key)) haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
            onDrag = { change, amount ->
                change.consume()
                state.drag(amount.y)
            },
            onDragEnd = { state.end() },
            onDragCancel = { state.end() },
        )
    }
}
