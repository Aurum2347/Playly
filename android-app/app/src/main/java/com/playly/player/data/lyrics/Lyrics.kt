package com.playly.player.data.lyrics

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/** One timed line of a synced (LRC) text. */
data class LyricLine(val timeMs: Long, val text: String)

/** A track's text: timed lines from LRC, or plain lines (spec §13). */
sealed interface Lyrics {
    data class Synced(val lines: List<LyricLine>) : Lyrics
    data class Plain(val lines: List<String>) : Lyrics
}

/** Where the text came from, shown as a quiet hint on the lyrics page. */
enum class LyricsOrigin { File, Tag }

data class FoundLyrics(val lyrics: Lyrics, val origin: LyricsOrigin)

/**
 * The desktop app's LRC rules (src/lib/lyrics.ts): `[mm:ss.xx]` tags, several per line,
 * `[offset:±ms]`, word tags `<mm:ss.xx>` dropped, metadata tags (`[ar:…]`) ignored.
 * Text without time tags is plain text.
 */
object LrcParser {
    private val TIME_TAG = Regex("""\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]""")
    private val WORD_TAG = Regex("""<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>""")
    private val META_TAG = Regex("""^\[[a-z]+:.*]$""", RegexOption.IGNORE_CASE)
    private val OFFSET_TAG = Regex("""^\[offset:\s*([+-]?\d+)\s*]$""", RegexOption.IGNORE_CASE)

    fun parse(raw: String): Lyrics? {
        val src = raw.trimStart { it.code == BOM }.trim()
        if (src.isEmpty()) return null
        var offsetMs = 0L
        val synced = ArrayList<LyricLine>()
        val plain = ArrayList<String>()
        for (rawLine in src.split('\n')) {
            val line = rawLine.trim()
            val offset = OFFSET_TAG.matchEntire(line)
            if (offset != null) {
                offsetMs = offset.groupValues[1].toLongOrNull() ?: 0L
                continue
            }
            val times = TIME_TAG.findAll(line).map { m ->
                val frac = m.groupValues[3]
                val fracMs = if (frac.isEmpty()) 0L else frac.toLong() * 1000 / pow10(frac.length)
                (m.groupValues[1].toLong() * 60 + m.groupValues[2].toLong()) * 1000 + fracMs
            }.toList()
            val text = line.replace(TIME_TAG, "").replace(WORD_TAG, "").trim()
            if (times.isNotEmpty()) {
                times.forEach { synced += LyricLine(it, text) }
            } else if (!META_TAG.matches(line)) {
                plain += text
            }
        }
        if (synced.isNotEmpty()) {
            // A positive offset shows lines earlier (LRC convention).
            return Lyrics.Synced(synced.map { it.copy(timeMs = (it.timeMs - offsetMs).coerceAtLeast(0)) }.sortedBy { it.timeMs })
        }
        // Blank lines at the edges go; inside they split verses.
        val first = plain.indexOfFirst { it.isNotEmpty() }
        if (first < 0) return null
        val last = plain.indexOfLast { it.isNotEmpty() }
        return Lyrics.Plain(plain.subList(first, last + 1).toList())
    }

    /** The line playing at [positionMs]; -1 before the first line. */
    fun activeLine(lines: List<LyricLine>, positionMs: Long): Int {
        var lo = 0
        var hi = lines.lastIndex
        var ans = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (lines[mid].timeMs <= positionMs) {
                ans = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return ans
    }

    /** Track time from [positionMs] until the next line starts; null after the last line. */
    fun msUntilNext(lines: List<LyricLine>, positionMs: Long): Long? =
        // activeLine points at the last line with a time <= position, so the next one is later.
        lines.getOrNull(activeLine(lines, positionMs) + 1)?.let { it.timeMs - positionMs }

    /** Lines light up this much early, as on the desktop: the eye is a bit slower than the ear. */
    const val LEAD_MS = 150L

    private fun pow10(n: Int): Long {
        var r = 1L
        repeat(n) { r *= 10 }
        return r
    }
}

private const val BOM = 0xFEFF

/** Text files and tags come in many encodings; Russian LRC files are often Windows-1251. */
object LyricsText {
    fun decode(bytes: ByteArray): String {
        val b = bytes
        if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) {
            return String(b, 3, b.size - 3, Charsets.UTF_8)
        }
        if (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16LE)
        if (b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte()) return String(b, 2, b.size - 2, Charsets.UTF_16BE)
        return strictUtf8(b) ?: String(b, Charset.forName("windows-1251"))
    }

    private fun strictUtf8(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }
}

/** Sidecar files, as on the desktop: "song.mp3" → "song.lrc" in the same folder. */
object LyricsFiles {
    /** Document ids to try for the sidecar of an external-storage document id like "primary:Music/a.mp3". */
    fun sidecarIds(documentId: String): List<String> {
        val slash = documentId.lastIndexOf('/')
        val colon = documentId.indexOf(':')
        val nameStart = maxOf(slash, colon) + 1
        if (nameStart <= 0) return emptyList()
        val name = documentId.substring(nameStart)
        val dot = name.lastIndexOf('.')
        val base = documentId.substring(0, nameStart) + (if (dot > 0) name.substring(0, dot) else name)
        return listOf("$base.lrc", "$base.LRC")
    }

    /** Larger than any real lyrics file: a guard against reading a mislabelled big file. */
    const val MAX_BYTES = 1 shl 20
}
