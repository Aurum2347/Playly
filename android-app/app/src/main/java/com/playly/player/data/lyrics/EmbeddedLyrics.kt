package com.playly.player.data.lyrics

import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel

/**
 * Lyrics stored inside the audio file, as the desktop reads them: ID3v2 USLT (mp3),
 * Vorbis comment LYRICS / UNSYNCEDLYRICS (flac) and the "(c)lyr" atom (m4a).
 * Reads only headers and the lyrics itself; covers and audio are skipped by seeking.
 */
object EmbeddedLyrics {
    fun read(channel: SeekableByteChannel): String? {
        val head = readAt(channel, 0, 12) ?: return null
        if (head.ascii(0, 3) == "ID3") {
            val tagEnd = 10L + syncsafe(head, 6)
            val found = id3(channel, head)
            if (found != null) return found
            // FLAC files sometimes carry an ID3 tag in front.
            if (readAt(channel, tagEnd, 4)?.ascii(0, 4) == "fLaC") return flac(channel, tagEnd + 4)
            return null
        }
        if (head.ascii(0, 4) == "fLaC") return flac(channel, 4)
        if (head.ascii(4, 4) == "ftyp") return mp4(channel)
        return null
    }

    private fun id3(channel: SeekableByteChannel, head: ByteArray): String? {
        val major = head[3].toInt()
        val flags = head[5].toInt()
        if (major != 3 && major != 4) return null
        // Whole-tag unsynchronisation (v2.3) is rare and would need byte unstuffing.
        if (major == 3 && flags and 0x80 != 0) return null
        val end = 10L + syncsafe(head, 6)
        var pos = 10L
        if (flags and 0x40 != 0) {
            val ext = readAt(channel, pos, 4) ?: return null
            pos += if (major == 4) syncsafe(ext, 0).toLong() else 4L + int32(ext, 0)
        }
        // USLT wins; a TXXX "LYRICS" (some taggers, ffmpeg) is the fallback.
        var fallback: String? = null
        while (pos + 10 <= end) {
            val frame = readAt(channel, pos, 10) ?: break
            if (frame[0].toInt() == 0) break // padding
            val size = if (major == 4) syncsafe(frame, 4).toLong() else int32(frame, 4)
            if (size <= 0 || pos + 10 + size > end) break
            val id = frame.ascii(0, 4)
            if (id == "USLT" && size <= LyricsFiles.MAX_BYTES) {
                val body = readAt(channel, pos + 10, size.toInt()) ?: break
                uslt(body)?.let { return it }
            } else if (id == "TXXX" && fallback == null && size <= LyricsFiles.MAX_BYTES) {
                fallback = readAt(channel, pos + 10, size.toInt())?.let(::txxxLyrics)
            }
            pos += 10 + size
        }
        return fallback
    }

    /** TXXX: encoding, a description ending in a terminator, then the value. */
    internal fun txxxLyrics(body: ByteArray): String? {
        if (body.size < 2) return null
        val encoding = body[0].toInt()
        val wide = encoding == 1 || encoding == 2
        var i = 1
        if (wide) {
            while (i + 1 < body.size && !(body[i].toInt() == 0 && body[i + 1].toInt() == 0)) i += 2
        } else {
            while (i < body.size && body[i].toInt() != 0) i++
        }
        val name = decodeText(body.copyOfRange(1, i.coerceAtMost(body.size)), encoding).trim()
        if (TXXX_LYRICS.none { it.equals(name, ignoreCase = true) }) return null
        val start = i + if (wide) 2 else 1
        if (start >= body.size) return null
        return decodeText(body.copyOfRange(start, body.size), encoding).takeIf { it.isNotBlank() }
    }

    private fun decodeText(bytes: ByteArray, encoding: Int): String {
        val charset = when (encoding) {
            0 -> Charsets.ISO_8859_1
            1 -> Charsets.UTF_16
            2 -> Charsets.UTF_16BE
            else -> Charsets.UTF_8
        }
        return String(bytes, charset).trimEnd { it.code == 0 }
    }

    private val TXXX_LYRICS = listOf("LYRICS", "UNSYNCEDLYRICS", "USLT")

    /** USLT: encoding, language (3), descriptor ending in a terminator, then the text. */
    internal fun uslt(body: ByteArray): String? {
        if (body.size < 5) return null
        val encoding = body[0].toInt()
        val wide = encoding == 1 || encoding == 2
        var i = 4
        if (wide) {
            while (i + 1 < body.size && !(body[i].toInt() == 0 && body[i + 1].toInt() == 0)) i += 2
            i += 2
        } else {
            while (i < body.size && body[i].toInt() != 0) i++
            i += 1
        }
        if (i >= body.size) return null
        val text = body.copyOfRange(i, body.size)
        val charset = when (encoding) {
            0 -> Charsets.ISO_8859_1
            1 -> Charsets.UTF_16
            2 -> Charsets.UTF_16BE
            else -> Charsets.UTF_8
        }
        return String(text, charset).trimEnd { it.code == 0 }.takeIf { it.isNotBlank() }
    }

    private fun flac(channel: SeekableByteChannel, start: Long): String? {
        var pos = start
        while (true) {
            val header = readAt(channel, pos, 4) ?: return null
            val last = header[0].toInt() and 0x80 != 0
            val type = header[0].toInt() and 0x7F
            val length = int24(header, 1)
            if (type == VORBIS_COMMENT && length <= LyricsFiles.MAX_BYTES) {
                val block = readAt(channel, pos + 4, length.toInt()) ?: return null
                return vorbisLyrics(block)
            }
            if (last) return null
            pos += 4 + length
        }
    }

    /** Vorbis comments: little-endian vendor length + vendor, count, then "KEY=value" entries. */
    internal fun vorbisLyrics(block: ByteArray): String? {
        val buf = ByteBuffer.wrap(block).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        if (buf.remaining() < 8) return null
        val vendor = buf.int
        if (vendor < 0 || vendor > buf.remaining() - 4) return null
        buf.position(buf.position() + vendor)
        val count = buf.int
        repeat(count.coerceAtLeast(0)) {
            if (buf.remaining() < 4) return null
            val len = buf.int
            if (len < 0 || len > buf.remaining()) return null
            val bytes = ByteArray(len).also { buf.get(it) }
            val entry = String(bytes, Charsets.UTF_8)
            val eq = entry.indexOf('=')
            if (eq > 0) {
                val key = entry.substring(0, eq).uppercase()
                if (key == "LYRICS" || key == "UNSYNCEDLYRICS") {
                    entry.substring(eq + 1).takeIf { it.isNotBlank() }?.let { return it }
                }
            }
        }
        return null
    }

    /** moov / udta / meta / ilst / (c)lyr / data. */
    private fun mp4(channel: SeekableByteChannel): String? {
        val size = channel.size()
        val moov = child(channel, 0, size, "moov") ?: return null
        val udta = child(channel, moov.first, moov.second, "udta") ?: return null
        val meta = child(channel, udta.first, udta.second, "meta") ?: return null
        // ISO "meta" is a full box (4 bytes of version and flags); QuickTime's is not.
        // Full box: version/flags, then the "hdlr" box whose type sits 4 bytes further in.
        val probe = readAt(channel, meta.first, 12) ?: return null
        val metaStart = if (probe.ascii(8, 4) == "hdlr") meta.first + 4 else meta.first
        val ilst = child(channel, metaStart, meta.second, "ilst") ?: return null
        val lyr = child(channel, ilst.first, ilst.second, LYR_ATOM) ?: return null
        val data = child(channel, lyr.first, lyr.second, "data") ?: return null
        val length = data.second - data.first - 8
        if (length <= 0 || length > LyricsFiles.MAX_BYTES) return null
        val bytes = readAt(channel, data.first + 8, length.toInt()) ?: return null
        return String(bytes, Charsets.UTF_8).takeIf { it.isNotBlank() }
    }

    /** Content range of the first child box of [type] between [from] and [to]. */
    private fun child(channel: SeekableByteChannel, from: Long, to: Long, type: String): Pair<Long, Long>? {
        var pos = from
        while (pos + 8 <= to) {
            val header = readAt(channel, pos, 8) ?: return null
            var size = int32(header, 0)
            var headerSize = 8L
            if (size == 1L) {
                val large = readAt(channel, pos + 8, 8) ?: return null
                size = ByteBuffer.wrap(large).long
                headerSize = 16L
            } else if (size == 0L) {
                size = to - pos
            }
            if (size < headerSize || pos + size > to) return null
            if (header.latin1(4, 4) == type) return (pos + headerSize) to (pos + size)
            pos += size
        }
        return null
    }

    private fun readAt(channel: SeekableByteChannel, pos: Long, n: Int): ByteArray? {
        if (pos < 0 || n < 0 || pos + n > channel.size()) return null
        val buf = ByteBuffer.allocate(n)
        channel.position(pos)
        while (buf.hasRemaining()) if (channel.read(buf) < 0) return null
        return buf.array()
    }

    private fun ByteArray.ascii(at: Int, n: Int): String = latin1(at, n)
    private fun ByteArray.latin1(at: Int, n: Int): String =
        if (size < at + n) "" else String(this, at, n, Charsets.ISO_8859_1)

    private fun syncsafe(b: ByteArray, at: Int): Int =
        (b[at].toInt() and 0x7F shl 21) or (b[at + 1].toInt() and 0x7F shl 14) or
            (b[at + 2].toInt() and 0x7F shl 7) or (b[at + 3].toInt() and 0x7F)

    private fun int32(b: ByteArray, at: Int): Long =
        ((b[at].toLong() and 0xFF) shl 24) or ((b[at + 1].toLong() and 0xFF) shl 16) or
            ((b[at + 2].toLong() and 0xFF) shl 8) or (b[at + 3].toLong() and 0xFF)

    private fun int24(b: ByteArray, at: Int): Long =
        ((b[at].toLong() and 0xFF) shl 16) or ((b[at + 1].toLong() and 0xFF) shl 8) or (b[at + 2].toLong() and 0xFF)

    private const val VORBIS_COMMENT = 4

    /** The lyrics atom's type: byte 0xA9 followed by "lyr". */
    private val LYR_ATOM = String(byteArrayOf(0xA9.toByte(), 'l'.code.toByte(), 'y'.code.toByte(), 'r'.code.toByte()), Charsets.ISO_8859_1)
}
