package com.playly.player.data.backup

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/** Stage 9.2: one track line of an M3U playlist with what its #EXTINF said. */
data class M3uEntry(val path: String, val title: String? = null, val artist: String? = null, val durationMs: Long = 0) {
    fun toRef() = TrackRef(path = path, title = title, artist = artist, durationMs = durationMs)
}

data class M3uPlaylist(val name: String?, val entries: List<M3uEntry>)

/**
 * Extended M3U, as other players read and write it: "#EXTM3U", then "#EXTINF:<seconds>,
 * <artist> - <title>" before each path. Written as UTF-8 (.m3u8); reading also accepts the
 * Windows-1251 files of older players.
 */
object M3u {
    private const val HEADER = "#EXTM3U"
    private const val INFO = "#EXTINF:"
    private const val NAME = "#PLAYLIST:"
    private const val BOM = "\uFEFF"

    fun write(name: String, entries: List<M3uEntry>): String = buildString {
        append(HEADER).append('\n')
        append(NAME).append(oneLine(name)).append('\n')
        for (entry in entries) {
            val seconds = if (entry.durationMs > 0) (entry.durationMs + 500) / 1000 else -1
            val label = listOfNotNull(entry.artist?.takeIf { it.isNotBlank() }, entry.title).joinToString(" - ")
            append(INFO).append(seconds).append(',').append(oneLine(label)).append('\n')
            append(entry.path).append('\n')
        }
    }

    fun decode(bytes: ByteArray): String {
        val strict = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val text = try {
            strict.decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) {
            String(bytes, Charset.forName("windows-1251"))
        }
        return text.removePrefix(BOM)
    }

    fun parse(text: String): M3uPlaylist {
        var name: String? = null
        var info: Pair<Long, String?>? = null
        val entries = ArrayList<M3uEntry>()
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            when {
                line.isEmpty() -> Unit
                line.startsWith(NAME) -> name = line.removePrefix(NAME).trim().takeIf { it.isNotEmpty() }
                line.startsWith(INFO) -> info = parseInfo(line.removePrefix(INFO))
                line.startsWith("#") -> Unit
                // Streams are not local files: nothing in the library can match them.
                line.contains("://") && !line.startsWith("file://") -> info = null
                else -> {
                    val (durationMs, label) = info ?: (0L to null)
                    val (artist, title) = splitLabel(label)
                    entries += M3uEntry(Uri.decodeFileUrl(line), title, artist, durationMs)
                    info = null
                }
            }
        }
        return M3uPlaylist(name, entries)
    }

    private fun parseInfo(value: String): Pair<Long, String?> {
        val comma = value.indexOf(',')
        val seconds = (if (comma < 0) value else value.substring(0, comma)).trim().substringBefore(' ').toLongOrNull() ?: -1
        val label = if (comma < 0) null else value.substring(comma + 1).trim().takeIf { it.isNotEmpty() }
        return (if (seconds > 0) seconds * 1000 else 0L) to label
    }

    /** "Artist - Title"; without the separator the whole label is the title. */
    private fun splitLabel(label: String?): Pair<String?, String?> {
        if (label == null) return null to null
        val cut = label.indexOf(" - ")
        return if (cut <= 0) null to label else label.substring(0, cut).trim() to label.substring(cut + 3).trim()
    }

    private fun oneLine(text: String) = text.replace('\n', ' ').replace('\r', ' ')

    private object Uri {
        /** "file:///storage/My%20Music/a.mp3" → "/storage/My Music/a.mp3"; plain paths stay. */
        fun decodeFileUrl(line: String): String {
            if (!line.startsWith("file://")) return line
            return runCatching { java.net.URLDecoder.decode(line.removePrefix("file://").replace("+", "%2B"), "UTF-8") }
                .getOrDefault(line.removePrefix("file://"))
        }
    }
}
