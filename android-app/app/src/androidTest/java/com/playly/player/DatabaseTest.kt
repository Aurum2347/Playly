package com.playly.player

import android.os.SystemClock
import android.util.Log
import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.room.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.playly.player.core.SearchText
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.PlaylistEntity
import com.playly.player.data.db.PlaylistEntryEntity
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SQLITE_MAX_ARGS
import com.playly.player.data.db.TrackEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DatabaseTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), PlaylyDatabase::class.java)

    /** v1 to current keeps every row (playlists above all) and matches the entities exactly. */
    @Test fun migrationKeepsData() {
        helper.createDatabase(MIGRATION_DB, 1).apply {
            execSQL("INSERT INTO library_sources (id, tree_uri, display_name, added_at) VALUES (1, 'content://tree/1', 'Music', 0)")
            execSQL(
                "INSERT INTO tracks (id, uri, source_id, title, duration_ms, size_bytes, file_name, folder_path, " +
                    "date_added, date_modified, search_key, is_available) " +
                    "VALUES (1, 'content://doc/1', 1, 'Song', 1000, 10, 'song.mp3', 'Music', 0, 0, 'song', 1)",
            )
            execSQL("INSERT INTO playlists (id, name, created_at, updated_at) VALUES (1, 'Mix', 0, 0)")
            execSQL("INSERT INTO playlist_entries (playlist_id, track_id, position, added_at) VALUES (1, 1, 0, 0)")
            close()
        }
        val migrated = helper.runMigrationsAndValidate(MIGRATION_DB, PlaylyDatabase.VERSION, true, *PlaylyDatabase.MIGRATIONS)
        try {
            migrated.query("SELECT is_accessible FROM library_sources WHERE id = 1").use {
                assertTrue(it.moveToFirst())
                assertEquals(1, it.getInt(0))
            }
            migrated.query("SELECT album_id FROM tracks WHERE id = 1").use {
                assertTrue(it.moveToFirst())
                assertTrue(it.isNull(0))
            }
            migrated.query("SELECT COUNT(*) FROM playlist_entries").use {
                assertTrue(it.moveToFirst())
                assertEquals(1, it.getInt(0))
            }
        } finally {
            migrated.close()
        }
    }

    @Test fun unicodeSearchAndPlaylistSummary() = runTest {
        val db = memoryDb()
        try {
            fun track(uri: String, title: String, artist: String) = TrackEntity(
                uri = uri, title = title, artist = artist, durationMs = 60_000, fileName = "$title.mp3",
                dateAdded = 0, dateModified = 0, searchKey = SearchText.key(title, artist),
            )
            val ids = db.trackDao().insertAll(listOf(track("u1", "Ёлка", "Кино"), track("u2", "Beyoncé", "Halo")))
            assertEquals(listOf("Ёлка"), db.trackDao().search(SearchText.escapeLike(SearchText.normalize("ЕЛКА")), 10).map { it.title })
            assertEquals(listOf("Beyoncé"), db.trackDao().search(SearchText.escapeLike(SearchText.normalize("beyonce")), 10).map { it.title })
            assertEquals(0, db.trackDao().search(SearchText.escapeLike("%"), 10).size)

            val playlist = db.playlistDao().insert(PlaylistEntity(name = "Mix", createdAt = 0, updatedAt = 0))
            // The same track twice is kept: entries never silently de-duplicate.
            db.playlistDao().insertEntries(
                ids.mapIndexed { i, id -> PlaylistEntryEntity(playlistId = playlist, trackId = id, position = i, addedAt = 0) } +
                    PlaylistEntryEntity(playlistId = playlist, trackId = ids[0], position = 2, addedAt = 0),
            )
            val summary = db.playlistDao().observeSummaries().first().single()
            assertEquals(3, summary.trackCount)
            assertEquals(180_000L, summary.totalDurationMs)
            assertEquals(2, db.trackDao().observeSummary().first().trackCount)
        } finally {
            db.close()
        }
    }

    /**
     * Large-library path: 10k rows written in one transaction, listed, flagged missing in
     * chunks below SQLite's argument limit; folder cleanup spares tracks used by playlists.
     */
    @Test fun largeLibraryWritesAndCleanup() = runTest {
        val db = memoryDb()
        try {
            val tracks = db.trackDao()
            val count = 10_000
            val rows = (1..count).map { i ->
                TrackEntity(
                    uri = "content://media/external/audio/media/$i",
                    mediaStoreId = i.toLong(),
                    title = "Track $i",
                    durationMs = 1_000,
                    sizeBytes = i.toLong(),
                    fileName = "t$i.mp3",
                    folderPath = "Music",
                    dateAdded = 0,
                    dateModified = 0,
                    searchKey = SearchText.key("Track $i"),
                )
            }
            val insertStarted = SystemClock.elapsedRealtime()
            db.withTransaction { rows.chunked(500).forEach { tracks.insertAll(it) } }
            val insertMs = SystemClock.elapsedRealtime() - insertStarted
            val listStarted = SystemClock.elapsedRealtime()
            val list = tracks.observeList().first()
            val listMs = SystemClock.elapsedRealtime() - listStarted
            Log.i("PlaylyPerf", "insert $count rows: $insertMs ms, list query: $listMs ms")
            assertEquals(count, list.size)
            assertTrue("Insert took $insertMs ms", insertMs < 15_000)
            assertTrue("List query took $listMs ms", listMs < 3_000)

            val stored = tracks.mediaStoreTracks()
            val missing = stored.take(2_500).map { it.id }
            db.withTransaction { missing.chunked(SQLITE_MAX_ARGS).forEach { tracks.markMissing(it, 42) } }
            assertEquals(count - 2_500, tracks.observeSummary().first().trackCount)
            assertEquals(2_500, tracks.observeUnavailableCount().first())

            // Removing a folder: its track in a playlist survives (flagged), the other is forgotten.
            val source = db.librarySourceDao().insert(LibrarySourceEntity(treeUri = "content://tree/x", displayName = "X", addedAt = 0))
            val folderIds = tracks.insertAll(
                listOf("a", "b").map { name ->
                    TrackEntity(
                        uri = "content://doc/$name",
                        sourceId = source,
                        title = name,
                        fileName = "$name.mp3",
                        dateAdded = 0,
                        dateModified = 0,
                        searchKey = name,
                    )
                },
            )
            val playlist = db.playlistDao().insert(PlaylistEntity(name = "Keep", createdAt = 0, updatedAt = 0))
            db.playlistDao().insertEntries(listOf(PlaylistEntryEntity(playlistId = playlist, trackId = folderIds[0], position = 0, addedAt = 0)))
            db.withTransaction {
                tracks.deleteUnreferencedFromSource(source)
                tracks.markSourceMissing(source, 1)
                db.librarySourceDao().delete(source)
            }
            assertEquals(1, db.playlistDao().observeSummaries().first().single().trackCount)
            val orphans = tracks.folderTracks(source)
            assertEquals(listOf(folderIds[0]), orphans.map { it.id })
            assertFalse(orphans.single().isAvailable)

            // Merging a folder twin into its MediaStore row keeps the playlist entry.
            db.playlistDao().moveEntries(from = folderIds[0], to = stored.last().id)
            tracks.deleteAll(listOf(folderIds[0]))
            assertEquals(1, db.playlistDao().observeSummaries().first().single().trackCount)
        } finally {
            db.close()
        }
    }

    private fun memoryDb(): PlaylyDatabase =
        Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, PlaylyDatabase::class.java).build()

    private companion object {
        const val MIGRATION_DB = "migration-test"
    }
}
