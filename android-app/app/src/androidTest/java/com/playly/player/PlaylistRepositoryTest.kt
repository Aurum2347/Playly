package com.playly.player

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.playly.player.core.SearchText
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.data.playlists.PlaylistSort
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Stage 6: playlist CRUD on a real (in-memory) Room database. */
@RunWith(AndroidJUnit4::class)
class PlaylistRepositoryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var db: PlaylyDatabase
    private lateinit var repo: PlaylistRepository
    private lateinit var tracks: List<Long>
    private var now = 1_000L

    @Before
    fun setUp() = runBlocking<Unit> {
        db = Room.inMemoryDatabaseBuilder(context, PlaylyDatabase::class.java).build()
        repo = PlaylistRepository(context.contentResolver, db, clock = { now++ })
        tracks = db.trackDao().insertAll(
            listOf("Charlie", "alpha", "Bravo").mapIndexed { i, title ->
                TrackEntity(
                    uri = "content://doc/$i",
                    title = title,
                    durationMs = (i + 1) * 60_000L,
                    fileName = "$title.mp3",
                    dateAdded = 0,
                    dateModified = 0,
                    searchKey = SearchText.key(title),
                )
            },
        )
    }

    @After
    fun tearDown() = db.close()

    private suspend fun order(playlist: Long) = repo.tracks(playlist).first().map { it.track.id }

    @Test
    fun blankNamesAreRefusedAndDetailsAreTrimmed() = runTest {
        assertNull(repo.create("   "))
        val id = repo.create("  Road trip  ", "  ")!!
        val created = repo.playlist(id).first()!!
        assertEquals("Road trip", created.name)
        assertNull(created.description)
        assertEquals(false, repo.updateDetails(id, " ", "x"))
        assertTrue(repo.updateDetails(id, "Mix", " Evening "))
        val edited = repo.playlist(id).first()!!
        assertEquals("Mix", edited.name)
        assertEquals("Evening", edited.description)
    }

    @Test
    fun duplicatesAreSkippedUnlessConfirmed() = runTest {
        val id = repo.create("Mix")!!
        val (a, b, c) = tracks
        val first = repo.add(id, listOf(a, b))
        assertEquals(2, first.addedEntryIds.size)
        // b is there already; a repeated id inside one request counts as a duplicate too.
        val second = repo.add(id, listOf(b, c, c))
        assertEquals(1, second.addedEntryIds.size)
        assertEquals(2, second.skippedDuplicates)
        assertEquals(listOf(a, b, c), order(id))
        repo.add(id, listOf(a), allowDuplicates = true)
        assertEquals(listOf(a, b, c, a), order(id))
        assertEquals(setOf(id), repo.containing(a).first())

        repo.undoAdd(first)
        assertEquals(listOf(c, a), order(id))
    }

    @Test
    fun removeRestoreAndMoveKeepADenseOrder() = runTest {
        val id = repo.create("Mix")!!
        val (a, b, c) = tracks
        repo.add(id, listOf(a, b, c, a), allowDuplicates = true)
        val rows = repo.tracks(id).first()

        // Removing one of two copies removes exactly that entry; Undo puts it back in place.
        val removed = repo.remove(id, listOf(rows[3].entryId, rows[1].entryId))
        assertEquals(2, removed.count)
        assertEquals(listOf(a, c), order(id))
        repo.restore(removed)
        assertEquals(rows.map { it.entryId }, repo.tracks(id).first().map { it.entryId })

        repo.move(id, rows[0].entryId, 2)
        assertEquals(listOf(b, c, a, a), order(id))
        repo.move(id, rows[3].entryId, 0)
        assertEquals(listOf(a, b, c, a), order(id))
        val positions = db.playlistDao().positions(id).map { it.position }
        assertEquals(listOf(0, 1, 2, 3), positions)
    }

    @Test
    fun sortDecidesPlayOrderAndDeleteKeepsTracks() = runTest {
        val id = repo.create("Mix")!!
        val (charlie, alpha, bravo) = tracks
        repo.add(id, listOf(charlie, alpha, bravo))
        assertEquals(listOf(charlie, alpha, bravo), repo.playableTrackIds(id))
        repo.setSort(id, PlaylistSort.Title)
        assertEquals(listOf(alpha, bravo, charlie), repo.playableTrackIds(id))
        repo.setSort(id, PlaylistSort.Duration)
        assertEquals(listOf(bravo, alpha, charlie), repo.playableTrackIds(id))

        db.trackDao().markMissing(listOf(alpha), 1)
        assertEquals(listOf(bravo, charlie), repo.playableTrackIds(id))
        // The missing track stays visible on the page, it only does not play.
        assertEquals(3, repo.tracks(id).first().size)

        repo.delete(id)
        assertNull(repo.playlist(id).first())
        assertTrue(repo.cards.first().isEmpty())
        assertEquals(3, db.trackDao().observeList().first().size + db.trackDao().observeUnavailableCount().first())
    }

    /** Stage 8.1 fix: one track deleted before "Undo" used to roll the whole restore back. */
    @Test
    fun undoRestoresTheRestWhenATrackWasDeletedMeanwhile() = runTest {
        val (a, b, c) = tracks
        val id = repo.create("Mix")!!
        repo.add(id, listOf(a, b, c))
        val rows = repo.tracks(id).first()
        val removed = repo.remove(id, rows.map { it.entryId })
        db.trackDao().delete(b)
        repo.restore(removed)
        assertEquals(listOf(a, c), order(id))
    }
}
