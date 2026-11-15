package com.playly.player

import com.playly.player.data.db.PlaylistTrackRow
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.playlists.PlaylistRules
import com.playly.player.data.playlists.PlaylistSort
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Stage 6: playlist rules that need no database. */
class PlaylistStageTest {
    private fun track(id: Long, title: String, artist: String? = null, album: String? = null, albumId: Long? = null, durationMs: Long = 1_000, trackNumber: Int? = null) =
        TrackListItem(
            id = id, uri = "content://doc/$id", mediaStoreId = null, albumId = albumId, title = title, artist = artist, album = album,
            durationMs = durationMs, sizeBytes = 0, dateModified = 0, dateAdded = 0, trackNumber = trackNumber, discNumber = null,
        )

    private fun row(entry: Long, track: TrackListItem, addedAt: Long = 0) = PlaylistTrackRow(entry, addedAt, true, track)

    @Test
    fun namesAreTrimmedAndLimited() {
        assertNull(PlaylistRules.cleanName("   "))
        assertEquals("Mix", PlaylistRules.cleanName("  Mix \n"))
        assertEquals(PlaylistRules.MAX_NAME_LENGTH, PlaylistRules.cleanName("x".repeat(500))!!.length)
        assertNull(PlaylistRules.cleanDescription("  "))
        assertNull(PlaylistRules.cleanDescription(null))
        assertEquals(PlaylistSort.Manual, PlaylistSort.fromCode(99))
        assertEquals(PlaylistSort.Duration, PlaylistSort.fromCode(PlaylistSort.Duration.code))
    }

    @Test
    fun moveWorksBothWaysAndIgnoresBadIndices() {
        val list = listOf("a", "b", "c", "d")
        assertEquals(listOf("b", "c", "a", "d"), PlaylistRules.moved(list, 0, 2))
        assertEquals(listOf("d", "a", "b", "c"), PlaylistRules.moved(list, 3, 0))
        assertEquals(listOf("b", "c", "d", "a"), PlaylistRules.moved(list, 0, 99))
        assertEquals(list, PlaylistRules.moved(list, 7, 0))
    }

    @Test
    fun sortsAreStableAndPutUnknownLast() {
        val rows = listOf(
            row(1, track(1, "b", artist = null, album = "Z", durationMs = 5), addedAt = 3),
            row(2, track(2, "Ä", artist = "Kino", album = "A", trackNumber = 2), addedAt = 1),
            row(3, track(3, "a", artist = "Kino", album = "A", trackNumber = 1, durationMs = 5), addedAt = 2),
            // The same track twice: both copies stay.
            row(4, track(1, "b", artist = null, album = "Z", durationMs = 5), addedAt = 4),
        )
        fun ids(sort: PlaylistSort) = PlaylistRules.sorted(rows, sort).map { it.entryId }
        assertEquals(listOf(1L, 2L, 3L, 4L), ids(PlaylistSort.Manual))
        // "Ä" and "a" normalise alike, so the manual order breaks the tie.
        assertEquals(listOf(2L, 3L, 1L, 4L), ids(PlaylistSort.Title))
        assertEquals(listOf(3L, 2L, 1L, 4L), ids(PlaylistSort.Artist))
        assertEquals(listOf(3L, 2L, 1L, 4L), ids(PlaylistSort.Album))
        assertEquals(listOf(4L, 1L, 3L, 2L), ids(PlaylistSort.DateAdded))
        assertEquals(listOf(2L, 1L, 3L, 4L), ids(PlaylistSort.Duration))
    }

    @Test
    fun automaticCoverIsAGridOnlyForFourAlbums() {
        assertEquals(emptyList<Any>(), PlaylistRules.coverArtworks(emptyList()))
        val sameAlbum = (1L..5L).map { track(it, "t$it", album = "One", albumId = 7) }
        assertEquals(1, PlaylistRules.coverArtworks(sameAlbum).size)
        val four = listOf(track(1, "a", albumId = 1), track(2, "b", albumId = 1), track(3, "c", albumId = 2), track(4, "d", album = "Named"), track(5, "e"))
        assertEquals(4, PlaylistRules.coverArtworks(four).size)
    }
}
