package com.playly.player.data.library

import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackListItem

/** How the "All tracks" list is ordered. Persisted by name, so renaming an entry resets it to [Title]. */
enum class TrackSort {
    /** A→Z by title (the database order: case-, accent- and ё-insensitive). */
    Title,
    /** By artist, then album in track order. Tracks without an artist go last. */
    Artist,
    /** By album, disc and track number. Tracks without an album go last. */
    Album,
    /** Newest files first. */
    DateAdded,
    /** Longest first. */
    Duration;

    companion object {
        fun fromName(name: String?): TrackSort = entries.firstOrNull { it.name == name } ?: Title
    }
}

/**
 * Orders [tracks], which must come in [TrackSort.Title] order (as the database returns them):
 * every sort is stable, so ties keep the title order. Keys are normalised once per track,
 * not per comparison, so thousands of tracks sort in a few milliseconds.
 */
fun List<TrackListItem>.sortedFor(sort: TrackSort): List<TrackListItem> = when (sort) {
    TrackSort.Title -> this
    TrackSort.DateAdded -> sortedByDescending { it.dateAdded }
    TrackSort.Duration -> sortedByDescending { it.durationMs }
    TrackSort.Artist -> map { SortKey(it, SearchText.normalize(it.artist.orEmpty()), SearchText.normalize(it.album.orEmpty())) }
        .sortedWith(byText(SortKey::primary).then(byText(SortKey::secondary)).then(inAlbumOrder))
        .map { it.track }
    TrackSort.Album -> map { SortKey(it, SearchText.normalize(it.album.orEmpty()), "") }
        .sortedWith(byText(SortKey::primary).then(inAlbumOrder))
        .map { it.track }
}

private class SortKey(val track: TrackListItem, val primary: String, val secondary: String)

/** Text order with empty values ("unknown artist") after everything else. */
private fun byText(selector: (SortKey) -> String) = Comparator<SortKey> { a, b ->
    val x = selector(a)
    val y = selector(b)
    when {
        x.isEmpty() && y.isEmpty() -> 0
        x.isEmpty() -> 1
        y.isEmpty() -> -1
        else -> x.compareTo(y)
    }
}

/** Disc, then track number; tracks without numbers keep their (title) order after numbered ones. */
private val inAlbumOrder = compareBy<SortKey, Int?>(nullsLast()) { it.track.discNumber ?: if (it.track.trackNumber != null) 1 else null }
    .thenBy(nullsLast()) { it.track.trackNumber }
