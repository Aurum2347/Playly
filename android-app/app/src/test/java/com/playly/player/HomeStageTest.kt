package com.playly.player

import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.sortedFor
import com.playly.player.playback.PlaybackPolicy
import kotlin.random.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class HomeStageTest {
    private fun track(
        id: Long,
        title: String,
        artist: String? = null,
        album: String? = null,
        duration: Long = 0,
        added: Long = 0,
        trackNo: Int? = null,
        disc: Int? = null,
    ) = TrackListItem(
        id = id, uri = "content://t/$id", mediaStoreId = null, albumId = null, title = title, artist = artist,
        album = album, durationMs = duration, sizeBytes = 0, dateModified = 0, dateAdded = added,
        trackNumber = trackNo, discNumber = disc,
    )

    /** Input in title order, as the database returns it. */
    private val tracks = listOf(
        track(1, "Alpha", artist = "Земфира", album = "Вендетта", duration = 200, added = 5, trackNo = 2),
        track(2, "Beta", artist = null, album = null, duration = 100, added = 9),
        track(3, "Gamma", artist = "abba", album = "Gold", duration = 300, added = 1, trackNo = 1),
        track(4, "Delta", artist = "Ёлка", album = "Вендетта", duration = 300, added = 7, trackNo = 1),
        track(5, "Epsilon", artist = "Земфира", album = "Вендетта", duration = 50, added = 3, trackNo = 1),
    )

    private fun List<TrackListItem>.ids() = map { it.id }

    @Test fun titleKeepsDatabaseOrder() {
        assertSame(tracks, tracks.sortedFor(TrackSort.Title))
    }

    @Test fun artistIgnoresCaseFoldsYoAndPutsUnknownLast() {
        // abba < Ёлка(=елка) < Земфира (album order by track number) < unknown.
        assertEquals(listOf(3L, 4L, 5L, 1L, 2L), tracks.sortedFor(TrackSort.Artist).ids())
    }

    @Test fun albumUsesTrackNumbersAndPutsUnknownLast() {
        // Вендетта: #1 Delta and #1 Epsilon keep title order (stable), then #2 Alpha; "Gold" sorts before Cyrillic.
        assertEquals(listOf(3L, 4L, 5L, 1L, 2L), tracks.sortedFor(TrackSort.Album).ids())
    }

    @Test fun dateAddedNewestFirstAndDurationLongestFirstAreStable() {
        assertEquals(listOf(2L, 4L, 1L, 5L, 3L), tracks.sortedFor(TrackSort.DateAdded).ids())
        assertEquals(listOf(3L, 4L, 1L, 2L, 5L), tracks.sortedFor(TrackSort.Duration).ids())
    }

    @Test fun unknownSortNameFallsBackToTitle() {
        assertEquals(TrackSort.Title, TrackSort.fromName("Removed"))
        assertEquals(TrackSort.Title, TrackSort.fromName(null))
        assertEquals(TrackSort.Album, TrackSort.fromName("Album"))
    }

    @Test fun shuffledOrderStartsWithTheChosenTrackAndVisitsEveryTrackOnce() {
        repeat(50) { seed ->
            val order = PlaybackPolicy.shuffledOrder(count = 12, first = 7, random = Random(seed))
            assertEquals(7, order.first())
            assertEquals((0 until 12).toList(), order.sorted())
        }
        assertArrayEquals(intArrayOf(0), PlaybackPolicy.shuffledOrder(1, 0))
        assertArrayEquals(IntArray(0), PlaybackPolicy.shuffledOrder(0, 0))
        assertEquals(4, PlaybackPolicy.shuffledOrder(5, 99).first())
    }
}
