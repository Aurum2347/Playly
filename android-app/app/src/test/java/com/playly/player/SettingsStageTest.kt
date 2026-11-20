package com.playly.player

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.scan.LibraryFilter
import com.playly.player.data.library.scan.TrackReconciler
import com.playly.player.data.library.scan.hiddenRowIds
import com.playly.player.data.settings.QueueEndAction
import com.playly.player.data.settings.SettingsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 9.1: library filter (short tracks, hidden folders) and the playback settings. */
class SettingsStageTest {
    private class MemoryStore : DataStore<Preferences> {
        private val state = MutableStateFlow(emptyPreferences())
        override val data: Flow<Preferences> = state

        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
            transform(state.value).also { state.value = it }
    }

    private fun <T> withRepo(block: suspend (SettingsRepository) -> T): T = runBlocking { block(SettingsRepository(MemoryStore())) }

    private fun track(id: Long, uri: String, durationMs: Long = 180_000, folder: String? = "Music/Rock") = TrackEntity(
        id = id,
        uri = uri,
        sourceId = 1,
        title = uri,
        durationMs = durationMs,
        sizeBytes = 1000 + id,
        fileName = "$uri.mp3",
        folderPath = folder,
        dateAdded = 0,
        dateModified = 0,
        searchKey = uri,
    )

    @Test
    fun shortTracksAreHiddenButUnknownLengthIsKept() {
        val filter = LibraryFilter(minDurationMs = 30_000)
        assertTrue(filter.hides(track(1, "a", durationMs = 5_000)))
        assertTrue(filter.hides(track(2, "b", durationMs = 29_999)))
        assertFalse(filter.hides(track(3, "c", durationMs = 30_000)))
        assertFalse(filter.hides(track(4, "d", durationMs = 0)))
        assertTrue(LibraryFilter().isEmpty)
        assertFalse(LibraryFilter().hides(track(5, "e", durationMs = 1)))
    }

    @Test
    fun hiddenFolderHidesItsSubfoldersOnly() {
        val filter = LibraryFilter(excludedFolders = setOf("Music/Rock"))
        assertTrue(filter.isExcluded("Music/Rock"))
        assertTrue(filter.isExcluded("/Music/Rock/"))
        assertTrue(filter.isExcluded("Music/Rock/Live 1999"))
        assertFalse(filter.isExcluded("Music/Rocky"))
        assertFalse(filter.isExcluded("Music"))
        assertFalse(filter.isExcluded(null))
    }

    @Test
    fun onlyRowsHiddenByTheFilterAreForgotten() {
        val existing = listOf(track(1, "keep"), track(2, "short"), track(3, "gone"), track(4, "voice", folder = "Music/Voice"))
        // "gone" vanished from the disk; "short" and "voice" are still there but filtered out.
        val kept = listOf(track(0, "keep"), track(0, "short", durationMs = 4_000), track(0, "voice", folder = "Music/Voice"))
        val filter = LibraryFilter(minDurationMs = 10_000, excludedFolders = setOf("Music/Voice"))
        val visible = kept.filterNot(filter::hides)
        val result = TrackReconciler.reconcile(existing, visible) { it.uri }
        assertEquals(listOf(2L, 3L, 4L), result.missingIds.sorted())
        assertEquals(listOf(2L, 4L), hiddenRowIds(existing, kept, visible, result).sorted())
    }

    @Test
    fun settingsDefaultsAndRoundTrip() = withRepo { repo ->
        val defaults = repo.settings.first()
        assertEquals(0, defaults.minTrackSeconds)
        assertTrue(defaults.resumePosition && defaults.pauseOnNoisy)
        assertEquals(QueueEndAction.Stop, defaults.queueEnd)
        assertTrue(defaults.libraryFilter.isEmpty)

        repo.setMinTrackSeconds(30)
        repo.setResumePosition(false)
        repo.setPauseOnNoisy(false)
        repo.setQueueEnd(QueueEndAction.Rewind)
        val s = repo.settings.first()
        assertEquals(30_000L, s.libraryFilter.minDurationMs)
        assertFalse(s.resumePosition || s.pauseOnNoisy)
        assertEquals(QueueEndAction.Rewind, s.queueEnd)

        // Not one of the offered choices: keeps every track.
        repo.setMinTrackSeconds(17)
        assertEquals(0, repo.settings.first().minTrackSeconds)
        assertEquals(QueueEndAction.Stop, QueueEndAction.fromName("Shuffle"))
    }

    @Test
    fun settingsBackupRoundTripSkipsWrongTypes() = withRepo { repo ->
        repo.setMinTrackSeconds(30)
        repo.setQueueEnd(QueueEndAction.Rewind)
        repo.excludeFolder("Music/Voice")
        repo.setLastScanAt(42)
        val saved = repo.exportBackup()
        assertFalse("last_scan_at" in saved)
        withRepo { other ->
            val values = saved + ("pause_on_noisy" to JsonPrimitive("yes")) + ("unknown_key" to JsonPrimitive(1))
            assertEquals(3, other.importBackup(values))
            val s = other.settings.first()
            assertEquals(30, s.minTrackSeconds)
            assertEquals(QueueEndAction.Rewind, s.queueEnd)
            assertEquals(setOf("Music/Voice"), s.excludedFolders)
            assertTrue(s.pauseOnNoisy)
        }
    }

    @Test
    fun excludingAndShowingFolders() = withRepo { repo ->
        assertTrue(repo.excludeFolder("/Music/Voice/"))
        assertFalse(repo.excludeFolder("Music/Voice"))
        assertFalse(repo.excludeFolder("/"))
        assertEquals(setOf("Music/Voice"), repo.settings.first().excludedFolders)
        repo.includeFolder("Music/Voice")
        assertTrue(repo.settings.first().excludedFolders.isEmpty())
    }
}
