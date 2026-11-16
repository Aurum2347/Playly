package com.playly.player

import com.playly.player.data.db.TrackListItem
import com.playly.player.data.favorites.FavoriteChange
import com.playly.player.data.favorites.FavoriteSort
import com.playly.player.data.favorites.FavoriteTrack
import com.playly.player.data.favorites.sortedFor
import com.playly.player.playback.PlaybackSource
import com.playly.player.playback.PlaybackSpeed
import com.playly.player.playback.SavedPlayback
import com.playly.player.playback.SleepTimerRules
import java.util.Locale
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.1: playback speed, sleep timer, favourites. */
class ExtrasStageTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun speedSnapsToStepsAndStaysInRange() {
        assertEquals(1.25f, PlaybackSpeed.snap(1.2499f))
        assertEquals(1.25f, PlaybackSpeed.snap(1.26f))
        assertEquals(0.5f, PlaybackSpeed.snap(0.1f))
        assertEquals(2f, PlaybackSpeed.snap(9f))
        assertEquals(1f, PlaybackSpeed.snap(Float.NaN))
        assertTrue(PlaybackSpeed.isNormal(1.01f))
        assertFalse(PlaybackSpeed.isNormal(1.05f))
    }

    @Test
    fun speedSliderRoundTrips() {
        for (preset in PlaybackSpeed.PRESETS) {
            assertEquals(preset, PlaybackSpeed.fromFraction(PlaybackSpeed.fraction(preset)))
        }
        assertEquals(0f, PlaybackSpeed.fraction(0.5f))
        assertEquals(1f, PlaybackSpeed.fraction(2f))
    }

    @Test
    fun speedLabelUsesLocaleSeparator() {
        assertEquals("1×", PlaybackSpeed.label(1f, Locale.ENGLISH))
        assertEquals("1.25×", PlaybackSpeed.label(1.25f, Locale.ENGLISH))
        assertEquals("1,25×", PlaybackSpeed.label(1.25f, Locale.forLanguageTag("ru")))
        assertEquals("0,5×", PlaybackSpeed.label(0.5f, Locale.forLanguageTag("ru")))
    }

    @Test
    fun speedIsSavedWithTheQueueAndOldFilesPlayAtNormalSpeed() {
        val old = json.decodeFromString(SavedPlayback.serializer(), """{"trackIds":[1],"index":0,"positionMs":0}""")
        assertEquals(1f, old.speed)
        val saved = SavedPlayback(listOf(1L), 0, 0, speed = 1.5f)
        val restored = json.decodeFromString(SavedPlayback.serializer(), json.encodeToString(SavedPlayback.serializer(), saved))
        assertEquals(1.5f, restored.speed)
    }

    @Test
    fun sleepTimerStartsAndExtendsWithinTheCap() {
        val timer = SleepTimerRules.start(nowElapsedMs = 1_000, minutes = 30)
        assertEquals(1_000 + 30 * 60_000L, timer.deadlineElapsedMs)
        assertEquals(30 * 60_000L, timer.remainingMs(1_000))
        assertEquals(0, timer.remainingMs(timer.deadlineElapsedMs + 5))

        // 10 minutes in, "+10 min": 30 minutes left again, length now 40.
        val extended = SleepTimerRules.extend(timer, 1_000 + 10 * 60_000L, SleepTimerRules.EXTEND_MINUTES)
        assertEquals(30 * 60_000L, extended.remainingMs(1_000 + 10 * 60_000L))
        assertEquals(40 * 60_000L, extended.totalMs)

        val huge = SleepTimerRules.extend(SleepTimerRules.start(0, 12 * 60), 0, 10)
        assertEquals(SleepTimerRules.MAX_MS, huge.remainingMs(0))
        assertEquals(SleepTimerRules.MAX_MS, SleepTimerRules.start(0, 100_000).totalMs)
    }

    @Test
    fun expiredTimerExtendsFromNow() {
        val timer = SleepTimerRules.start(0, 10)
        val now = 60 * 60_000L
        assertEquals(10 * 60_000L, SleepTimerRules.extend(timer, now, 10).remainingMs(now))
    }

    @Test
    fun sleepTimerFadesOutOnlyAtTheEnd() {
        val fade = SleepTimerRules.fadeMs(30 * 60_000L)
        assertEquals(SleepTimerRules.FADE_MS, fade)
        assertEquals(1f, SleepTimerRules.volumeAt(60_000, fade))
        assertEquals(1f, SleepTimerRules.volumeAt(fade, fade))
        assertEquals(0.25f, SleepTimerRules.volumeAt(fade / 2, fade))
        assertEquals(0f, SleepTimerRules.volumeAt(0, fade))
        // A 4-second timer fades over 2 seconds, not 10.
        assertEquals(2_000L, SleepTimerRules.fadeMs(4_000))
        assertEquals(1f, SleepTimerRules.volumeAt(100, 0))
    }

    @Test
    fun favouritesSortStablyFromTitleOrder() {
        // As the database returns them: by title.
        val rows = listOf(
            fav(1, "Alpha", artist = "Zed", album = "B", duration = 300, added = 10),
            fav(2, "Beta", artist = "Abe", album = "A", duration = 100, added = 30),
            fav(3, "Gamma", artist = "Abe", album = "C", duration = 200, added = 20),
        )
        assertEquals(listOf(2L, 3L, 1L), rows.sortedFor(FavoriteSort.Added).ids())
        assertEquals(listOf(1L, 2L, 3L), rows.sortedFor(FavoriteSort.Title).ids())
        assertEquals(listOf(2L, 3L, 1L), rows.sortedFor(FavoriteSort.Artist).ids())
        assertEquals(listOf(2L, 1L, 3L), rows.sortedFor(FavoriteSort.Album).ids())
        // Longest first, as the library sorts.
        assertEquals(listOf(1L, 3L, 2L), rows.sortedFor(FavoriteSort.Duration).ids())
    }

    @Test
    fun unknownFavouriteSortFallsBackToRecentlyAdded() {
        assertEquals(FavoriteSort.Added, FavoriteSort.fromName(null))
        assertEquals(FavoriteSort.Added, FavoriteSort.fromName("Rating"))
        assertEquals(FavoriteSort.Album, FavoriteSort.fromName("Album"))
    }

    @Test
    fun favouritesPlayAsTheirOwnSource() {
        assertEquals(PlaybackSource(PlaybackSource.Kind.Favorites), PlaybackSource.parse("Favorites", null))
        assertTrue(FavoriteChange().isEmpty)
        assertFalse(FavoriteChange(added = listOf(1)).isEmpty)
    }

    private fun List<FavoriteTrack>.ids() = map { it.track.id }

    private fun fav(id: Long, title: String, artist: String, album: String, duration: Long, added: Long) = FavoriteTrack(
        TrackListItem(
            id = id, uri = "content://t/$id", mediaStoreId = null, albumId = null, title = title, artist = artist, album = album,
            durationMs = duration, sizeBytes = 0, dateModified = 0, dateAdded = 0, trackNumber = null, discNumber = null,
        ),
        addedAt = added,
    )
}
