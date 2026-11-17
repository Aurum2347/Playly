package com.playly.player.data.tags

import java.io.ByteArrayOutputStream
import java.io.RandomAccessFile

/** Ogg page reading and writing (RFC 3533). */
internal object OggPages {
    class Page(
        val offset: Long,
        val headerType: Int,
        val serial: Long,
        val sequence: Long,
        val segments: IntArray,
        val headerLength: Int,
    ) {
        val dataLength: Int get() = segments.sum()
        val totalLength: Int get() = headerLength + dataLength
    }

    const val CONTINUED = 0x01
    const val BEGIN = 0x02

    fun read(file: RandomAccessFile, offset: Long): Page? {
        val head = Bytes.readAt(file, offset, 27) ?: return null
        if (Bytes.ascii(head, 0, 4) != "OggS" || head[4].toInt() != 0) return null
        val count = Bytes.u8(head, 26)
        val table = Bytes.readAt(file, offset + 27, count) ?: return null
        val segments = IntArray(count) { Bytes.u8(table, it) }
        val page = Page(offset, Bytes.u8(head, 5), Bytes.le32(head, 14), Bytes.le32(head, 18), segments, 27 + count)
        return page.takeIf { offset + it.totalLength <= file.length() }
    }

    /** A page copied with a new sequence number and its CRC recomputed. */
    fun renumbered(file: RandomAccessFile, page: Page, sequence: Long): ByteArray {
        val bytes = Bytes.requireAt(file, page.offset, page.totalLength)
        Bytes.putLe32(bytes, 18, sequence)
        Bytes.putLe32(bytes, 22, 0)
        Bytes.putLe32(bytes, 22, crc(bytes))
        return bytes
    }

    /** Ogg's CRC-32: polynomial 0x04C11DB7, not reflected, initial value 0. */
    fun crc(bytes: ByteArray): Long {
        var crc = 0
        for (b in bytes) {
            crc = (crc shl 8) xor CRC_TABLE[((crc ushr 24) xor (b.toInt() and 0xFF)) and 0xFF]
        }
        return crc.toLong() and 0xFFFFFFFFL
    }

    private val CRC_TABLE = IntArray(256) { i ->
        var r = i shl 24
        repeat(8) { r = if (r and Int.MIN_VALUE != 0) (r shl 1) xor 0x04C11DB7 else r shl 1 }
        r
    }

    /**
     * Pages for [packets], each packet starting on a fresh page; the first page opens the
     * stream. Header pages carry granule 0 where a packet ends, -1 where none does.
     * Returns the bytes and how many pages they are.
     */
    fun encode(packets: List<ByteArray>, serial: Long, firstSequence: Long): Pair<ByteArray, Int> {
        val out = ByteArrayOutputStream()
        var sequence = firstSequence
        for ((index, packet) in packets.withIndex()) {
            // Lacing: 255s, then the remainder (0 when the length is a multiple of 255).
            val lacing = IntArray(packet.size / 255 + 1) { if (it < packet.size / 255) 255 else packet.size % 255 }
            var segment = 0
            var dataAt = 0
            while (segment < lacing.size) {
                val count = minOf(MAX_SEGMENTS, lacing.size - segment)
                val ends = segment + count == lacing.size
                var type = if (segment > 0) CONTINUED else 0
                if (index == 0 && segment == 0) type = type or BEGIN
                val length = (segment until segment + count).sumOf { lacing[it] }
                out.write(page(type, if (ends) 0L else -1L, serial, sequence, lacing.copyOfRange(segment, segment + count), packet, dataAt, length))
                sequence++
                segment += count
                dataAt += length
            }
        }
        return out.toByteArray() to (sequence - firstSequence).toInt()
    }

    private fun page(type: Int, granule: Long, serial: Long, sequence: Long, lacing: IntArray, data: ByteArray, from: Int, length: Int): ByteArray {
        val bytes = ByteArray(27 + lacing.size + length)
        "OggS".toByteArray(Charsets.ISO_8859_1).copyInto(bytes)
        bytes[4] = 0
        bytes[5] = type.toByte()
        Bytes.putLe32(bytes, 6, granule and 0xFFFFFFFFL)
        Bytes.putLe32(bytes, 10, granule ushr 32)
        Bytes.putLe32(bytes, 14, serial)
        Bytes.putLe32(bytes, 18, sequence)
        bytes[26] = lacing.size.toByte()
        lacing.forEachIndexed { i, v -> bytes[27 + i] = v.toByte() }
        data.copyInto(bytes, 27 + lacing.size, from, from + length)
        Bytes.putLe32(bytes, 22, crc(bytes))
        return bytes
    }

    private const val MAX_SEGMENTS = 255
}
