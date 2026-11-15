package com.playly.player

import com.playly.player.core.ArtworkTint
import com.playly.player.playback.PlaybackSource
import com.playly.player.playback.SavedPlayback
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 5: queue source persistence and the player's cover tint. */
class PlayerStageTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun savedQueueFromBeforeStage5HasNoSource() {
        val saved = json.decodeFromString(SavedPlayback.serializer(), OLD_FILE)
        assertNull(saved.source)
        assertEquals(listOf(1L, 2L), saved.trackIds)
    }

    @Test
    fun sourceSurvivesSaveAndLoad() {
        val original = SavedPlayback(listOf(3L), 0, 0, sourceKind = "Search", sourceLabel = "abc")
        val text = json.encodeToString(SavedPlayback.serializer(), original)
        val restored = json.decodeFromString(SavedPlayback.serializer(), text)
        assertEquals(PlaybackSource(PlaybackSource.Kind.Search, "abc"), restored.source)
    }

    @Test
    fun unknownSourceKindIsIgnoredNotFatal() {
        assertNull(PlaybackSource.parse("Album", "x"))
        assertNull(PlaybackSource.parse(null, null))
        assertEquals(PlaybackSource(PlaybackSource.Kind.Recent), PlaybackSource.parse("Recent", "  "))
    }

    @Test
    fun tintFollowsTheColourfulPartOfACover() {
        // Mostly black cover with a red title: the tint is red, not grey.
        val pixels = IntArray(256) { if (it < 40) argb(220, 30, 30) else argb(8, 8, 8) }
        val tint = assertNotNull(ArtworkTint.fromPixels(pixels))
        assertTrue(red(tint) > green(tint) + 40 && red(tint) > blue(tint) + 40)
    }

    @Test
    fun tintIsCalmEvenForNeonCovers() {
        val tint = ArtworkTint.fromPixels(IntArray(64) { argb(0, 255, 0) })!!
        val hsv = ArtworkTint.rgbToHsv(red(tint).toFloat(), green(tint).toFloat(), blue(tint).toFloat())
        assertTrue(hsv[1] <= ArtworkTint.MAX_SATURATION + 0.01f)
        assertEquals(ArtworkTint.VALUE, hsv[2], 0.01f)
        assertTrue(hsv[0] in 110f..130f)
    }

    @Test
    fun greyCoverGivesNeutralTintAndTransparentGivesNone() {
        val grey = ArtworkTint.fromPixels(IntArray(64) { argb(120, 120, 120) })!!
        assertEquals(red(grey), green(grey))
        assertEquals(green(grey), blue(grey))
        assertNull(ArtworkTint.fromPixels(IntArray(64) { argb(255, 0, 0, a = 0) }))
        assertNull(ArtworkTint.fromPixels(IntArray(0)))
    }

    @Test
    fun hsvRoundTrip() {
        for (hue in listOf(0f, 45f, 130f, 200f, 290f, 350f)) {
            val c = ArtworkTint.hsvToArgb(hue, 0.5f, 0.6f)
            val back = ArtworkTint.rgbToHsv(red(c).toFloat(), green(c).toFloat(), blue(c).toFloat())
            assertEquals(hue, back[0], 2f)
            assertEquals(0.5f, back[1], 0.02f)
        }
    }

    private fun <T> assertNotNull(value: T?): T {
        org.junit.Assert.assertNotNull(value)
        return value!!
    }

    private fun argb(r: Int, g: Int, b: Int, a: Int = 255) = (a shl 24) or (r shl 16) or (g shl 8) or b
    private fun red(c: Int) = (c shr 16) and 0xFF
    private fun green(c: Int) = (c shr 8) and 0xFF
    private fun blue(c: Int) = c and 0xFF
}

private const val OLD_FILE = """{"trackIds":[1,2],"index":1,"positionMs":5}"""
