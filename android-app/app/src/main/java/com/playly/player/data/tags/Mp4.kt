package com.playly.player.data.tags

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.RandomAccessFile

/**
 * MP4 / M4A: iTunes-style items in moov/udta/meta/ilst. Only moov is rebuilt; when it changes
 * size and audio lies after it, the chunk offsets (stco / co64) move with it, or an adjacent
 * free box absorbs the difference. Fragmented files are not rewritten.
 */
internal object Mp4 {
    class Box(val type: String, val start: Long, val headerSize: Int, val end: Long) {
        val contentStart: Long get() = start + headerSize
        val size: Long get() = end - start
    }

    val ITEMS = mapOf(
        TagField.Title to "©nam",
        TagField.Artist to "©ART",
        TagField.Album to "©alb",
        TagField.Genre to "©gen",
    )

    /** Numeric ID3 genre; dropped whenever the genre is written as text. */
    private const val GENRE_CODE = "gnre"
    private val CONTAINERS = setOf("moov", "trak", "mdia", "minf", "stbl", "edts")
    private const val MAX_MOOV = 64L * 1024 * 1024

    fun boxes(file: RandomAccessFile, from: Long, to: Long): List<Box> {
        val out = ArrayList<Box>()
        var pos = from
        while (pos + 8 <= to) {
            val head = Bytes.requireAt(file, pos, minOf(16L, to - pos).toInt())
            out += box(head, 0, pos, to - pos)
            pos = out.last().end
        }
        return out
    }

    fun boxesIn(bytes: ByteArray, from: Int, to: Int): List<Box> {
        val out = ArrayList<Box>()
        var pos = from
        while (pos + 8 <= to) {
            out += box(bytes, pos, pos.toLong(), (to - pos).toLong())
            pos = out.last().end.toInt()
        }
        return out
    }

    /** Header at [i] of [bytes]; [start] is its position, [room] how many bytes the parent has left. */
    private fun box(bytes: ByteArray, i: Int, start: Long, room: Long): Box {
        var size = Bytes.be32(bytes, i)
        val type = Bytes.ascii(bytes, i + 4, 4)
        var header = 8
        when (size) {
            1L -> {
                if (bytes.size < i + 16) damaged("Box $type is cut short")
                size = Bytes.be64(bytes, i + 8)
                header = 16
            }
            0L -> size = room
        }
        if (size < header || size > room) damaged("Box $type has a bad size")
        return Box(type, start, header, start + size)
    }

    /** A box with a 32-bit size (64-bit when needed). */
    fun box(type: String, content: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(content.size + 16)
        val small = content.size + 8L <= 0xFFFFFFFFL
        if (small) {
            out.write(Bytes.be32Bytes(content.size + 8L))
            out.write(type.toByteArray(Charsets.ISO_8859_1))
        } else {
            out.write(Bytes.be32Bytes(1))
            out.write(type.toByteArray(Charsets.ISO_8859_1))
            out.write(ByteArray(8).also { Bytes.putBe64(it, 0, content.size + 16L) })
        }
        out.write(content)
        return out.toByteArray()
    }

    private fun ByteArray.slice(box: Box) = copyOfRange(box.start.toInt(), box.end.toInt())

    private fun ByteArray.content(box: Box) = copyOfRange(box.contentStart.toInt(), box.end.toInt())

    /** "data" atom with UTF-8 text (type 1, locale 0) inside an item box. */
    fun item(type: String, value: String): ByteArray {
        val text = value.toByteArray(Charsets.UTF_8)
        val data = Bytes.be32Bytes(1) + Bytes.be32Bytes(0) + text
        return box(type, box("data", data))
    }

    private fun ilst(old: ByteArray?, edit: TagEdit): ByteArray {
        val drop = ITEMS.values.toSet() + GENRE_CODE
        val out = ByteArrayOutputStream()
        if (old != null) {
            boxesIn(old, 0, old.size).filter { it.type !in drop }.forEach { out.write(old.slice(it)) }
        }
        edit.values().forEach { (field, value) -> if (value != null) out.write(item(ITEMS.getValue(field), value)) }
        return box("ilst", out.toByteArray())
    }

    /** hdlr "mdir" / "appl", as iTunes writes it. */
    private val HANDLER: ByteArray = box(
        "hdlr",
        ByteArray(8) + "mdirappl".toByteArray(Charsets.ISO_8859_1) + ByteArray(9),
    )

    /**
     * meta is a full box (4 bytes of version and flags before its children), except in some
     * QuickTime files; those are recognised by a child header right at the start.
     */
    private fun metaChildrenAt(content: ByteArray): Int =
        if (content.size >= 8 && Bytes.ascii(content, 4, 4) == "hdlr") 0 else 4

    private fun meta(old: ByteArray?, edit: TagEdit): ByteArray {
        val out = ByteArrayOutputStream()
        if (old == null) {
            out.write(ByteArray(4))
            out.write(HANDLER)
            out.write(ilst(null, edit))
            return box("meta", out.toByteArray())
        }
        val at = metaChildrenAt(old)
        out.write(old, 0, at)
        val children = boxesIn(old, at, old.size)
        if (children.none { it.type == "hdlr" }) out.write(HANDLER)
        var written = false
        for (child in children) {
            if (child.type == "ilst") {
                if (!written) out.write(ilst(old.content(child), edit))
                written = true
            } else {
                out.write(old.slice(child))
            }
        }
        if (!written) out.write(ilst(null, edit))
        return box("meta", out.toByteArray())
    }

    private fun udta(old: ByteArray?, edit: TagEdit): ByteArray {
        if (old == null) return box("udta", meta(null, edit))
        val out = ByteArrayOutputStream()
        var written = false
        for (child in boxesIn(old, 0, old.size)) {
            if (child.type == "meta" && !written) {
                out.write(meta(old.content(child), edit))
                written = true
            } else {
                out.write(old.slice(child))
            }
        }
        if (!written) out.write(meta(null, edit))
        return box("udta", out.toByteArray())
    }

    /** moov with the new udta (in place of the old one, or appended). */
    private fun moov(old: ByteArray, header: Int, edit: TagEdit): ByteArray {
        val out = ByteArrayOutputStream(old.size + 1024)
        var written = false
        for (child in boxesIn(old, header, old.size)) {
            if (child.type == "udta" && !written) {
                out.write(udta(old.content(child), edit))
                written = true
            } else {
                out.write(old.slice(child))
            }
        }
        if (!written) out.write(udta(null, edit))
        return box("moov", out.toByteArray())
    }

    /** Adds [delta] to every chunk offset at or after [threshold] (stco / co64 in each track). */
    private fun shiftOffsets(bytes: ByteArray, from: Int, to: Int, threshold: Long, delta: Long) {
        for (child in boxesIn(bytes, from, to)) {
            val start = child.contentStart.toInt()
            when (child.type) {
                in CONTAINERS -> shiftOffsets(bytes, start, child.end.toInt(), threshold, delta)
                "stco", "co64" -> {
                    val wide = child.type == "co64"
                    val count = Bytes.be32(bytes, start + 4)
                    val step = if (wide) 8 else 4
                    if (start + 8 + count * step > child.end) damaged("Chunk offset table is cut short")
                    for (k in 0 until count.toInt()) {
                        val at = start + 8 + k * step
                        val value = if (wide) Bytes.be64(bytes, at) else Bytes.be32(bytes, at)
                        if (value < threshold) continue
                        val moved = value + delta
                        if (wide) {
                            Bytes.putBe64(bytes, at, moved)
                        } else {
                            if (moved > 0xFFFFFFFFL) unsupported("Chunk offsets would overflow")
                            Bytes.putBe32(bytes, at, moved)
                        }
                    }
                }
            }
        }
    }

    class Layout(val top: List<Box>, val moov: Box)

    fun layout(file: RandomAccessFile): Layout {
        val top = boxes(file, 0, file.length())
        if (top.firstOrNull()?.type != "ftyp") damaged("Not an MP4 file")
        if (top.any { it.type == "moof" }) unsupported("Fragmented MP4 is not rewritten")
        val moov = top.singleOrNull { it.type == "moov" } ?: damaged("MP4 without a single moov")
        if (moov.size > MAX_MOOV) unsupported("moov is too large")
        return Layout(top, moov)
    }

    /** moov bytes, read whole (sample tables and covers, well under [MAX_MOOV]). */
    fun readMoov(file: RandomAccessFile, layout: Layout): ByteArray =
        Bytes.requireAt(file, layout.moov.start, layout.moov.size.toInt())

    fun rewrite(file: RandomAccessFile, out: OutputStream, edit: TagEdit) {
        val layout = layout(file)
        val moov = layout.moov
        val rebuilt = moov(readMoov(file, layout), moov.headerSize, edit)
        var delta = rebuilt.size - moov.size
        val next = layout.top.getOrNull(layout.top.indexOf(moov) + 1)
        var resumeAt = moov.end
        var filler: ByteArray? = null
        if (delta != 0L) {
            val room = next?.let { it.size - delta }
            if (next != null && next.type in FREE && room != null && room in 8..MAX_FILLER) {
                // The free box right after moov grows or shrinks instead: nothing else moves.
                filler = box("free", ByteArray((room - 8).toInt()))
                resumeAt = next.end
                delta = 0
            } else if (delta <= -8) {
                filler = box("free", ByteArray((-delta - 8).toInt()))
                delta = 0
            }
        }
        if (delta != 0L) shiftOffsets(rebuilt, 8, rebuilt.size, threshold = moov.end, delta = delta)
        Bytes.copyRange(file, 0, moov.start, out)
        out.write(rebuilt)
        filler?.let(out::write)
        Bytes.copyRange(file, resumeAt, file.length(), out)
    }

    /** ilst text items of the file, for reading tags back. */
    fun items(file: RandomAccessFile): Map<String, String> {
        val layout = layout(file)
        val moovBytes = readMoov(file, layout)
        val result = HashMap<String, String>()
        fun walk(bytes: ByteArray, from: Int, to: Int, path: List<String>) {
            for (child in boxesIn(bytes, from, to)) {
                val start = child.contentStart.toInt()
                val end = child.end.toInt()
                when {
                    path.isEmpty() && child.type == "udta" -> walk(bytes, start, end, listOf("udta"))
                    path == listOf("udta") && child.type == "meta" ->
                        walk(bytes, start + metaChildrenAt(bytes.copyOfRange(start, end)), end, listOf("udta", "meta"))
                    path == listOf("udta", "meta") && child.type == "ilst" -> walk(bytes, start, end, listOf("ilst"))
                    path == listOf("ilst") -> {
                        val data = boxesIn(bytes, start, end).firstOrNull { it.type == "data" } ?: continue
                        val textAt = data.contentStart.toInt() + 8
                        if (textAt <= data.end) result[child.type] = String(bytes, textAt, data.end.toInt() - textAt, Charsets.UTF_8)
                    }
                }
            }
        }
        walk(moovBytes, layout.moov.headerSize, moovBytes.size, emptyList())
        return result
    }

    private val FREE = setOf("free", "skip")
    private const val MAX_FILLER = 1L shl 20
}
