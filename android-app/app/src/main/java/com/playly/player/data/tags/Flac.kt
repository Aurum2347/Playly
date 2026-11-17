package com.playly.player.data.tags

import java.io.OutputStream
import java.io.RandomAccessFile

/**
 * FLAC metadata blocks. The Vorbis comment block is rebuilt (other comments kept), every other
 * block (STREAMINFO, pictures, seek table, ...) is copied as is. When the old blocks had room,
 * padding absorbs the difference, so the audio frames stay at the same offset.
 */
internal object Flac {
    private const val STREAMINFO = 0
    private const val PADDING = 1
    const val VORBIS_COMMENT = 4
    private const val NEW_PADDING = 1024
    private const val MAX_BLOCK = (1 shl 24) - 1

    class Block(val type: Int, /** Offset of the block body. */ val offset: Long, val length: Int)

    class Layout(/** Where "fLaC" is (after an ID3 tag, if any). */ val magicAt: Long, val blocks: List<Block>, val audioAt: Long)

    fun layout(file: RandomAccessFile): Layout {
        val magicAt = Id3.read(file)?.totalSize ?: 0L
        val magic = Bytes.readAt(file, magicAt, 4) ?: damaged("File is too short")
        if (Bytes.ascii(magic, 0, 4) != "fLaC") damaged("Not a FLAC file")
        val blocks = ArrayList<Block>()
        var pos = magicAt + 4
        while (true) {
            val header = Bytes.requireAt(file, pos, 4)
            val last = Bytes.u8(header, 0) and 0x80 != 0
            val type = Bytes.u8(header, 0) and 0x7F
            if (type == 127) damaged("Invalid FLAC block")
            val length = Bytes.be24(header, 1)
            if (pos + 4 + length > file.length()) damaged("FLAC block runs past the end")
            blocks += Block(type, pos + 4, length)
            pos += 4 + length
            if (last) break
        }
        if (blocks.firstOrNull()?.type != STREAMINFO) damaged("FLAC without STREAMINFO")
        return Layout(magicAt, blocks, pos)
    }

    fun comments(file: RandomAccessFile, layout: Layout): Bytes.VorbisComments? {
        val block = layout.blocks.firstOrNull { it.type == VORBIS_COMMENT } ?: return null
        return Bytes.VorbisComments.decode(Bytes.requireAt(file, block.offset, block.length), 0).first
    }

    fun rewrite(file: RandomAccessFile, out: OutputStream, edit: TagEdit) {
        val layout = layout(file)
        val old = comments(file, layout) ?: Bytes.VorbisComments("Playly", emptyList())
        val comment = old.edited(edit).encode()
        if (comment.size > MAX_BLOCK) unsupported("Comments are too large")
        val kept = layout.blocks.filter { it.type != VORBIS_COMMENT && it.type != PADDING }
        // STREAMINFO first, the comments right after it, then the rest in their old order.
        val oldBytes = layout.audioAt - (layout.magicAt + 4)
        val newBytes = kept.sumOf { 4L + it.length } + 4 + comment.size
        val padding = (oldBytes - newBytes - 4).takeIf { it in 0..MAX_BLOCK } ?: NEW_PADDING.toLong()

        Bytes.copyRange(file, 0, layout.magicAt + 4, out)
        fun header(type: Int, length: Int, last: Boolean) {
            out.write(byteArrayOf((type or if (last) 0x80 else 0).toByte(), (length shr 16).toByte(), (length shr 8).toByte(), length.toByte()))
        }
        val first = kept.first()
        header(first.type, first.length, last = false)
        Bytes.copyRange(file, first.offset, first.offset + first.length, out)
        header(VORBIS_COMMENT, comment.size, last = false)
        out.write(comment)
        for (block in kept.drop(1)) {
            header(block.type, block.length, last = false)
            Bytes.copyRange(file, block.offset, block.offset + block.length, out)
        }
        header(PADDING, padding.toInt(), last = true)
        out.write(ByteArray(padding.toInt()))
        Bytes.copyRange(file, layout.audioAt, file.length(), out)
    }
}
