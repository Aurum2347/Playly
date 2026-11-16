package com.playly.player

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.playly.player.core.SearchText
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.favorites.FavoritesRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Stage 8.1: favourites on a real (in-memory) Room database. */
@RunWith(AndroidJUnit4::class)
class FavoritesRepositoryTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var db: PlaylyDatabase
    private lateinit var repo: FavoritesRepository
    private lateinit var tracks: List<Long>

    @Before
    fun setUp() = runBlocking<Unit> {
        db = Room.inMemoryDatabaseBuilder(context, PlaylyDatabase::class.java).build()
        repo = FavoritesRepository(db)
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

    private suspend fun listed() = repo.tracks.first().associate { it.track.id to it.addedAt }

    @Test
    fun addingAgainKeepsTheFirstDateAndUndoRestoresIt() = runTest {
        val (charlie, alpha, _) = tracks
        assertEquals(listOf(charlie), repo.add(listOf(charlie), now = 100).added)
        val second = repo.add(listOf(charlie, alpha), now = 200)
        assertEquals(listOf(alpha), second.added)
        assertEquals(mapOf(charlie to 100L, alpha to 200L), listed())

        val removed = repo.remove(listOf(charlie, alpha))
        assertTrue(listed().isEmpty())
        repo.undo(removed)
        assertEquals(mapOf(charlie to 100L, alpha to 200L), listed())

        repo.undo(second)
        assertEquals(mapOf(charlie to 100L), listed())
        assertEquals(setOf(charlie), repo.ids.first())
    }

    @Test
    fun listIsInTitleOrderAndHidesMissingTracks() = runTest {
        val (charlie, alpha, bravo) = tracks
        repo.add(tracks)
        assertEquals(listOf(alpha, bravo, charlie), repo.tracks.first().map { it.track.id })

        db.trackDao().markMissing(listOf(bravo), now = 1)
        assertEquals(listOf(alpha, charlie), repo.tracks.first().map { it.track.id })
        // Still a favourite: it comes back when the file does.
        assertTrue(repo.isFavorite(bravo).first())
    }

    @Test
    fun vanishedTracksAreSkippedAndDeletedOnesLeaveFavourites() = runTest {
        val (charlie, alpha, _) = tracks
        assertEquals(listOf(charlie), repo.add(listOf(charlie, 9_999L)).added)
        repo.add(listOf(alpha))
        db.trackDao().delete(alpha)
        assertEquals(setOf(charlie), repo.ids.first())
    }
}
