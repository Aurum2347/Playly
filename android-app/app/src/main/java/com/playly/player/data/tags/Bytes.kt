package com.playly.player.data.tags

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile

/** Byte helpers shared by the tag writers and readers. */
internal object Bytes {
    fun readAt(file: RandomAccessFile, offset: Long, length: Int): ByteArray? {
        if (offset < 0 || length < 0 || offset + length > file.length()) return null
        val out = ByteArray(length)
        file.seek(offset)
        file.readFully(out)
        return out
    }

    fun requireAt(file: RandomAccessFile, offset: Long, length: Int): ByteArray =
        readAt(file, offset, length) ?: damaged("File ends early at $offset")

    /** Copies [from, end) of [file] to [out] in 64 KiB steps. */
    fun copyRange(file: RandomAccessFile, from: Long, end: Long, out: OutputStream) {
        if (end <= from) return
        val buffer = ByteArray(BUFFER)
        file.seek(from)
        var left = end - from
        while (left > 0) {
            val n = file.read(buffer, 0, minOf(left, BUFFER.toLong()).toInt())
            if (n < 0) damaged("File ends early")
            out.write(buffer, 0, n)
            left -= n
        }
    }

    fun ascii(bytes: ByteArray, offset: Int, length: Int): String =
        if (offset + length > bytes.size) "" else String(bytes, offset, length, Charsets.ISO_8859_1)

    fun u8(bytes: ByteArray, i: Int): Int = bytes[i].toInt() and 0xFF

    fun be32(bytes: ByteArray, i: Int): Long =
        (u8(bytes, i).toLong() shl 24) or (u8(bytes, i + 1).toLong() shl 16) or (u8(bytes, i + 2).toLong() shl 8) or u8(bytes, i + 3).toLong()

    fun be64(bytes: ByteArray, i: Int): Long = (be32(bytes, i) shl 32) or be32(bytes, i + 4)

    fun be24(bytes: ByteArray, i: Int): Int = (u8(bytes, i) shl 16) or (u8(bytes, i + 1) shl 8) or u8(bytes, i + 2)

    fun le32(bytes: ByteArray, i: Int): Long =
        u8(bytes, i).toLong() or (u8(bytes, i + 1).toLong() shl 8) or (u8(bytes, i + 2).toLong() shl 16) or (u8(bytes, i + 3).toLong() shl 24)

    fun syncsafe(bytes: ByteArray, i: Int): Int =
        ((bytes[i].toInt() and 0x7F) shl 21) or ((bytes[i + 1].toInt() and 0x7F) shl 14) or
            ((bytes[i + 2].toInt() and 0x7F) shl 7) or (bytes[i + 3].toInt() and 0x7F)

    fun putBe32(out: ByteArray, i: Int, value: Long) {
        out[i] = (value ushr 24).toByte()
        out[i + 1] = (value ushr 16).toByte()
        out[i + 2] = (value ushr 8).toByte()
        out[i + 3] = value.toByte()
    }

    fun putBe64(out: ByteArray, i: Int, value: Long) {
        putBe32(out, i, value ushr 32)
        putBe32(out, i + 4, value and 0xFFFFFFFFL)
    }

    fun putLe32(out: ByteArray, i: Int, value: Long) {
        out[i] = value.toByte()
        out[i + 1] = (value ushr 8).toByte()
        out[i + 2] = (value ushr 16).toByte()
        out[i + 3] = (value ushr 24).toByte()
    }

    fun be32Bytes(value: Long) = ByteArray(4).also { putBe32(it, 0, value) }

    fun le32Bytes(value: Long) = ByteArray(4).also { putLe32(it, 0, value) }

    fun syncsafeBytes(value: Int): ByteArray {
        require(value in 0 until (1 shl 28)) { "Too large for a syncsafe integer: $value" }
        return byteArrayOf(
            ((value shr 21) and 0x7F).toByte(),
            ((value shr 14) and 0x7F).toByte(),
            ((value shr 7) and 0x7F).toByte(),
            (value and 0x7F).toByte(),
        )
    }

    /** Vorbis comments (FLAC block 4, Ogg comment headers): vendor and "KEY=value" entries. */
    class VorbisComments(val vendor: String, val entries: List<String>) {
        fun encode(): ByteArray {
            val out = ByteArrayOutputStream()
            val vendorBytes = vendor.toByteArray(Charsets.UTF_8)
            out.write(le32Bytes(vendorBytes.size.toLong()))
            out.write(vendorBytes)
            out.write(le32Bytes(entries.size.toLong()))
            for (entry in entries) {
                val bytes = entry.toByteArray(Charsets.UTF_8)
                out.write(le32Bytes(bytes.size.toLong()))
                out.write(bytes)
            }
            return out.toByteArray()
        }

        fun value(key: String): String? = entries.firstOrNull { it.substringBefore('=').equals(key, ignoreCase = true) }
            ?.substringAfter('=', "")

        /** Drops every [TagField] key and appends the edited, non-blank values. */
        fun edited(edit: TagEdit): VorbisComments {
            val keys = VORBIS_KEYS.values.toSet()
            val kept = entries.filter { entry -> keys.none { it.equals(entry.substringBefore('='), ignoreCase = true) } }
            val added = edit.values().mapNotNull { (field, value) -> value?.let { "${VORBIS_KEYS.getValue(field)}=$it" } }
            return VorbisComments(vendor, kept + added)
        }

        companion object {
            /** Parses from [offset]; returns the comments and where they end. */
            fun decode(bytes: ByteArray, offset: Int): Pair<VorbisComments, Int> {
                var pos = offset
                fun need(n: Long) {
                    if (n < 0 || pos + n > bytes.size) damaged("Vorbis comment block is cut short")
                }
                need(4)
                val vendorLength = le32(bytes, pos)
                pos += 4
                need(vendorLength)
                val vendor = String(bytes, pos, vendorLength.toInt(), Charsets.UTF_8)
                pos += vendorLength.toInt()
                need(4)
                val count = le32(bytes, pos)
                pos += 4
                if (count > (bytes.size - pos) / 4) damaged("Vorbis comment count is too large")
                val entries = ArrayList<String>(count.toInt())
                repeat(count.toInt()) {
                    need(4)
                    val length = le32(bytes, pos)
                    pos += 4
                    need(length)
                    entries += String(bytes, pos, length.toInt(), Charsets.UTF_8)
                    pos += length.toInt()
                }
                return VorbisComments(vendor, entries) to pos
            }

            val VORBIS_KEYS = mapOf(
                TagField.Title to "TITLE",
                TagField.Artist to "ARTIST",
                TagField.Album to "ALBUM",
                TagField.Genre to "GENRE",
            )
        }
    }

    private const val BUFFER = 64 * 1024
}
