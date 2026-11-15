package com.playly.player

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.playly.player.playback.PlaybackErrorKind
import com.playly.player.playback.PlaybackPolicy
import com.playly.player.playback.PlaybackPosition
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackPolicyTest {

    @Test
    fun startIndexKeepsRequestedTrackWhenEverythingResolved() {
        assertEquals(2, PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L, 3L, 4L), 2, listOf(1L, 2L, 3L, 4L)))
    }

    @Test
    fun startIndexFollowsRequestedTrackWhenEarlierOnesAreGone() {
        // 1 and 2 were deleted: track 3 moved from index 2 to index 0.
        assertEquals(0, PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L, 3L, 4L), 2, listOf(3L, 4L)))
    }

    @Test
    fun startIndexMovesToNextSurvivorWhenChosenTrackIsGone() {
        assertEquals(1, PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L, 3L, 4L), 1, listOf(1L, 3L, 4L)))
    }

    @Test
    fun startIndexFallsBackToPreviousSurvivorAtTheEnd() {
        assertEquals(1, PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L, 3L, 4L), 3, listOf(1L, 2L)))
    }

    @Test
    fun startIndexIsNullWhenNothingSurvived() {
        assertNull(PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L), 0, emptyList<Long>()))
    }

    @Test
    fun startIndexPicksTheSameOccurrenceOfADuplicate() {
        // The same track twice in a playlist; the user tapped the second copy.
        assertEquals(2, PlaybackPolicy.startIndexAfterResolve(listOf(7L, 8L, 7L), 2, listOf(7L, 8L, 7L)))
        assertEquals(2, PlaybackPolicy.startIndexAfterResolve(listOf(5L, 7L, 8L, 7L), 3, listOf(7L, 8L, 7L)))
    }

    @Test
    fun startIndexOutOfRangeStartsAtTheTop() {
        assertEquals(0, PlaybackPolicy.startIndexAfterResolve(listOf(1L, 2L), 5, listOf(1L, 2L)))
    }

    @Test
    fun repeatCyclesOffAllOne() {
        assertEquals(Player.REPEAT_MODE_ALL, PlaybackPolicy.nextRepeatMode(Player.REPEAT_MODE_OFF))
        assertEquals(Player.REPEAT_MODE_ONE, PlaybackPolicy.nextRepeatMode(Player.REPEAT_MODE_ALL))
        assertEquals(Player.REPEAT_MODE_OFF, PlaybackPolicy.nextRepeatMode(Player.REPEAT_MODE_ONE))
    }

    @Test
    fun errorsSkipUntilTheWholeQueueFailed() {
        assertTrue(PlaybackPolicy.shouldSkipAfterError(consecutiveErrors = 1, queueSize = 3, hasNext = true))
        assertTrue(PlaybackPolicy.shouldSkipAfterError(consecutiveErrors = 2, queueSize = 3, hasNext = true))
        // Repeat-all over three broken files: the third failure in a row stops instead of looping.
        assertFalse(PlaybackPolicy.shouldSkipAfterError(consecutiveErrors = 3, queueSize = 3, hasNext = true))
        assertFalse(PlaybackPolicy.shouldSkipAfterError(consecutiveErrors = 1, queueSize = 3, hasNext = false))
    }

    @Test
    fun errorCodesMapToHumanCategories() {
        assertEquals(PlaybackErrorKind.Missing, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND))
        assertEquals(PlaybackErrorKind.NoAccess, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_IO_NO_PERMISSION))
        assertEquals(PlaybackErrorKind.Unsupported, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED))
        assertEquals(PlaybackErrorKind.Unsupported, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED))
        assertEquals(PlaybackErrorKind.Damaged, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED))
        assertEquals(PlaybackErrorKind.Other, PlaybackPolicy.errorKind(PlaybackException.ERROR_CODE_UNSPECIFIED))
    }

    @Test
    fun positionAdvancesOnlyWhilePlayingAndStopsAtTheEnd() {
        val paused = PlaybackPosition(positionMs = 1_000, durationMs = 10_000, capturedAtElapsedMs = 0, advancing = false)
        assertEquals(1_000, paused.at(5_000))
        val playing = paused.copy(advancing = true)
        assertEquals(3_000, playing.at(2_000))
        assertEquals(10_000, playing.at(60_000))
        val fast = playing.copy(speed = 2f)
        assertEquals(5_000, fast.at(2_000))
    }
}
