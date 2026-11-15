package com.playly.player

import com.playly.player.core.SearchText
import com.playly.player.core.formatClock
import com.playly.player.core.splitDuration
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.LibrarySnapshot
import com.playly.player.data.library.ScanStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchTextTest {
    @Test fun foldsCaseAndCyrillicYo() {
        assertEquals("елка", SearchText.normalize("ЁЛКА"))
        assertEquals("кино", SearchText.normalize("  КИНО  "))
    }

    @Test fun stripsLatinAccentsButKeepsShortI() {
        assertEquals("beyonce", SearchText.normalize("Beyoncé"))
        assertEquals("мой", SearchText.normalize("Мой"))
        assertEquals("й", SearchText.normalize("Й"))
    }

    @Test fun collapsesWhitespace() {
        assertEquals("a b c", SearchText.normalize("a \t b\n\nc"))
        assertEquals("", SearchText.normalize("   "))
    }

    @Test fun keyJoinsNonBlankFields() {
        assertEquals("song artist", SearchText.key("Song", null, "", "Artist"))
    }

    @Test fun escapesLikeWildcards() {
        assertEquals("100\\%", SearchText.escapeLike("100%"))
        assertEquals("a\\_b", SearchText.escapeLike("a_b"))
        assertEquals("c\\\\d", SearchText.escapeLike("c\\d"))
    }
}

class DurationsTest {
    @Test fun clock() {
        assertEquals("0:00", formatClock(0))
        assertEquals("3:05", formatClock(185_000))
        assertEquals("1:01:01", formatClock(3_661_000))
        assertEquals("0:00", formatClock(-5))
    }

    @Test fun hoursMinutesRoundsToNearestMinute() {
        assertEquals(0L to 0L, splitDuration(29_999).let { it.hours to it.minutes })
        assertEquals(0L to 1L, splitDuration(30_000).let { it.hours to it.minutes })
        assertEquals(2L to 5L, splitDuration(125 * 60_000L).let { it.hours to it.minutes })
    }
}

class LibraryContentTest {
    private val folder = LibrarySourceEntity(id = 1, treeUri = "content://tree/1", displayName = "Music", addedAt = 0)

    private fun snapshot(
        sources: List<LibrarySourceEntity> = listOf(folder),
        tracks: Int = 0,
        scan: ScanStatus = ScanStatus.NeverScanned,
    ) = LibrarySnapshot(sources, tracks, tracks * 1000L, scan)

    @Test fun asksForAFolderUntilOneIsPicked() {
        assertEquals(LibraryContent.NoFolder, LibraryContent.from(snapshot(sources = emptyList())))
        assertEquals(LibraryContent.NotScanned, LibraryContent.from(snapshot()))
    }

    @Test fun neverClaimsEmptyBeforeAScan() {
        assertEquals(LibraryContent.NotScanned, LibraryContent.from(snapshot()))
        assertEquals(LibraryContent.Empty, LibraryContent.from(snapshot(scan = ScanStatus.Idle(1))))
    }

    @Test fun scanningAndTracks() {
        assertEquals(LibraryContent.Scanning, LibraryContent.from(snapshot(scan = ScanStatus.Scanning)))
        assertEquals(LibraryContent.Tracks(3, 3000), LibraryContent.from(snapshot(tracks = 3, scan = ScanStatus.Scanning)))
    }

    @Test fun failedScanOffersRetryButKeepsExistingTracks() {
        assertEquals(LibraryContent.ScanFailed, LibraryContent.from(snapshot(scan = ScanStatus.Failed(null))))
        assertEquals(LibraryContent.Tracks(2, 2000), LibraryContent.from(snapshot(tracks = 2, scan = ScanStatus.Failed(5))))
        // Without a folder the only useful action is still to pick one.
        assertEquals(LibraryContent.NoFolder, LibraryContent.from(snapshot(sources = emptyList(), scan = ScanStatus.Failed(null))))
    }
}
