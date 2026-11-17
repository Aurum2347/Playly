package com.playly.player.data.tags

/**
 * The tags Playly edits, as on the desktop ("write_track_tags"): title (required), artist,
 * album and genre. A blank field removes the tag instead of writing an empty string, so other
 * players show their own "unknown".
 */
data class TagEdit(
    val title: String,
    val artist: String = "",
    val album: String = "",
    val genre: String = "",
) {
    /** Trimmed, control characters dropped, each field capped. */
    fun cleaned(): TagEdit = TagEdit(clean(title), clean(artist), clean(album), clean(genre))

    val isValid: Boolean get() = clean(title).isNotEmpty()

    /** Field values in a fixed order, blank ones as null. */
    fun values(): Map<TagField, String?> = mapOf(
        TagField.Title to title.ifBlank { null },
        TagField.Artist to artist.ifBlank { null },
        TagField.Album to album.ifBlank { null },
        TagField.Genre to genre.ifBlank { null },
    )

    companion object {
        const val MAX_LENGTH = 500

        fun clean(value: String): String =
            value.filter { it >= ' ' || it == '\t' }.replace('\t', ' ').trim().take(MAX_LENGTH).trim()
    }
}

enum class TagField { Title, Artist, Album, Genre }

/** Container formats Playly can rewrite. WAV is not here: Android does not read its tags back. */
enum class TagFormat {
    Mp3, Flac, Ogg, Mp4;

    companion object {
        /** By file name (and MIME type as a fallback); the writer checks the bytes again. */
        fun of(fileName: String, mimeType: String?): TagFormat? {
            val ext = fileName.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "mp3" -> Mp3
                "flac" -> Flac
                "ogg", "oga", "opus" -> Ogg
                "m4a", "m4b", "mp4" -> Mp4
                "" -> when (mimeType?.lowercase()) {
                    "audio/mpeg" -> Mp3
                    "audio/flac", "audio/x-flac" -> Flac
                    "audio/ogg", "audio/opus", "application/ogg" -> Ogg
                    "audio/mp4", "audio/x-m4a", "audio/m4a" -> Mp4
                    else -> null
                }
                else -> null
            }
        }
    }
}

/** Why a file could not be rewritten. The original is never touched when this is thrown. */
class TagWriteException(val reason: Reason, message: String) : Exception(message) {
    enum class Reason {
        /** Not one of [TagFormat], or a variant Playly does not rewrite (ID3v2.2, fragmented MP4, multiplexed Ogg). */
        Unsupported,
        /** The file does not look like what its name says, or its structure is broken. */
        Damaged,
    }
}

internal fun unsupported(message: String): Nothing = throw TagWriteException(TagWriteException.Reason.Unsupported, message)

internal fun damaged(message: String): Nothing = throw TagWriteException(TagWriteException.Reason.Damaged, message)
