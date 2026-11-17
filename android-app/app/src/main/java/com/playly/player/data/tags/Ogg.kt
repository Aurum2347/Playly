package com.playly.player.data.tags

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile

/**
 * Ogg Vorbis and Ogg Opus. The header packets (identification, comments, Vorbis setup) are
 * re-paged with the new comments; audio pages are copied, only their sequence numbers (and so
 * their CRC) change when the headers take a different number of pages. Streams multiplexed in
 * the headers are not rewritten.
 */
internal object Ogg {
    enum class Codec(val headerPackets: Int) { Vorbis(3), Opus(2) }

    class Headers(
        val codec: Codec,
        val serial: Long,
        val firstSequence: Long,
        val packets: List<ByteArray>,
        val pageCount: Int,
        val endOffset: Long,
    )

    private val VORBIS_ID = byteArrayOf(1) + ascii("vorbis")
    private val VORBIS_COMMENT = byteArrayOf(3) + ascii("vorbis")
    private val OPUS_HEAD = ascii("OpusHead")
    private val OPUS_TAGS = ascii("OpusTags")

    private fun ascii(s: String) = s.toByteArray(Charsets.ISO_8859_1)

    private fun ByteArray.startsWith(prefix: ByteArray) = size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    /** Reads pages until the last header packet ends; it must end its page (both specs say so). */
    fun headers(file: RandomAccessFile): Headers {
        val first = OggPages.read(file, 0) ?: damaged("Not an Ogg file")
        if (first.headerType and OggPages.BEGIN == 0) damaged("Ogg stream does not begin")
        val serial = first.serial
        val packets = ArrayList<ByteArray>()
        val current = ByteArrayOutputStream()
        var codec: Codec? = null
        var offset = 0L
        var pages = 0
        while (true) {
            val page = OggPages.read(file, offset) ?: damaged("Ogg headers are cut short")
            if (page.serial != serial) unsupported("Multiplexed Ogg streams are not rewritten")
            val data = Bytes.requireAt(file, page.offset + page.headerLength, page.dataLength)
            var at = 0
            for (lace in page.segments) {
                if (codec != null && packets.size == codec.headerPackets) unsupported("Audio shares a page with the headers")
                current.write(data, at, lace)
                at += lace
                if (lace < 255) {
                    packets += current.toByteArray()
                    current.reset()
                    if (packets.size == 1) codec = codecOf(packets[0])
                }
                if (current.size() > MAX_HEADER) unsupported("Ogg header packet is too large")
            }
            offset += page.totalLength
            pages++
            val known = codec ?: continue
            if (packets.size == known.headerPackets && current.size() == 0) {
                return Headers(known, serial, first.sequence, packets, pages, offset)
            }
        }
    }

    private fun codecOf(packet: ByteArray): Codec = when {
        packet.startsWith(VORBIS_ID) -> Codec.Vorbis
        packet.startsWith(OPUS_HEAD) -> Codec.Opus
        else -> unsupported("Only Vorbis and Opus in Ogg are rewritten")
    }

    /** The comments of the second header packet. */
    fun comments(headers: Headers): Bytes.VorbisComments = comment(headers).first

    /** Comments, and what follows them in the packet (Vorbis framing bit, Opus extra data). */
    private fun comment(headers: Headers): Pair<Bytes.VorbisComments, ByteArray> {
        val packet = headers.packets[1]
        val magic = magicOf(headers.codec)
        if (!packet.startsWith(magic)) damaged("Ogg comment header is missing")
        val (comments, end) = Bytes.VorbisComments.decode(packet, magic.size)
        return comments to packet.copyOfRange(end, packet.size)
    }

    private fun magicOf(codec: Codec) = if (codec == Codec.Vorbis) VORBIS_COMMENT else OPUS_TAGS

    private const val MAX_HEADER = 16 * 1024 * 1024

    fun rewrite(file: RandomAccessFile, out: OutputStream, edit: TagEdit) {
        val headers = headers(file)
        val (old, tail) = comment(headers)
        // Vorbis needs its framing bit; Opus may carry extra binary data after the comments.
        val rest = if (headers.codec == Codec.Vorbis) byteArrayOf(1) else tail
        val packets = headers.packets.toMutableList()
        packets[1] = magicOf(headers.codec) + old.edited(edit).encode() + rest
        val (bytes, pageCount) = OggPages.encode(packets, headers.serial, headers.firstSequence)
        out.write(bytes)
        val shift = (pageCount - headers.pageCount).toLong()
        if (shift == 0L) {
            Bytes.copyRange(file, headers.endOffset, file.length(), out)
            return
        }
        var offset = headers.endOffset
        while (offset < file.length()) {
            val page = OggPages.read(file, offset)
            if (page == null) {
                // Trailing bytes that are not a page stay as they were.
                Bytes.copyRange(file, offset, file.length(), out)
                return
            }
            if (page.serial == headers.serial) {
                out.write(OggPages.renumbered(file, page, page.sequence + shift))
            } else {
                Bytes.copyRange(file, offset, offset + page.totalLength, out)
            }
            offset += page.totalLength
        }
    }
}
