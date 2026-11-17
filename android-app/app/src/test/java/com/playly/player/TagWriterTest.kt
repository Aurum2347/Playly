package com.playly.player

import com.playly.player.data.tags.Bytes
import com.playly.player.data.tags.Flac
import com.playly.player.data.tags.Id3
import com.playly.player.data.tags.Mp4
import com.playly.player.data.tags.Ogg
import com.playly.player.data.tags.OggPages
import com.playly.player.data.tags.TagEdit
import com.playly.player.data.tags.TagField
import com.playly.player.data.tags.TagFormat
import com.playly.player.data.tags.TagReader
import com.playly.player.data.tags.TagWriteException
import com.playly.player.data.tags.TagWriter
import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Stage 8.4: tag rewriting on real ffmpeg-made files (tools/make_tag_samples.sh). */
class TagWriterTest {
    @get:Rule val tmp = TemporaryFolder()

    private val edit = TagEdit(title = "Новое название", artist = "Исполнитель — тест", album = "", genre = "Jazz")

    private fun sample(name: String): File {
        val stream = javaClass.classLoader!!.getResourceAsStream("tags/$name") ?: error("Missing sample $name")
        return tmp.newFile("${System.nanoTime()}-$name").also { f -> stream.use { s -> f.outputStream().use(s::copyTo) } }
    }

    private fun rewrite(input: File, format: TagFormat, with: TagEdit = edit): File {
        val out = tmp.newFile("out-${input.name}-${System.nanoTime()}")
        TagWriter.rewrite(input, out, format, with)
        return out
    }

    private fun <T> open(file: File, block: (RandomAccessFile) -> T): T = RandomAccessFile(file, "r").use(block)

    @Test
    fun mp3KeepsVersionOtherFramesAndAudio() {
        for ((name, major) in listOf("v23.mp3" to 3, "v24.mp3" to 4, "bare.mp3" to 3)) {
            val input = sample(name)
            val out = rewrite(input, TagFormat.Mp3)
            assertTrue(name, TagReader.matches(out, TagFormat.Mp3, edit))
            val before = open(input) { Id3.read(it) }
            val after = open(out) { Id3.read(it) }!!
            assertEquals(name, major, after.major)
            // Track number and encoder frames survive; album was cleared, so it is gone.
            val kept = before?.frames.orEmpty().map { it.id }.filter { it !in Id3.FRAME_IDS.values }
            assertEquals(name, kept, after.frames.map { it.id }.filter { it !in Id3.FRAME_IDS.values })
            assertFalse(after.frames.any { it.id == "TALB" })
            val audioIn = input.readBytes().drop((before?.totalSize ?: 0).toInt())
            val audioOut = out.readBytes().drop(after.totalSize.toInt())
            assertEquals(name, audioIn, audioOut)
        }
    }

    @Test
    fun id3TextEncodingFollowsVersion() {
        assertEquals(0, Id3.textBody("Plain", 3)[0].toInt())
        assertEquals(1, Id3.textBody("Кириллица", 3)[0].toInt())
        assertEquals(3, Id3.textBody("Кириллица", 4)[0].toInt())
        assertEquals("Кириллица", Id3.text(Id3.textBody("Кириллица", 3)))
        assertEquals("Кириллица", Id3.text(Id3.textBody("Кириллица", 4)))
    }

    @Test
    fun rejectsId3v22AndForeignBytes() {
        val v22 = tmp.newFile("old.mp3").apply { writeBytes(byteArrayOf(0x49, 0x44, 0x33, 2, 0, 0, 0, 0, 0, 10) + ByteArray(30)) }
        expect(TagWriteException.Reason.Unsupported) { rewrite(v22, TagFormat.Mp3) }
        val notMp3 = sample("tagged.flac")
        expect(TagWriteException.Reason.Damaged) { rewrite(notMp3, TagFormat.Mp4) }
        expect(TagWriteException.Reason.Damaged) { rewrite(sample("tagged.ogg"), TagFormat.Flac) }
    }

    private fun expect(reason: TagWriteException.Reason, block: () -> Unit) {
        try {
            block()
            fail("Expected $reason")
        } catch (e: TagWriteException) {
            assertEquals(e.message, reason, e.reason)
        }
    }

    @Test
    fun flacKeepsOtherBlocksCommentsAndAudio() {
        val input = sample("tagged.flac")
        val out = rewrite(input, TagFormat.Flac)
        assertTrue(TagReader.matches(out, TagFormat.Flac, edit))
        val (inLayout, inComments) = open(input) { f -> Flac.layout(f).let { it to Flac.comments(f, it)!! } }
        val (outLayout, outComments) = open(out) { f -> Flac.layout(f).let { it to Flac.comments(f, it)!! } }
        assertEquals(inComments.vendor, outComments.vendor)
        assertEquals("3", outComments.value("TRACKNUMBER"))
        assertEquals(inLayout.blocks.first().length, outLayout.blocks.first().length)
        val audioIn = input.readBytes().copyOfRange(inLayout.audioAt.toInt(), input.length().toInt())
        val audioOut = out.readBytes().copyOfRange(outLayout.audioAt.toInt(), out.length().toInt())
        assertArrayEquals(audioIn, audioOut)
        // A second edit fits the padding left by the first: the audio does not move.
        val again = rewrite(out, TagFormat.Flac, TagEdit("Short"))
        assertEquals(outLayout.audioAt, open(again) { Flac.layout(it).audioAt })
        assertEquals(mapOf(TagField.Title to "Short", TagField.Artist to null, TagField.Album to null, TagField.Genre to null), TagReader.read(again, TagFormat.Flac))
    }

    /** Every page of [file]: sequence numbers run on and each CRC is right. */
    private fun checkOggPages(file: File): List<OggPages.Page> = open(file) { f ->
        val pages = ArrayList<OggPages.Page>()
        var offset = 0L
        while (offset < f.length()) {
            val page = OggPages.read(f, offset) ?: error("No page at $offset")
            val bytes = Bytes.requireAt(f, offset, page.totalLength)
            val stored = Bytes.le32(bytes, 22)
            Bytes.putLe32(bytes, 22, 0)
            assertEquals("CRC of page ${page.sequence}", stored, OggPages.crc(bytes))
            assertEquals(pages.size.toLong(), page.sequence)
            pages += page
            offset += page.totalLength
        }
        pages
    }

    /** Payloads of the audio pages (after the headers). */
    private fun audioPayloads(file: File): List<List<Byte>> = open(file) { f ->
        val headers = Ogg.headers(f)
        val result = ArrayList<List<Byte>>()
        var offset = headers.endOffset
        while (offset < f.length()) {
            val page = OggPages.read(f, offset)!!
            result += Bytes.requireAt(f, offset + page.headerLength, page.dataLength).toList()
            offset += page.totalLength
        }
        result
    }

    @Test
    fun oggVorbisAndOpusKeepAudioPagesAndOtherComments() {
        for (name in listOf("tagged.ogg", "tagged.opus", "bigcomment.ogg")) {
            val input = sample(name)
            checkOggPages(input)
            val out = rewrite(input, TagFormat.Ogg)
            assertTrue(name, TagReader.matches(out, TagFormat.Ogg, edit))
            checkOggPages(out)
            assertEquals(name, audioPayloads(input), audioPayloads(out))
            val comments = open(out) { Ogg.comments(Ogg.headers(it)) }
            assertEquals(open(input) { Ogg.comments(Ogg.headers(it)).vendor }, comments.vendor)
        }
        // Header pages are laid out anew (ffmpeg packs comments and setup together, Playly does not),
        // so at least one sample has its audio pages renumbered: the CRC check above covers that path.
        val shifted = listOf("tagged.ogg", "tagged.opus", "bigcomment.ogg").any { name ->
            val input = sample(name)
            open(input) { Ogg.headers(it).pageCount } != open(rewrite(input, TagFormat.Ogg)) { Ogg.headers(it).pageCount }
        }
        assertTrue(shifted)
        assertEquals("3", open(rewrite(sample("tagged.ogg"), TagFormat.Ogg)) { Ogg.comments(Ogg.headers(it)).value("TRACKNUMBER") })
    }

    /** All chunk offsets of the file, track by track. */
    private fun chunkOffsets(file: File): List<Long> = open(file) { f ->
        val layout = Mp4.layout(f)
        val moov = Mp4.readMoov(f, layout)
        val result = ArrayList<Long>()
        fun walk(from: Int, to: Int) {
            for (box in Mp4.boxesIn(moov, from, to)) {
                val start = box.contentStart.toInt()
                when (box.type) {
                    "trak", "mdia", "minf", "stbl" -> walk(start, box.end.toInt())
                    "stco" -> repeat(Bytes.be32(moov, start + 4).toInt()) { result += Bytes.be32(moov, start + 8 + it * 4) }
                    "co64" -> repeat(Bytes.be32(moov, start + 4).toInt()) { result += Bytes.be64(moov, start + 8 + it * 8) }
                }
            }
        }
        walk(layout.moov.headerSize, moov.size)
        result
    }

    /** The bytes every chunk offset points at are the same before and after. */
    private fun assertChunksIntact(input: File, out: File) {
        val a = input.readBytes()
        val b = out.readBytes()
        val before = chunkOffsets(input)
        val after = chunkOffsets(out)
        assertEquals(before.size, after.size)
        assertTrue(before.isNotEmpty())
        before.zip(after).forEach { (x, y) ->
            assertArrayEquals(a.copyOfRange(x.toInt(), x.toInt() + 16), b.copyOfRange(y.toInt(), y.toInt() + 16))
        }
    }

    @Test
    fun mp4MovesChunkOffsetsOnlyWhenAudioFollowsMoov() {
        val long = TagEdit("Очень длинное название " + "x".repeat(300), "Artist", "Album", "Genre")
        for (name in listOf("faststart.m4a", "moov_last.m4a")) {
            for (with in listOf(edit, long, TagEdit("S"))) {
                val input = sample(name)
                val out = rewrite(input, TagFormat.Mp4, with)
                assertTrue(name, TagReader.matches(out, TagFormat.Mp4, with))
                assertChunksIntact(input, out)
            }
        }
        // moov after the audio: offsets are untouched whatever the size change.
        val last = sample("moov_last.m4a")
        assertEquals(chunkOffsets(last), chunkOffsets(rewrite(last, TagFormat.Mp4, long)))
        // moov in front: growing moves the audio by exactly the growth.
        val fast = sample("faststart.m4a")
        val grown = rewrite(fast, TagFormat.Mp4, long)
        val delta = grown.length() - fast.length()
        assertTrue(delta > 0)
        assertEquals(chunkOffsets(fast).map { it + delta }, chunkOffsets(grown))
    }

    @Test
    fun mp4KeepsOtherItemsAndDropsNumericGenre() {
        val out = rewrite(sample("faststart.m4a"), TagFormat.Mp4)
        val items = open(out) { Mp4.items(it) }
        assertEquals("Новое название", items["©nam"])
        assertNull(items["©alb"])
        assertNull(items["gnre"])
        // ffmpeg's encoder tag stays.
        assertTrue(items.keys.toString(), "©too" in items)
    }

    @Test
    fun formatsAndCleaning() {
        assertEquals(TagFormat.Mp3, TagFormat.of("a.MP3", null))
        assertEquals(TagFormat.Ogg, TagFormat.of("a.opus", null))
        assertEquals(TagFormat.Mp4, TagFormat.of("a.m4a", null))
        assertEquals(TagFormat.Flac, TagFormat.of("noext", "audio/flac"))
        assertNull(TagFormat.of("a.wav", "audio/wav"))
        assertNull(TagFormat.of("a.wma", null))
        assertEquals(TagEdit("A B", "", "C", ""), TagEdit("  A\tB ", "   ", "C\u0007", "").cleaned())
        assertFalse(TagEdit("   ").isValid)
        try {
            rewrite(sample("v23.mp3"), TagFormat.Mp3, TagEdit(" "))
            fail("Blank title accepted")
        } catch (_: IllegalArgumentException) {
        }
    }
}
