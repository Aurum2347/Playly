package com.playly.player

import com.playly.player.data.backup.TrackMatcher
import com.playly.player.data.backup.TrackRef
import com.playly.player.data.db.TrackEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/* 9.2: finding library tracks for backup and M3U entries. */
class TrackMatcherTest {
    private fun track(id: Long, folder: String?, file: String, title: String = file, artist: String? = null, durationMs: Long = 200_000) =
        TrackEntity(
            id = id,
            uri = "content://x/$id",
            title = title,
            artist = artist,
            durationMs = durationMs,
            sizeBytes = 1000 + id,
            fileName = file,
            folderPath = folder,
            dateAdded = 0,
            dateModified = 0,
            searchKey = title,
        )

    private val library = listOf(
        track(1, "Music/Rock", "a.mp3", "Alpha", "Band"),
        track(2, "Music/Pop", "a.mp3", "Alpha", "Other"),
        track(3, "Music/Pop", "Song.flac", "Song", "Singer", durationMs = 180_000),
        track(4, null, "Loose.ogg"),
    )
    private val matcher = TrackMatcher(library)

    private fun id(ref: TrackRef) = matcher.match(ref)?.id

    @Test
    fun pathWinsByTheLongestCommonTail() {
        assertEquals(1L, id(TrackRef(path = "Rock/a.mp3")))
        assertEquals(2L, id(TrackRef(path = "D:\\Users\\me\\Music\\Pop\\A.MP3")))
        assertEquals(4L, id(TrackRef(path = "/sdcard/whatever/Loose.ogg")))
    }

    @Test
    fun tiesAreBrokenBySizeThenTags() {
        assertEquals(2L, id(TrackRef(path = "a.mp3", sizeBytes = 1002)))
        assertEquals(2L, id(TrackRef(path = "a.mp3", title = "alpha", artist = "other")))
    }

    @Test
    fun withoutAPathTagsAndLengthDecide() {
        assertEquals(3L, id(TrackRef(path = "gone/elsewhere.mp3", title = "Song", artist = "Singer", durationMs = 181_000)))
        assertNull(id(TrackRef(title = "Song", artist = "Singer", durationMs = 240_000)))
        assertNull(id(TrackRef(title = "Unknown")))
        assertNull(id(TrackRef()))
    }
}
