package com.playly.player.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder

/**
 * Queue edits on the service's player (spec §11). Items are addressed by their queue uid
 * ([TrackMediaItems.uid]), never by index, so an edit sent from a list that changed meanwhile
 * hits the right row or nothing.
 *
 * The user's own queue ("Play next" / "Add to queue") is kept apart from the automatic
 * continuation of the source: it is the run of [queued] items right after the current track,
 * in play order. Everything works the same with shuffle on: edits then set the shuffle order
 * explicitly, so "Play next" really plays next.
 */
@OptIn(UnstableApi::class)
internal class QueueEditor(private val player: ExoPlayer) {
    private val queued = LinkedHashSet<Long>()

    /** Uids of the user's queue, in play order. */
    fun queuedUids(): List<Long> {
        if (queued.isEmpty()) return emptyList()
        return playOrder().filter { it in queued }
    }

    /** Index-order positions of queued items (for saving). */
    fun queuedIndices(): List<Int> = (0 until player.mediaItemCount).filter { uidAt(it) in queued }

    /** Index-order positions of queued items in play order (to keep them first when shuffling). */
    fun queuedIndicesInPlayOrder(): List<Int> {
        if (queued.isEmpty()) return emptyList()
        val index = indexByUid()
        return queuedUids().mapNotNull { index[it] }
    }

    /** A new queue from a list: the user's queue starts empty. */
    fun reset() = queued.clear()

    /** After a restore: the items at [indices] were the user's queue. */
    fun restore(indices: List<Int>) {
        queued.clear()
        indices.filter { it in 0 until player.mediaItemCount }.forEach { queued += uidAt(it) }
    }

    /**
     * Keeps the invariant: queued items are exactly the leading run after the current track.
     * A queued track that became current is no longer "in the queue". True if anything changed.
     */
    fun normalize(): Boolean {
        if (queued.isEmpty()) return false
        val order = playOrder()
        val position = currentUid()?.let(order::indexOf) ?: -1
        val keep = LinkedHashSet<Long>()
        if (position >= 0) {
            for (i in position + 1 until order.size) {
                if (order[i] in queued) keep += order[i] else break
            }
        }
        if (keep == queued) return false
        queued.clear()
        queued.addAll(keep)
        return true
    }

    /**
     * "Play next" ([next] true: right after the current track) or "Add to queue" (after the
     * user's queue, before the rest of the source).
     */
    fun insert(items: List<MediaItem>, next: Boolean) {
        if (items.isEmpty()) return
        val order = playOrder()
        val position = currentUid()?.let(order::indexOf)?.takeIf { it >= 0 } ?: (order.size - 1)
        val leading = if (next) 0 else order.drop(position + 1).takeWhile { it in queued }.size
        val at = position + 1 + leading
        val uids = items.map(TrackMediaItems::uid)
        if (player.shuffleModeEnabled) {
            // Index order: right after the current track, so turning shuffle off keeps them next.
            player.addMediaItems(player.currentMediaItemIndex + 1, items)
            applyPlayOrder(order.toMutableList().apply { addAll(at.coerceAtMost(size), uids) })
        } else {
            player.addMediaItems(at.coerceAtMost(player.mediaItemCount), items)
        }
        queued += uids
    }

    /**
     * Moves [uid] right after [afterUid] (0 = right after the current track). [toQueue] tells
     * which section it was dropped in: the user's queue or the source's continuation.
     */
    fun move(uid: Long, afterUid: Long, toQueue: Boolean) {
        val current = currentUid() ?: return
        if (uid == current) return
        val order = playOrder().toMutableList()
        if (!order.remove(uid)) return
        val anchor = if (afterUid == 0L) current else afterUid
        val anchorAt = order.indexOf(anchor).takeIf { it >= 0 } ?: order.indexOf(current)
        val at = anchorAt + 1
        order.add(at, uid)
        if (player.shuffleModeEnabled) {
            applyPlayOrder(order)
        } else {
            val from = indexOfUid(uid)
            if (from >= 0 && from != at) player.moveMediaItem(from, at)
        }
        if (toQueue) queued += uid else queued -= uid
    }

    /** Removes items (never the current one). Returns how many went. */
    fun remove(uids: Set<Long>): Int {
        val current = currentUid()
        val indices = (0 until player.mediaItemCount).filter { uidAt(it).let { u -> u in uids && u != current } }
        removeIndices(indices)
        queued.removeAll(uids)
        return indices.size
    }

    /**
     * Every row of [trackIds], the current one too: the player then moves on to the next row
     * (or ends when none is left). Returns how many went.
     */
    fun removeTracks(trackIds: Set<Long>): Int {
        val indices = (0 until player.mediaItemCount).filter { TrackMediaItems.trackId(player.getMediaItemAt(it)) in trackIds }
        val uids = indices.map(::uidAt)
        removeIndices(indices)
        queued.removeAll(uids.toSet())
        return indices.size
    }

    /** Everything after the current track in play order. Returns how many went. */
    fun clearUpcoming(): Int {
        val order = playOrder()
        val position = currentUid()?.let(order::indexOf) ?: return 0
        if (position < 0) return 0
        return remove(order.drop(position + 1).toSet())
    }

    /**
     * Shuffle goes off: the index order becomes the play order. The user's queue is moved right
     * after the current track first, so it still plays next.
     */
    fun shuffleOff() {
        val block = queuedUids()
        player.shuffleModeEnabled = false
        if (block.isEmpty()) return
        val current = currentUid() ?: return
        val blockSet = block.toHashSet()
        val target = ArrayList<Long>(player.mediaItemCount)
        (0 until player.mediaItemCount).map(::uidAt).forEach { uid ->
            if (uid in blockSet) return@forEach
            target += uid
            if (uid == current) target += block
        }
        reorderTo(target)
    }

    /** Uids in play order (shuffle applied), from the first item, ignoring repeat. */
    fun playOrder(): List<Long> {
        val timeline = player.currentTimeline
        if (timeline.isEmpty) return emptyList()
        val shuffle = player.shuffleModeEnabled
        val result = ArrayList<Long>(timeline.windowCount)
        var index = timeline.getFirstWindowIndex(shuffle)
        while (index != C.INDEX_UNSET && result.size < timeline.windowCount) {
            result += uidAt(index)
            index = timeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, shuffle)
        }
        return result
    }

    private fun currentUid(): Long? = player.currentMediaItemIndex.takeIf { it in 0 until player.mediaItemCount }?.let(::uidAt)

    private fun uidAt(index: Int): Long = TrackMediaItems.uid(player.getMediaItemAt(index))

    private fun indexOfUid(uid: Long): Int = (0 until player.mediaItemCount).firstOrNull { uidAt(it) == uid } ?: -1

    private fun indexByUid(): Map<Long, Int> = HashMap<Long, Int>(player.mediaItemCount * 2).apply {
        for (i in 0 until player.mediaItemCount) put(uidAt(i), i)
    }

    /** Sets the shuffle order to [uids] (play order). Ignored if it does not match the items. */
    private fun applyPlayOrder(uids: List<Long>) {
        val index = indexByUid()
        val order = uids.mapNotNull { index[it] }.toIntArray()
        if (order.size != player.mediaItemCount || order.toSet().size != order.size) return
        player.setShuffleOrder(DefaultShuffleOrder(order, System.nanoTime()))
    }

    /** Moves items until the index order equals [target] (a permutation of the current uids). */
    private fun reorderTo(target: List<Long>) {
        for (k in target.indices) {
            if (k >= player.mediaItemCount) return
            if (uidAt(k) == target[k]) continue
            val from = indexOfUid(target[k])
            if (from > k) player.moveMediaItem(from, k)
        }
    }

    /** Removes [indices] in contiguous runs from the end, so each call is one timeline change per run. */
    private fun removeIndices(indices: List<Int>) {
        val sorted = indices.sortedDescending()
        var i = 0
        while (i < sorted.size) {
            val end = sorted[i]
            var start = end
            while (i + 1 < sorted.size && sorted[i + 1] == start - 1) {
                i++
                start = sorted[i]
            }
            player.removeMediaItems(start, end + 1)
            i++
        }
    }
}
