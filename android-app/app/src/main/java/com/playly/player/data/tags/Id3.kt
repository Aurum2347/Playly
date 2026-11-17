package com.playly.player.data.tags

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile

/**
 * ID3v2 at the start of an MP3 (also front of FLAC). Frames other than title, artist,
 * album and genre (covers, lyrics, track numbers, ...) are copied byte for byte. ID3v2.3 stays
 * 2.3 (text in UTF-16), 2.4 stays 2.4 (UTF-8); a file without a tag gets a 2.3 one. ID3v1 at the
 * end is left alone, like the desktop app does.
 */
internal object Id3 {
    class Frame(val id: String, val flags: ByteArray, val body: ByteArray)

    class Tag(val major: Int, val frames: List<Frame>, /** Bytes taken at the file start, footer included. */ val totalSize: Long)

    val FRAME_IDS = mapOf(
        TagField.Title to "TIT2",
        TagField.Artist to "TPE1",
        TagField.Album to "TALB",
        TagField.Genre to "TCON",
    )

    private const val PADDING = 1024
    private val OTHER_MAGIC = setOf("fLaC", "OggS", "RIFF", "FORM")

    /** The tag at [offset], or null when there is none. */
    fun read(file: RandomAccessFile, offset: Long = 0): Tag? {
        val head = Bytes.readAt(file, offset, 10) ?: return null
        if (Bytes.ascii(head, 0, 3) != "ID3") return null
        val major = head[3].toInt()
        if (major == 2) unsupported("ID3v2.2 tags are not rewritten")
        if (major != 3 && major != 4) damaged("Unknown ID3v2 version $major")
        val flags = head[5].toInt()
        val size = Bytes.syncsafe(head, 6)
        val footer = major == 4 && flags and 0x10 != 0
        var body = Bytes.requireAt(file, offset + 10, size)
        // Whole-tag unsynchronisation of 2.3; in 2.4 every frame carries its own flag instead.
        if (major == 3 && flags and 0x80 != 0) body = resync(body)
        var pos = 0
        if (flags and 0x40 != 0 && body.size >= 4) {
            pos = if (major == 4) Bytes.syncsafe(body, 0) else 4 + Bytes.be32(body, 0).toInt()
        }
        val frames = ArrayList<Frame>()
        while (pos + 10 <= body.size) {
            if (body[pos].toInt() == 0) break // padding
            val id = Bytes.ascii(body, pos, 4)
            if (!id.all { it in 'A'..'Z' || it in '0'..'9' }) break
            val frameSize = frameSize(body, pos + 4, major)
            if (frameSize < 0 || pos + 10 + frameSize > body.size) break
            frames += Frame(id, body.copyOfRange(pos + 8, pos + 10), body.copyOfRange(pos + 10, pos + 10 + frameSize))
            pos += 10 + frameSize
        }
        return Tag(major, frames, 10L + size + if (footer) 10 else 0)
    }

    /**
     * v2.4 sizes are syncsafe, but some writers (old iTunes) store plain integers; a size with a
     * high bit set can only be the latter.
     */
    private fun frameSize(bytes: ByteArray, i: Int, major: Int): Int {
        if (major == 3) return Bytes.be32(bytes, i).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        val plain = (0 until 4).any { bytes[i + it].toInt() and 0x80 != 0 }
        return if (plain) Bytes.be32(bytes, i).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() else Bytes.syncsafe(bytes, i)
    }

    /** Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
    private fun resync(bytes: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(bytes.size)
        var i = 0
        while (i < bytes.size) {
            val b = bytes[i]
            out.write(b.toInt())
            i += if (b == 0xFF.toByte() && i + 1 < bytes.size && bytes[i + 1].toInt() == 0) 2 else 1
        }
        return out.toByteArray()
    }

    /** A new tag: kept frames plus the edited text frames, then padding. */
    fun encode(major: Int, kept: List<Frame>, edit: TagEdit): ByteArray {
        val frames = ByteArrayOutputStream()
        fun write(id: String, flags: ByteArray, body: ByteArray) {
            frames.write(id.toByteArray(Charsets.ISO_8859_1))
            frames.write(if (major == 4) Bytes.syncsafeBytes(body.size) else Bytes.be32Bytes(body.size.toLong()))
            frames.write(flags)
            frames.write(body)
        }
        edit.values().forEach { (field, value) ->
            if (value != null) write(FRAME_IDS.getValue(field), byteArrayOf(0, 0), textBody(value, major))
        }
        kept.forEach { write(it.id, it.flags, it.body) }
        val size = frames.size() + PADDING
        val out = ByteArrayOutputStream(10 + size)
        out.write("ID3".toByteArray(Charsets.ISO_8859_1))
        out.write(byteArrayOf(major.toByte(), 0, 0))
        out.write(Bytes.syncsafeBytes(size))
        frames.writeTo(out)
        out.write(ByteArray(PADDING))
        return out.toByteArray()
    }

    /** 2.4: UTF-8. 2.3: Latin-1 when it fits, else UTF-16 with a byte-order mark. */
    fun textBody(value: String, major: Int): ByteArray {
        val out = ByteArrayOutputStream()
        when {
            major == 4 -> {
                out.write(3)
                out.write(value.toByteArray(Charsets.UTF_8))
            }
            value.all { it.code in 0x20..0xFF } -> {
                out.write(0)
                out.write(value.toByteArray(Charsets.ISO_8859_1))
            }
            else -> {
                out.write(1)
                out.write(byteArrayOf(0xFF.toByte(), 0xFE.toByte()))
                out.write(value.toByteArray(Charsets.UTF_16LE))
            }
        }
        return out.toByteArray()
    }

    /** Text of a T*** frame body (first value only), for reading tags back. */
    fun text(body: ByteArray): String? {
        if (body.isEmpty()) return null
        val charset = when (body[0].toInt()) {
            0 -> Charsets.ISO_8859_1
            1 -> Charsets.UTF_16
            2 -> Charsets.UTF_16BE
            3 -> Charsets.UTF_8
            else -> return null
        }
        return String(body, 1, body.size - 1, charset).substringBefore('\u0000').ifEmpty { null }
    }

    /** MP3: replaces (or adds) the tag at the start and copies the audio after it unchanged. */
    fun rewrite(file: RandomAccessFile, out: OutputStream, edit: TagEdit) {
        val tag = read(file)
        if (tag == null) {
            // Junk before the first frame is common and harmless; another container is not.
            val head = Bytes.readAt(file, 0, 12) ?: damaged("File is too short")
            val other = Bytes.ascii(head, 0, 4) in OTHER_MAGIC || Bytes.ascii(head, 4, 4) == "ftyp"
            if (other) damaged("Not an MP3 file")
        }
        val ids = FRAME_IDS.values.toSet()
        val kept = tag?.frames?.filter { it.id !in ids }.orEmpty()
        out.write(encode(tag?.major ?: 3, kept, edit))
        Bytes.copyRange(file, tag?.totalSize ?: 0, file.length(), out)
    }
}
