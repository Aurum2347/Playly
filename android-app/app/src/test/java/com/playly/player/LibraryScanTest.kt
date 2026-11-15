package com.playly.player

import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.scan.MetadataParsing
import com.playly.player.data.library.scan.ScanPlan
import com.playly.player.data.library.scan.ScanReport
import com.playly.player.data.library.scan.TrackReconciler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MetadataParsingTest {
    @Test fun cleansUnknownAndBlankTags() {
        assertNull(MetadataParsing.cleanTag("<unknown>"))
        assertNull(MetadataParsing.cleanTag("   "))
        assertNull(MetadataParsing.cleanTag(null))
        assertEquals("Кино", MetadataParsing.cleanTag("  Кино "))
    }

    @Test fun numbersAndYears() {
        assertEquals(3, MetadataParsing.parseNumber("3/12"))
        assertEquals(7, MetadataParsing.parseNumber("07"))
        assertNull(MetadataParsing.parseNumber("0"))
        assertNull(MetadataParsing.parseNumber("A"))
        assertEquals(2019, MetadataParsing.parseYear("2019"))
        assertEquals(2019, MetadataParsing.parseYear("20190501T000000.000Z"))
        assertEquals(1987, MetadataParsing.parseYear("Released 1987"))
        assertNull(MetadataParsing.parseYear("123"))
    }

    @Test fun legacyTrackPacksDisc() {
        assertEquals(2 to 5, MetadataParsing.splitLegacyTrack(2005))
        assertEquals(null to 9, MetadataParsing.splitLegacyTrack(9))
        assertEquals(null to null, MetadataParsing.splitLegacyTrack(0))
    }

    @Test fun titleFallsBackToFileName() {
        assertEquals("01 - Песня", MetadataParsing.titleFromFileName("01 - Песня.mp3"))
        assertEquals("README", MetadataParsing.titleFromFileName("README"))
        assertEquals(".flac", MetadataParsing.titleFromFileName(".flac"))
    }

    @Test fun recognisesAudioButNotPlaylists() {
        assertTrue(MetadataParsing.isAudioFile("a.mp3", "audio/mpeg"))
        assertTrue(MetadataParsing.isAudioFile("a.OPUS", "application/octet-stream"))
        assertFalse(MetadataParsing.isAudioFile("list.m3u", "audio/x-mpegurl"))
        assertFalse(MetadataParsing.isAudioFile("cover.jpg", "image/jpeg"))
    }

    @Test fun folderPathsAgreeAcrossMediaStoreAndDocuments() {
        val expected = "Music/Альбом"
        assertEquals(expected, MetadataParsing.folderFromRelativePath("Music/Альбом/"))
        assertEquals(expected, MetadataParsing.folderFromAbsolutePath("/storage/emulated/0/Music/Альбом/1.mp3"))
        assertEquals(expected, MetadataParsing.folderFromExternalDocumentId("primary:Music/Альбом/1.mp3"))
        assertEquals("Music", MetadataParsing.folderFromAbsolutePath("/storage/1A2B-3C4D/Music/x.flac"))
        assertEquals("", MetadataParsing.folderFromAbsolutePath("/storage/emulated/0/x.mp3"))
        assertEquals("", MetadataParsing.folderFromExternalDocumentId("primary:x.mp3"))
        assertEquals("", MetadataParsing.folderFromRelativePath(null))
        assertNull(MetadataParsing.folderFromExternalDocumentId("42"))
    }
}

class TrackReconcilerTest {
    private fun track(
        id: Long = 0,
        mediaStoreId: Long? = null,
        name: String = "song.mp3",
        title: String = "Song",
        size: Long = 1_000,
        modified: Long = 1,
        available: Boolean = true,
    ) = TrackEntity(
        id = id,
        uri = "content://media/external/audio/media/${mediaStoreId ?: id}",
        mediaStoreId = mediaStoreId,
        title = title,
        durationMs = 1_000,
        sizeBytes = size,
        fileName = name,
        folderPath = "Music",
        dateAdded = 10,
        dateModified = modified,
        searchKey = SearchText.key(title),
        isAvailable = available,
        missingSince = if (available) null else 5,
    )

    private fun reconcile(existing: List<TrackEntity>, scanned: List<TrackEntity>) =
        TrackReconciler.reconcile(existing, scanned) { it.mediaStoreId }

    @Test fun unchangedLibraryWritesNothing() {
        val existing = listOf(track(id = 1, mediaStoreId = 100), track(id = 2, mediaStoreId = 200, name = "b.mp3"))
        val result = reconcile(existing, existing.map { it.copy(id = 0, dateAdded = 99) })
        assertFalse(result.hasChanges)
        assertEquals(2, result.unchanged)
    }

    @Test fun insertsUpdatesAndFlagsMissing() {
        val existing = listOf(
            track(id = 1, mediaStoreId = 100, name = "a.mp3"),
            track(id = 2, mediaStoreId = 200, name = "b.mp3"),
        )
        val scanned = listOf(
            track(mediaStoreId = 100, name = "a.mp3", title = "Retagged", modified = 2),
            track(mediaStoreId = 300, name = "c.mp3", size = 5),
        )
        val result = reconcile(existing, scanned)
        assertEquals(listOf(300L), result.inserts.map { it.mediaStoreId })
        val updated = result.updates.single()
        assertEquals(1L, updated.id)
        assertEquals("Retagged", updated.title)
        assertEquals("First-seen date survives updates", 10L, updated.dateAdded)
        assertEquals(listOf(2L), result.missingIds)
    }

    @Test fun movedFileKeepsItsRowAndPlaylists() {
        val existing = listOf(track(id = 7, mediaStoreId = 100, name = "moved.mp3", size = 4_321))
        val result = reconcile(existing, listOf(track(mediaStoreId = 555, name = "moved.mp3", size = 4_321)))
        assertTrue(result.inserts.isEmpty())
        assertTrue(result.missingIds.isEmpty())
        assertEquals(7L, result.updates.single().id)
        assertEquals(555L, result.updates.single().mediaStoreId)
    }

    @Test fun ambiguousRelinkInsertsInstead() {
        val existing = listOf(
            track(id = 1, mediaStoreId = 100, name = "same.mp3"),
            track(id = 2, mediaStoreId = 200, name = "same.mp3"),
        )
        val result = reconcile(existing, listOf(track(mediaStoreId = 300, name = "same.mp3")))
        assertEquals(1, result.inserts.size)
        assertEquals(listOf(1L, 2L), result.missingIds.sorted())
    }

    @Test fun returningFileBecomesAvailableAgain() {
        val existing = listOf(track(id = 4, mediaStoreId = 100, available = false))
        val result = reconcile(existing, listOf(track(mediaStoreId = 100)))
        val revived = result.updates.single()
        assertTrue(revived.isAvailable)
        assertNull(revived.missingSince)
    }

    @Test fun alreadyMissingRowsAreNotFlaggedAgain() {
        val existing = listOf(track(id = 4, mediaStoreId = 100, available = false))
        assertTrue(reconcile(existing, emptyList()).missingIds.isEmpty())
    }

    @Test fun largeLibraryDiffsQuickly() {
        val count = 20_000
        val existing = (1..count).map { track(id = it.toLong(), mediaStoreId = it.toLong(), name = "t$it.mp3", size = it.toLong()) }
        val scanned = existing.map { it.copy(id = 0) }.toMutableList()
        scanned[0] = scanned[0].copy(title = "Changed", dateModified = 99)
        scanned.removeAt(count - 1)
        val started = System.nanoTime()
        val result = reconcile(existing, scanned)
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertEquals(1, result.updates.size)
        assertEquals(listOf(count.toLong()), result.missingIds)
        assertEquals(count - 2, result.unchanged)
        assertTrue("Diff of $count tracks took $elapsedMs ms", elapsedMs < 2_000)
    }
}

class ScanPlanTest {
    @Test fun plansMergeWithoutLosingWork() {
        val merged = ScanPlan.folder(3).merge(ScanPlan.folder(4))
        assertEquals(ScanPlan(allFolders = false, folderIds = setOf(3, 4)), merged)
        assertTrue(ScanPlan.FULL.merge(ScanPlan.folder(1)).allFolders)
    }

    @Test fun reportsAdd() {
        val total = ScanReport(added = 1, unreadable = 2) + ScanReport(missing = 3, inaccessibleFolders = 1)
        assertEquals(ScanReport(added = 1, missing = 3, unreadable = 2, inaccessibleFolders = 1), total)
        assertTrue(total.hasChanges)
        assertFalse(ScanReport(unreadable = 4).hasChanges)
    }
}
