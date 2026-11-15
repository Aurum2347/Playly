package com.playly.player

import com.playly.player.data.db.BrowseTrack
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.browse.AlbumSort
import com.playly.player.data.library.browse.CollectionKeys
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.browse.GroupSort
import com.playly.player.data.library.browse.LibraryIndex
import com.playly.player.data.library.browse.matching
import com.playly.player.data.library.browse.sortedFor
import com.playly.player.playback.PlaybackSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 7: grouping of the library into albums, artists, genres and folders. */
class LibraryBrowseTest {
    private fun row(
        id: Long,
        title: String,
        artist: String? = null,
        album: String? = null,
        albumArtist: String? = null,
        genre: String? = null,
        year: Int? = null,
        folder: String? = null,
        track: Int? = null,
        disc: Int? = null,
        added: Long = 0,
    ) = BrowseTrack(
        track = TrackListItem(
            id = id, uri = "content://doc/$id", mediaStoreId = null, albumId = null, title = title, artist = artist, album = album,
            durationMs = 1_000, sizeBytes = 0, dateModified = 0, dateAdded = added, trackNumber = track, discNumber = disc,
        ),
        albumArtist = albumArtist,
        genre = genre,
        year = year,
        folderPath = folder,
        searchKey = listOfNotNull(title, artist, album).joinToString(" ").lowercase(),
    )

    @Test
    fun albumsGroupByTitleAndAlbumArtistIgnoringCase() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "b", artist = "A", album = "Night", albumArtist = "A", track = 2),
                row(2, "a", artist = "A", album = "night", albumArtist = "a", track = 1),
                row(3, "c", artist = "B", album = "Night", albumArtist = "B"),
                row(4, "d", artist = "C"),
            ),
        )
        assertEquals(2, index.albums.size)
        val first = index.albums.first { it.artist == "A" }
        // Track number order inside the album, not title order.
        assertEquals(listOf(2L, 1L), first.tracks.map { it.id })
        assertFalse(index.albums.any { album -> album.tracks.any { it.id == 4L } })
    }

    @Test
    fun withoutAlbumArtistTheFolderDecidesAndDiscFoldersMerge() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "a", artist = "X", album = "Greatest Hits", folder = "Music/X"),
                row(2, "b", artist = "Y", album = "Greatest Hits", folder = "Music/Y"),
                row(3, "c", artist = "P", album = "Mix", folder = "Music/Mix/CD1", disc = 1),
                row(4, "d", artist = "Q", album = "Mix", folder = "Music/Mix/CD 2", disc = 2),
            ),
        )
        assertEquals(2, index.albums.count { it.name == "Greatest Hits" })
        val mix = index.albums.single { it.name == "Mix" }
        assertEquals(listOf(3L, 4L), mix.tracks.map { it.id })
        assertTrue(mix.variousArtists)
        assertNull(mix.artist)
        // The key of one track reaches the same album ("Go to album" in the track menu).
        val key = CollectionKeys.album("MIX", null, "Music/Mix/CD 2")
        assertEquals(mix, index.group(CollectionKind.Album, key!!))
    }

    @Test
    fun artistsKeepUnknownLastAndReadAlbumByAlbum() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "a", artist = "Zed", album = "Second", albumArtist = "Zed", track = 1),
                row(2, "b", artist = "zed", album = "First", albumArtist = "Zed", track = 1),
                row(3, "c"),
                row(4, "d", artist = "Ёлка"),
            ),
        )
        assertEquals(listOf("Zed", "Ёлка", null), index.artists.map { it.name })
        val zed = index.group(CollectionKind.Artist, CollectionKeys.artist("ZED"))!!
        assertEquals(listOf(2L, 1L), zed.tracks.map { it.id })
        assertEquals(listOf("First", "Second"), index.albumsOf(zed).map { it.name })
        assertEquals(CollectionKeys.UNKNOWN_ARTIST, index.artists.last().key)
        // ё and case are ignored when filtering.
        assertEquals(listOf("Ёлка"), index.artists.matching("елк").map { it.name })
    }

    @Test
    fun genreTagsSplitAndMerge() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "a", genre = "Rock; Pop"),
                row(2, "b", genre = "rock"),
                row(3, "c", genre = "Jazz/Blues"),
                row(4, "d"),
            ),
        )
        assertEquals(listOf("Blues", "Jazz", "Pop", "Rock"), index.genres.map { it.name })
        assertEquals(2, index.genres.first { it.name == "Rock" }.tracks.size)
        assertEquals(listOf("Rock"), index.genres.sortedFor(GroupSort.TrackCount).take(1).map { it.name })
        assertTrue(LibraryIndex.build(listOf(row(1, "a"))).genres.isEmpty())
    }

    @Test
    fun folderTreeStartsAtTheMusicFolder() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "root file", folder = "Music/Lib"),
                row(2, "deep", folder = "Music/Lib/B/Inner"),
                row(3, "a file", folder = "Music/Lib/A"),
                row(4, "no path"),
            ),
        )
        val root = index.rootFolder!!
        assertEquals("Music/Lib", root.path)
        assertEquals(listOf("A", "B"), root.subfolders.map { it.name })
        assertEquals(listOf(4L, 1L), root.tracks.map { it.id })
        // Own files first, then subfolders depth first: the folder's play order.
        assertEquals(listOf(4L, 1L, 3L, 2L), root.allTracks.map { it.id })
        assertNotNull(index.folder("Music/Lib/B/Inner"))
        assertEquals(listOf("A", "B", "Inner"), index.allFolders.map { it.name })
        assertNull(LibraryIndex.build(emptyList()).rootFolder)
    }

    @Test
    fun albumSortsAreStableWithMissingValuesLast() {
        val index = LibraryIndex.build(
            listOf(
                row(1, "a", artist = "B", album = "Old", albumArtist = "B", year = 1990, added = 5),
                row(2, "b", artist = "A", album = "New", albumArtist = "A", year = 2020, added = 1),
                row(3, "c", artist = "C", album = "Undated", albumArtist = "C", added = 9),
            ),
        )
        assertEquals(listOf("New", "Old", "Undated"), index.albums.map { it.name })
        assertEquals(listOf("New", "Old", "Undated"), index.albums.sortedFor(AlbumSort.Year).map { it.name })
        assertEquals(listOf("Undated", "Old", "New"), index.albums.sortedFor(AlbumSort.DateAdded).map { it.name })
        assertEquals(listOf("A", "B", "C"), index.albums.sortedFor(AlbumSort.Artist).map { it.artist })
        assertEquals(AlbumSort.Title, AlbumSort.fromName("bogus"))
        assertEquals(GroupSort.Name, GroupSort.fromName(null))
    }

    @Test
    fun trackFilterKeepsTheShownOrder() {
        val index = LibraryIndex.build(listOf(row(1, "Alpha", artist = "Echo"), row(2, "Beta", artist = "x"), row(3, "Gamma echo")))
        val reversed = index.tracks.reversed()
        assertEquals(listOf(3L, 1L), index.filterTracks(reversed, " ECHO ").map { it.id })
        assertEquals(reversed, index.filterTracks(reversed, "  "))
    }

    @Test
    fun newPlaybackSourcesRoundTrip() {
        val source = PlaybackSource(PlaybackSource.Kind.Album, "Night")
        assertEquals(source, PlaybackSource.parse(source.kind.name, source.label))
        assertEquals(PlaybackSource.Kind.Folder, PlaybackSource.parse("Folder", null)?.kind)
    }
}
