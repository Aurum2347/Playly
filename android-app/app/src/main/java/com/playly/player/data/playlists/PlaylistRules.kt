package com.playly.player.data.playlists

import com.playly.player.core.SearchText
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.artwork.artwork
import com.playly.player.data.db.PlaylistSummary
import com.playly.player.data.db.PlaylistTrackRow
import com.playly.player.data.db.TrackListItem

/** How a playlist page is ordered. [code] is stored in the database (playlists.sort_order). */
enum class PlaylistSort(val code: Int) {
    /** The user's own order (drag to reorder). */
    Manual(0),
    Title(1),
    /** Artist, then album in track order. */
    Artist(2),
    /** Album, disc and track number. */
    Album(3),
    /** Newest additions to the playlist first. */
    DateAdded(4),
    /** Longest first. */
    Duration(5);

    companion object {
        fun fromCode(code: Int): PlaylistSort = entries.firstOrNull { it.code == code } ?: Manual
    }
}

/** A playlist for lists and cards: summary plus up to four covers for its automatic artwork. */
data class PlaylistCard(val summary: PlaylistSummary, val covers: List<Artwork>) {
    val id: Long get() = summary.playlist.id
    val name: String get() = summary.playlist.name
    val coverUri: String? get() = summary.playlist.coverUri
}

object PlaylistRules {
    const val MAX_NAME_LENGTH = 100
    const val MAX_DESCRIPTION_LENGTH = 500

    /** Trimmed name, or null when nothing is left (the dialog keeps "Save" disabled). */
    fun cleanName(input: String): String? = input.trim().take(MAX_NAME_LENGTH).trim().takeIf { it.isNotEmpty() }

    fun cleanDescription(input: String?): String? = input?.trim()?.take(MAX_DESCRIPTION_LENGTH)?.trim()?.takeIf { it.isNotEmpty() }

    /**
     * The automatic cover: four different covers as a 2×2 grid when the playlist has at least
     * four albums, otherwise the first track's cover. Tracks without an album count by themselves.
     */
    fun coverArtworks(tracks: List<TrackListItem>): List<Artwork> {
        if (tracks.isEmpty()) return emptyList()
        val distinct = tracks.distinctBy { track ->
            track.albumId?.let { "a$it" }
                ?: track.album?.takeIf { it.isNotBlank() }?.let { "n" + SearchText.normalize(it) }
                ?: "t${track.id}"
        }
        return if (distinct.size >= 4) distinct.take(4).map { it.artwork() } else listOf(tracks.first().artwork())
    }

    /**
     * Rows in [sort] order. Input is the manual order; every sort is stable, so ties keep it.
     * Keys are normalised once per row, not per comparison.
     */
    fun sorted(rows: List<PlaylistTrackRow>, sort: PlaylistSort): List<PlaylistTrackRow> = when (sort) {
        PlaylistSort.Manual -> rows
        PlaylistSort.DateAdded -> rows.sortedByDescending { it.entryAddedAt }
        PlaylistSort.Duration -> rows.sortedByDescending { it.track.durationMs }
        PlaylistSort.Title -> rows.map { Key(it, SearchText.normalize(it.track.title), "") }
            .sortedWith(byText(Key::primary)).map { it.row }
        PlaylistSort.Artist -> rows.map { Key(it, SearchText.normalize(it.track.artist.orEmpty()), SearchText.normalize(it.track.album.orEmpty())) }
            .sortedWith(byText(Key::primary).then(byText(Key::secondary)).then(inAlbumOrder)).map { it.row }
        PlaylistSort.Album -> rows.map { Key(it, SearchText.normalize(it.track.album.orEmpty()), "") }
            .sortedWith(byText(Key::primary).then(inAlbumOrder)).map { it.row }
    }

    /** Moves the item at [from] to [to] (indices of the list before the move). */
    fun <T> moved(list: List<T>, from: Int, to: Int): List<T> {
        if (from !in list.indices) return list
        val result = list.toMutableList()
        val item = result.removeAt(from)
        result.add(to.coerceIn(0, result.size), item)
        return result
    }

    private class Key(val row: PlaylistTrackRow, val primary: String, val secondary: String)

    /** Text order with empty values ("unknown artist") last. */
    private fun byText(selector: (Key) -> String) = Comparator<Key> { a, b ->
        val x = selector(a)
        val y = selector(b)
        when {
            x.isEmpty() && y.isEmpty() -> 0
            x.isEmpty() -> 1
            y.isEmpty() -> -1
            else -> x.compareTo(y)
        }
    }

    private val inAlbumOrder = compareBy<Key, Int?>(nullsLast()) { it.row.track.discNumber ?: if (it.row.track.trackNumber != null) 1 else null }
        .thenBy(nullsLast()) { it.row.track.trackNumber }
}
