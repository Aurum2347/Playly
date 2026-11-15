package com.playly.player.data.library.browse

import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackListItem

/** What a collection page shows. Stored by name in routes and playback sources. */
enum class CollectionKind { Album, Artist, Genre, Folder }

/**
 * An album, an artist or a genre (stage 7). [key] identifies it across rescans (normalised tags),
 * [name] is null for "Unknown artist", [tracks] are in the order the page plays them.
 */
data class TrackGroup(
    val kind: CollectionKind,
    val key: String,
    val name: String?,
    val tracks: List<TrackListItem>,
    /** Album: its album artist or only artist; null with [variousArtists] or when untagged. */
    val artist: String? = null,
    val variousArtists: Boolean = false,
    val year: Int? = null,
    /** Artist: the albums the artist appears on, in [LibraryIndex.albums] order. */
    val albumKeys: List<String> = emptyList(),
) {
    val totalDurationMs: Long = tracks.sumOf { it.durationMs }
    val latestAdded: Long = tracks.maxOfOrNull { it.dateAdded } ?: 0
    /** Track whose artwork stands for the group. */
    val cover: TrackListItem? = tracks.firstOrNull()
    internal val sortName: String = SearchText.normalize(name.orEmpty())
    internal val sortArtist: String = SearchText.normalize(artist.orEmpty())
    internal val searchKey: String = SearchText.key(name, artist)
}

/**
 * One folder of the music folder tree. [tracks] are the files directly inside, [allTracks]
 * those plus every subfolder's (depth first, by name): the folder's play order.
 */
data class FolderNode(
    val path: String,
    val name: String,
    val subfolders: List<FolderNode>,
    val tracks: List<TrackListItem>,
) {
    val allTracks: List<TrackListItem> = tracks + subfolders.flatMap { it.allTracks }
    val totalDurationMs: Long = allTracks.sumOf { it.durationMs }
    val cover: TrackListItem? = allTracks.firstOrNull()
    internal val sortName: String = SearchText.normalize(name)
}

/** Album tab order. */
enum class AlbumSort {
    Title, Artist,
    /** Newest year first; albums without a year last. */
    Year,
    /** Most recently added first. */
    DateAdded;

    companion object {
        fun fromName(name: String?): AlbumSort = entries.firstOrNull { it.name == name } ?: Title
    }
}

/** Artist, genre and folder tab order. */
enum class GroupSort {
    Name,
    /** Most tracks first. */
    TrackCount;

    companion object {
        fun fromName(name: String?): GroupSort = entries.firstOrNull { it.name == name } ?: Name
    }
}

/** Text order with empty values (unknown artist, untagged) after everything else. */
internal fun compareText(x: String, y: String): Int = when {
    x.isEmpty() && y.isEmpty() -> 0
    x.isEmpty() -> 1
    y.isEmpty() -> -1
    else -> x.compareTo(y)
}

fun List<TrackGroup>.sortedFor(sort: AlbumSort): List<TrackGroup> = when (sort) {
    AlbumSort.Title -> sortedWith { a, b -> compareText(a.sortName, b.sortName).takeIf { it != 0 } ?: compareText(a.sortArtist, b.sortArtist) }
    AlbumSort.Artist -> sortedWith { a, b -> compareText(a.sortArtist, b.sortArtist).takeIf { it != 0 } ?: compareText(a.sortName, b.sortName) }
    AlbumSort.Year -> sortedFor(AlbumSort.Title).sortedWith(compareByDescending(nullsFirst()) { it.year })
    AlbumSort.DateAdded -> sortedFor(AlbumSort.Title).sortedByDescending { it.latestAdded }
}

fun List<TrackGroup>.sortedFor(sort: GroupSort): List<TrackGroup> {
    val byName = sortedWith { a, b -> compareText(a.sortName, b.sortName) }
    return if (sort == GroupSort.TrackCount) byName.sortedByDescending { it.tracks.size } else byName
}

fun List<FolderNode>.sortedFoldersFor(sort: GroupSort): List<FolderNode> {
    val byName = sortedWith { a, b -> compareText(a.sortName, b.sortName) }
    return if (sort == GroupSort.TrackCount) byName.sortedByDescending { it.allTracks.size } else byName
}

/** Groups whose name (or album artist) contains [query]; case-, accent- and ё-insensitive. */
fun List<TrackGroup>.matching(query: String): List<TrackGroup> {
    val key = SearchText.normalize(query)
    return if (key.isEmpty()) this else filter { it.searchKey.contains(key) }
}
