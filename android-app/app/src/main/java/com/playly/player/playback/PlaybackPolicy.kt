package com.playly.player.playback

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import kotlin.random.Random

/**
 * Pure playback rules, kept apart from the service so they are unit-tested without a device.
 */
object PlaybackPolicy {

    /**
     * Where playback starts once some requested tracks turned out to be gone (deleted file,
     * removed folder). Keeps the requested track if it survived, otherwise the next survivor
     * after it, otherwise the last one before it. Null when nothing is left to play.
     *
     * @param requested ids in the order the user saw them
     * @param available ids that resolved to a playable file, in the same order
     */
    fun startIndexAfterResolve(requested: List<Long>, startIndex: Int, available: List<Long>): Int? {
        if (available.isEmpty()) return null
        if (startIndex !in requested.indices) return 0
        val positions = HashMap<Long, Int>(available.size * 2)
        available.forEachIndexed { index, id -> positions.putIfAbsent(id, index) }
        // Duplicate ids are legal in a queue; count which occurrence the user picked.
        val wanted = requested[startIndex]
        val occurrence = (0 until startIndex).count { requested[it] == wanted }
        var seen = 0
        available.forEachIndexed { index, id ->
            if (id == wanted) {
                if (seen == occurrence) return index
                seen++
            }
        }
        for (i in startIndex + 1 until requested.size) positions[requested[i]]?.let { return it }
        for (i in startIndex - 1 downTo 0) positions[requested[i]]?.let { return it }
        return 0
    }

    /**
     * A shuffle order that starts with [first] and visits every other item once, in random order.
     * ExoPlayer's own random order may put the current track in the middle, and "next" would then
     * never reach the items before it.
     */
    fun shuffledOrder(count: Int, first: Int, random: Random = Random.Default): IntArray {
        if (count <= 0) return IntArray(0)
        val start = first.coerceIn(0, count - 1)
        val rest = (0 until count).filter { it != start }.shuffled(random)
        return IntArray(count) { if (it == 0) start else rest[it - 1] }
    }

    /** Off → all → one → off, the order every player uses. */
    fun nextRepeatMode(current: Int): Int = when (current) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    /**
     * After a failed track: skip to the next one unless every track of the queue already failed
     * in a row (a folder of unsupported files must not loop forever).
     */
    fun shouldSkipAfterError(consecutiveErrors: Int, queueSize: Int, hasNext: Boolean): Boolean =
        hasNext && consecutiveErrors < queueSize

    fun errorKind(errorCode: Int): PlaybackErrorKind = when (errorCode) {
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
        PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
        -> PlaybackErrorKind.Missing
        PlaybackException.ERROR_CODE_IO_NO_PERMISSION -> PlaybackErrorKind.NoAccess
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
        -> PlaybackErrorKind.Unsupported
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        -> PlaybackErrorKind.Damaged
        else -> PlaybackErrorKind.Other
    }
}

/** What went wrong with a track, in words a person can act on. */
enum class PlaybackErrorKind { Missing, NoAccess, Unsupported, Damaged, Other }
