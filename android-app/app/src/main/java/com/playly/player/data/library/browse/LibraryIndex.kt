package com.playly.player.data.library.browse

import com.playly.player.core.SearchText
import com.playly.player.data.db.BrowseTrack
import com.playly.player.data.db.TrackListItem

/**
 * The library grouped for the tabs (spec §6): albums, artists, genres and the folder tree.
 * Built off the main thread from one query; pure Kotlin, so the rules are unit-tested.
 * [tracks] keep the database (title) order.
 */
class LibraryIndex private constructor(
    val tracks: List<TrackListItem>,
    private val searchKeys: Map<Long, String>,
    /** In [AlbumSort.Title] order. */
    val albums: List<TrackGroup>,
    /** By name, "Unknown artist" last. */
    val artists: List<TrackGroup>,
    val genres: List<TrackGroup>,
    /** Null when the library is empty. */
    val rootFolder: FolderNode?,
) {
    private val albumsByKey = albums.associateBy { it.key }
    private val artistsByKey = artists.associateBy { it.key }
    private val genresByKey = genres.associateBy { it.key }
    private val foldersByPath: Map<String, FolderNode> = buildMap {
        fun add(node: FolderNode) {
            put(node.path, node)
            node.subfolders.forEach(::add)
        }
        rootFolder?.let(::add)
    }

    /** Every folder below the root (for the folder filter), in tree order. */
    val allFolders: List<FolderNode> get() = foldersByPath.values.filter { it !== rootFolder }

    fun group(kind: CollectionKind, key: String): TrackGroup? = when (kind) {
        CollectionKind.Album -> albumsByKey[key]
        CollectionKind.Artist -> artistsByKey[key]
        CollectionKind.Genre -> genresByKey[key]
        CollectionKind.Folder -> null
    }

    fun folder(path: String): FolderNode? = foldersByPath[path]

    fun albumsOf(artist: TrackGroup): List<TrackGroup> = artist.albumKeys.mapNotNull { albumsByKey[it] }

    /** Tracks whose title, artist or album contains [query]; keeps the order of [list]. */
    fun filterTracks(list: List<TrackListItem>, query: String): List<TrackListItem> {
        val key = SearchText.normalize(query)
        if (key.isEmpty()) return list
        return list.filter { searchKeys[it.id]?.contains(key) == true }
    }

    companion object {
        val EMPTY: LibraryIndex by lazy { build(emptyList()) }

        fun build(rows: List<BrowseTrack>): LibraryIndex {
            val albumRows = LinkedHashMap<String, MutableList<BrowseTrack>>()
            val artistRows = LinkedHashMap<String, MutableList<BrowseTrack>>()
            val genreRows = LinkedHashMap<String, MutableList<BrowseTrack>>()
            val genreNames = HashMap<String, String>()
            for (row in rows) {
                val t = row.track
                CollectionKeys.album(t.album, row.albumArtist, row.folderPath)?.let { albumRows.getOrPut(it, ::ArrayList) += row }
                artistRows.getOrPut(CollectionKeys.artist(t.artist), ::ArrayList) += row
                for ((key, name) in CollectionKeys.genres(row.genre)) {
                    genreRows.getOrPut(key, ::ArrayList) += row
                    genreNames.putIfAbsent(key, name)
                }
            }
            val albums = albumRows.map { (key, list) -> album(key, list) }.sortedFor(AlbumSort.Title)
            val albumOrder = albums.withIndex().associate { it.value.key to it.index }
            val artists = artistRows.map { (key, list) ->
                val albumKeys = list.mapNotNull { CollectionKeys.album(it.track.album, it.albumArtist, it.folderPath) }
                    .distinct()
                    .sortedBy { albumOrder[it] ?: Int.MAX_VALUE }
                TrackGroup(
                    kind = CollectionKind.Artist,
                    key = key,
                    name = if (key == CollectionKeys.UNKNOWN_ARTIST) null else list.first().track.artist,
                    tracks = list.sortedWith(byAlbum(albumOrder)).map { it.track },
                    albumKeys = albumKeys,
                )
            }.sortedFor(GroupSort.Name)
            val genres = genreRows.map { (key, list) ->
                TrackGroup(CollectionKind.Genre, key, genreNames[key], list.map { it.track })
            }.sortedFor(GroupSort.Name)
            return LibraryIndex(
                tracks = rows.map { it.track },
                searchKeys = rows.associate { it.track.id to it.searchKey },
                albums = albums,
                artists = artists,
                genres = genres,
                rootFolder = FolderTree.build(rows),
            )
        }

        private fun album(key: String, rows: List<BrowseTrack>): TrackGroup {
            val first = rows.first()
            val albumArtist = rows.firstNotNullOfOrNull { it.albumArtist?.takeIf(String::isNotBlank) }
            val artists = rows.mapNotNull { it.track.artist?.takeIf(String::isNotBlank) }.distinctBy { SearchText.normalize(it) }
            return TrackGroup(
                kind = CollectionKind.Album,
                key = key,
                name = first.track.album,
                tracks = rows.sortedWith(inAlbumOrder).map { it.track },
                artist = albumArtist ?: artists.singleOrNull(),
                variousArtists = albumArtist == null && artists.size > 1,
                year = rows.mapNotNull { it.year }.maxOrNull(),
            )
        }

        /** Disc, then track number; unnumbered tracks keep their (title) order after numbered ones. */
        internal val inAlbumOrder: Comparator<BrowseTrack> =
            compareBy<BrowseTrack, Int?>(nullsLast()) { it.track.discNumber ?: if (it.track.trackNumber != null) 1 else null }
                .thenBy(nullsLast()) { it.track.trackNumber }

        /** An artist's page reads album by album; tracks without an album come last. */
        private fun byAlbum(albumOrder: Map<String, Int>): Comparator<BrowseTrack> =
            compareBy<BrowseTrack> { row ->
                CollectionKeys.album(row.track.album, row.albumArtist, row.folderPath)?.let { albumOrder[it] } ?: Int.MAX_VALUE
            }.then(inAlbumOrder)
    }
}
