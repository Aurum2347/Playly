package com.playly.player

import com.playly.player.playback.PlaybackErrorKind
import com.playly.player.ui.player.MiniPlayerRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.5: the mini-player's progress line, swipe-up rule and error text. */
class MiniPlayerTest {
    @Test
    fun progressIsAShareOfTheDuration() {
        assertEquals(0.25f, MiniPlayerRules.progress(30_000, 120_000), 0.0001f)
        assertEquals(1f, MiniPlayerRules.progress(130_000, 120_000), 0f)
        assertEquals(0f, MiniPlayerRules.progress(-5, 120_000), 0f)
    }

    @Test
    fun unknownDurationShowsNoProgress() {
        assertEquals(0f, MiniPlayerRules.progress(30_000, 0), 0f)
        assertEquals(0f, MiniPlayerRules.progress(30_000, -1), 0f)
    }

    @Test
    fun longSwipeUpOpensThePlayer() {
        assertTrue(MiniPlayerRules.opensOnRelease(dragPx = -150f, velocityPx = 0f, distancePx = 144f, velocityThresholdPx = 1800f))
    }

    @Test
    fun shortFastFlingUpOpensThePlayer() {
        assertTrue(MiniPlayerRules.opensOnRelease(dragPx = -40f, velocityPx = -2500f, distancePx = 144f, velocityThresholdPx = 1800f))
    }

    @Test
    fun shortSlowOrDownwardSwipeDoesNothing() {
        assertFalse(MiniPlayerRules.opensOnRelease(dragPx = -40f, velocityPx = -300f, distancePx = 144f, velocityThresholdPx = 1800f))
        assertFalse(MiniPlayerRules.opensOnRelease(dragPx = 200f, velocityPx = 3000f, distancePx = 144f, velocityThresholdPx = 1800f))
        // A fling up that ends below the start point is not a swipe up.
        assertFalse(MiniPlayerRules.opensOnRelease(dragPx = 10f, velocityPx = -2500f, distancePx = 144f, velocityThresholdPx = 1800f))
    }

    @Test
    fun everyErrorHasItsOwnShortText() {
        val texts = PlaybackErrorKind.entries.map(MiniPlayerRules::issueText)
        assertEquals(texts.size, texts.toSet().size)
    }
}
