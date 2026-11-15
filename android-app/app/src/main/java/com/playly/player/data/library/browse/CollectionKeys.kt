package com.playly.player.data.library.browse

import com.playly.player.core.SearchText

/**
 * Stable keys of collections, computed the same way for the library tabs and for a single
 * track ("Open album" in its menu), so both reach the same page.
 */
object CollectionKeys {
    /** Key of the "Unknown artist" group (normalised names are never control characters). */
    const val UNKNOWN_ARTIST = "\u0001"
    private const val SEPARATOR = '\u001F'
    /** "CD1", "Disc 2", "Диск 3" sub-folders belong to their parent album folder. */
    private val discFolder = Regex("""/(cd|disc|disk|диск)\s*\d+$""", RegexOption.IGNORE_CASE)

    /**
     * Same album title and album artist. Without an album artist the folder decides, so a
     * compilation in one folder stays one album, and two untagged "Greatest Hits" do not merge.
     */
    fun album(album: String?, albumArtist: String?, folderPath: String?): String? {
        val title = SearchText.normalize(album.orEmpty())
        if (title.isEmpty()) return null
        val artist = SearchText.normalize(albumArtist.orEmpty())
        val scope = if (artist.isNotEmpty()) "a$artist" else "f" + folderPath.orEmpty().replace(discFolder, "")
        return "$title$SEPARATOR$scope"
    }

    fun artist(artist: String?): String = SearchText.normalize(artist.orEmpty()).ifEmpty { UNKNOWN_ARTIST }

    /** A genre tag may hold several values: "Rock; Pop", "Rock/Pop", "Rock, Pop". */
    fun genres(genre: String?): List<Pair<String, String>> =
        genre.orEmpty().split(';', '/', ',', '\u0000')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { SearchText.normalize(it) to it }
            .distinctBy { it.first }
}
