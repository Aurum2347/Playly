package com.playly.player

import com.playly.player.data.lyrics.EmbeddedLyrics
import com.playly.player.data.lyrics.LrcParser
import com.playly.player.data.lyrics.LyricLine
import com.playly.player.data.lyrics.Lyrics
import com.playly.player.data.lyrics.LyricsFiles
import com.playly.player.data.lyrics.LyricsText
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.StandardOpenOption
import java.nio.channels.FileChannel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Stage 8.2: LRC parsing as on the desktop, text encodings, sidecar names, embedded tags. */
class LyricsStageTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun parsesTimedLinesSortedWithSeveralTagsPerLine() {
        val raw = "[ar:Artist]\n[00:12.50]Second\n[00:01.00][00:20]First and again\n"
        val lyrics = LrcParser.parse(raw) as Lyrics.Synced
        assertEquals(
            listOf(LyricLine(1_000, "First and again"), LyricLine(12_500, "Second"), LyricLine(20_000, "First and again")),
            lyrics.lines,
        )
    }

    @Test
    fun appliesOffsetAndDropsWordTags() {
        val raw = "[offset:+500]\n[00:02.00]<00:02.00>Hello <00:02.50>world\n[00:00.20]Early"
        val lyrics = LrcParser.parse(raw) as Lyrics.Synced
        assertEquals(LyricLine(0, "Early"), lyrics.lines[0])
        assertEquals(LyricLine(1_500, "Hello world"), lyrics.lines[1])
    }

    @Test
    fun fractionDigitsMeanHundredthsOrThousandths() {
        val lyrics = LrcParser.parse("[01:02.5]a\n[01:02.05]b\n[01:02.005]c") as Lyrics.Synced
        assertEquals(listOf(62_005L, 62_050L, 62_500L), lyrics.lines.map { it.timeMs })
    }

    @Test
    fun textWithoutTimesIsPlainWithInnerBlankLinesKept() {
        val lyrics = LrcParser.parse("﻿\n\nVerse one\n\nVerse two\n\n") as Lyrics.Plain
        assertEquals(listOf("Verse one", "", "Verse two"), lyrics.lines)
    }

    @Test
    fun emptyOrOnlyMetadataIsNoText() {
        assertNull(LrcParser.parse("   "))
        assertNull(LrcParser.parse("[ar:Someone]\n[ti:Song]"))
    }

    @Test
    fun activeLineFollowsPosition() {
        val lines = listOf(LyricLine(1_000, "a"), LyricLine(5_000, "b"), LyricLine(9_000, "c"))
        assertEquals(-1, LrcParser.activeLine(lines, 999))
        assertEquals(0, LrcParser.activeLine(lines, 1_000))
        assertEquals(1, LrcParser.activeLine(lines, 8_999))
        assertEquals(2, LrcParser.activeLine(lines, 60_000))
        assertEquals(-1, LrcParser.activeLine(emptyList(), 5_000))
    }

    @Test
    fun waitsExactlyUntilTheNextLine() {
        val lines = listOf(LyricLine(1_000, "a"), LyricLine(1_000, "a2"), LyricLine(9_000, "b"))
        assertEquals(1_000L, LrcParser.msUntilNext(lines, 0))
        // Two lines with one time stamp: the wait goes past both to the next one.
        assertEquals(8_000L, LrcParser.msUntilNext(lines, 1_000))
        assertEquals(1L, LrcParser.msUntilNext(lines, 8_999))
        assertNull(LrcParser.msUntilNext(lines, 9_000))
        assertNull(LrcParser.msUntilNext(emptyList(), 0))
    }

    @Test
    fun decodesUtf8Utf16AndWindows1251() {
        val text = "Привет"
        assertEquals(text, LyricsText.decode(text.toByteArray(Charsets.UTF_8)))
        assertEquals(text, LyricsText.decode(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + text.toByteArray(Charsets.UTF_8)))
        assertEquals(text, LyricsText.decode(byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + text.toByteArray(Charsets.UTF_16LE)))
        assertEquals(text, LyricsText.decode(text.toByteArray(charset("windows-1251"))))
    }

    @Test
    fun sidecarHasTheTrackNameWithLrc() {
        assertEquals(listOf("primary:Music/A/song.lrc", "primary:Music/A/song.LRC"), LyricsFiles.sidecarIds("primary:Music/A/song.mp3"))
        assertEquals(listOf("1234-ABCD:x.y.lrc", "1234-ABCD:x.y.LRC"), LyricsFiles.sidecarIds("1234-ABCD:x.y.flac"))
        assertEquals(listOf("primary:noext.lrc", "primary:noext.LRC"), LyricsFiles.sidecarIds("primary:noext"))
        assertEquals(emptyList<String>(), LyricsFiles.sidecarIds("opaque-id"))
    }

    @Test
    fun readsId3UsltAfterOtherFrames() {
        val uslt = byteArrayOf(3) + "eng".toByteArray() + "desc".toByteArray() + byteArrayOf(0) + "[00:01.00]Строка".toByteArray()
        val frames = id3Frame("TIT2", byteArrayOf(3) + "Title".toByteArray()) + id3Frame("USLT", uslt)
        val tag = "ID3".toByteArray() + byteArrayOf(4, 0, 0) + syncsafe(frames.size + 20) + frames + ByteArray(20)
        assertEquals("[00:01.00]Строка", readTag(tag + ByteArray(100)))
    }

    @Test
    fun fallsBackToTxxxLyricsButPrefersUslt() {
        val txxx = byteArrayOf(3) + "LYRICS".toByteArray() + byteArrayOf(0) + "From TXXX".toByteArray()
        val other = byteArrayOf(3) + "COMMENT".toByteArray() + byteArrayOf(0) + "Not lyrics".toByteArray()
        val uslt = byteArrayOf(3) + "eng".toByteArray() + byteArrayOf(0) + "From USLT".toByteArray()
        fun tag(frames: ByteArray) = "ID3".toByteArray() + byteArrayOf(3, 0, 0) + syncsafe(frames.size) + frames + ByteArray(50)
        fun v23(id: String, body: ByteArray) = id.toByteArray() + ByteBuffer.allocate(4).putInt(body.size).array() + byteArrayOf(0, 0) + body
        assertEquals("From TXXX", readTag(tag(v23("TXXX", other) + v23("TXXX", txxx))))
        assertEquals("From USLT", readTag(tag(v23("TXXX", txxx) + v23("USLT", uslt))))
        assertNull(readTag(tag(v23("TXXX", other))))
        // ffmpeg's "-metadata lyrics=..." lands in TXXX:USLT.
        val ffmpeg = byteArrayOf(0) + "USLT".toByteArray() + byteArrayOf(0) + "Line one\nLine two".toByteArray()
        assertEquals("Line one\nLine two", EmbeddedLyrics.txxxLyrics(ffmpeg))
    }

    @Test
    fun readsUtf16Uslt() {
        val body = byteArrayOf(1) + "eng".toByteArray() + byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0, 0) +
            byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + "Слова".toByteArray(Charsets.UTF_16LE)
        assertEquals("Слова", EmbeddedLyrics.uslt(body))
    }

    @Test
    fun readsFlacVorbisLyrics() {
        val comments = vorbis("TITLE=Song", "lyrics=First line\nSecond line")
        val streamInfo = byteArrayOf(0, 0, 0, 34) + ByteArray(34)
        val block = byteArrayOf((0x80 or 4).toByte()) + int24(comments.size) + comments
        val file = "fLaC".toByteArray() + streamInfo + block + ByteArray(50)
        assertEquals("First line\nSecond line", readTag(file))
    }

    @Test
    fun readsMp4LyricsAtom() {
        val data = box("data", ByteArray(8) + "Mp4 words".toByteArray())
        val lyr = box(String(byteArrayOf(0xA9.toByte()), Charsets.ISO_8859_1) + "lyr", data)
        val meta = box("meta", ByteArray(4) + box("hdlr", ByteArray(25)) + box("ilst", lyr))
        val moov = box("moov", box("mvhd", ByteArray(100)) + box("udta", meta))
        val file = box("ftyp", "M4A ".toByteArray() + ByteArray(4)) + box("mdat", ByteArray(200)) + moov
        assertEquals("Mp4 words", readTag(file))
    }

    @Test
    fun filesWithoutLyricsOrGarbageGiveNothing() {
        assertNull(readTag(ByteArray(64)))
        assertNull(readTag("ID3".toByteArray() + byteArrayOf(4, 0, 0, 0x7F, 0x7F, 0x7F, 0x7F)))
        assertNull(readTag(ByteArray(3)))
    }

    private fun readTag(bytes: ByteArray): String? = channel(bytes).use { EmbeddedLyrics.read(it) }

    private fun channel(bytes: ByteArray): FileChannel {
        val file = File(tmp.root, "f${bytes.size}-${System.nanoTime()}")
        file.writeBytes(bytes)
        return FileChannel.open(file.toPath(), StandardOpenOption.READ)
    }

    private fun id3Frame(id: String, body: ByteArray) = id.toByteArray() + syncsafe(body.size) + byteArrayOf(0, 0) + body

    private fun syncsafe(n: Int) = byteArrayOf((n shr 21 and 0x7F).toByte(), (n shr 14 and 0x7F).toByte(), (n shr 7 and 0x7F).toByte(), (n and 0x7F).toByte())

    private fun int24(n: Int) = byteArrayOf((n shr 16).toByte(), (n shr 8).toByte(), n.toByte())

    private fun vorbis(vararg entries: String): ByteArray {
        val out = ByteArrayOutputStream()
        fun le(n: Int) = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array()
        val vendor = "test".toByteArray()
        out.write(le(vendor.size)); out.write(vendor); out.write(le(entries.size))
        entries.forEach { val b = it.toByteArray(); out.write(le(b.size)); out.write(b) }
        return out.toByteArray()
    }

    private fun box(type: String, content: ByteArray): ByteArray =
        ByteBuffer.allocate(4).putInt(8 + content.size).array() + type.toByteArray(Charsets.ISO_8859_1) + content
}
