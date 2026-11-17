package com.playly.player

import com.playly.player.data.library.DeleteResult
import com.playly.player.data.library.duplicates.DupTrack
import com.playly.player.data.library.duplicates.DuplicateGroup
import com.playly.player.data.library.duplicates.Duplicates
import com.playly.player.data.tags.TagEdit
import com.playly.player.data.tags.TagField
import com.playly.player.data.tags.TagFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.4: duplicate search (desktop libraryMatch.ts parity), tag edit rules, delete results. */
class FilesStageTest {
    private fun t(id: Long, title: String, artist: String? = "A", seconds: Long = 200, size: Long = 1000 + id) =
        DupTrack(id, title, artist, seconds * 1000, size)

    @Test
    fun normTitleDropsBracketsCaseAndPunctuation() {
        assertEquals("song", Duplicates.normTitle("Song (Remastered) [Official]"))
        assertEquals("song", Duplicates.normTitle("  SONG!!! "))
        assertEquals("rock n roll", Duplicates.normTitle("Rock'n'Roll"))
        assertEquals("ёлка 2", Duplicates.normTitle("Ёлка — 2 {live}"))
        // An opener without a closer is just punctuation.
        assertEquals("song live", Duplicates.normTitle("Song (live"))
        // A bracket closes on any closer, like the desktop regex.
        assertEquals("a b", Duplicates.normTitle("a (x] b"))
        assertEquals("", Duplicates.normTitle("(Intro)"))
    }

    @Test
    fun hashCandidatesAreOnlyTracksSharingASize() {
        val tracks = listOf(t(1, "a", size = 10), t(2, "b", size = 10), t(3, "c", size = 11), t(4, "d", size = 0), t(5, "e", size = 0))
        assertEquals(listOf(1L, 2L), Duplicates.hashCandidates(tracks).map { it.id })
    }

    @Test
    fun exactCopiesGroupByHash() {
        val tracks = listOf(t(1, "One"), t(2, "Two"), t(3, "Three"))
        val groups = Duplicates.find(tracks, mapOf(1L to "h", 3L to "h", 2L to "other"))
        assertEquals(listOf(DuplicateGroup(DuplicateGroup.Kind.Exact, listOf(1L, 3L))), groups)
    }

    @Test
    fun similarNeedsTitleArtistAndCloseLength() {
        val tracks = listOf(
            t(1, "Song", "Band", 200),
            t(2, "song (Remastered)", "BAND", 203),
            t(3, "Song", "Band", 207), // 4 s after #2: a new bucket, alone
            t(4, "Song", "Other", 200), // other artist
            t(5, "Song", null, 200),
            t(6, "Song", "", 201), // blank artist = missing artist
        )
        val groups = Duplicates.find(tracks, emptyMap())
        assertEquals(
            setOf(listOf(1L, 2L), listOf(5L, 6L)),
            groups.map { it.ids }.toSet(),
        )
        assertTrue(groups.all { it.kind == DuplicateGroup.Kind.Similar })
    }

    @Test
    fun durationsCompareInWholeSeconds() {
        // 200.9 s and 203.1 s are "3:20" and "3:23" on the desktop: within 3 s.
        val a = DupTrack(1, "X", "A", 200_900, 1)
        val b = DupTrack(2, "X", "A", 203_100, 2)
        assertEquals(listOf(listOf(1L, 2L)), Duplicates.find(listOf(a, b), emptyMap()).map { it.ids })
    }

    @Test
    fun exactCopiesAppearOnceInASimilarGroup() {
        // 1 and 2 are the same file; 3 is another encoding of the song.
        val tracks = listOf(t(1, "Song"), t(2, "Song"), t(3, "Song"))
        val groups = Duplicates.find(tracks, mapOf(1L to "h", 2L to "h"))
        assertEquals(DuplicateGroup(DuplicateGroup.Kind.Exact, listOf(1L, 2L)), groups[0])
        assertEquals(DuplicateGroup(DuplicateGroup.Kind.Similar, listOf(1L, 3L)), groups[1])
        // Only copies of one file: no similar group on top of the exact one.
        assertEquals(1, Duplicates.find(tracks.take(2), mapOf(1L to "h", 2L to "h")).size)
    }

    @Test
    fun titlesThatNormaliseToNothingNeverMatch() {
        assertTrue(Duplicates.find(listOf(t(1, "(Intro)"), t(2, "[Intro]")), emptyMap()).isEmpty())
    }

    @Test
    fun extrasKeepTheEarliestAddedOfEachGroup() {
        val groups = listOf(
            DuplicateGroup(DuplicateGroup.Kind.Exact, listOf(1, 2, 3)),
            DuplicateGroup(DuplicateGroup.Kind.Similar, listOf(4, 5)),
        )
        val added = mapOf(1L to 30L, 2L to 10L, 3L to 20L, 4L to 1L, 5L to 2L)
        assertEquals(setOf(1L, 3L, 5L), Duplicates.extras(groups) { added.getValue(it) })
    }

    @Test
    fun tagEditCleansAndValidates() {
        val edit = TagEdit("  Title\u0000 ", "Art\tist", "", "  ")
        assertEquals(TagEdit("Title", "Art ist", "", ""), edit.cleaned())
        assertTrue(edit.isValid)
        assertFalse(TagEdit(" \n ").isValid)
        assertEquals(TagEdit.MAX_LENGTH, TagEdit.clean("x".repeat(2000)).length)
        val values = edit.cleaned().values()
        assertEquals("Title", values[TagField.Title])
        assertNull(values[TagField.Album])
        assertNull(values[TagField.Genre])
    }

    @Test
    fun tagFormatByNameThenMime() {
        assertEquals(TagFormat.Mp3, TagFormat.of("a.MP3", null))
        assertEquals(TagFormat.Ogg, TagFormat.of("a.opus", null))
        assertEquals(TagFormat.Mp4, TagFormat.of("a.m4a", "audio/mpeg"))
        assertNull(TagFormat.of("a.wav", "audio/wav"))
        assertEquals(TagFormat.Flac, TagFormat.of("noext", "audio/flac"))
        assertNull(TagFormat.of("noext", null))
    }

    @Test
    fun deleteResultCountsEveryRequest() {
        val result = DeleteResult(deleted = listOf(1, 2), noAccess = 1, failed = 3)
        assertEquals(6, result.requested)
    }
}
