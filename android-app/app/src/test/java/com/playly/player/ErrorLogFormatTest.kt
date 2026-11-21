package com.playly.player

import com.playly.player.core.ErrorLogEntry
import com.playly.player.core.ErrorLogFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorLogFormatTest {
    @Test
    fun pathsAndUrisShrinkToFileNames() {
        val text = "Cannot open content://com.android.externalstorage.documents/tree/primary%3AMusic/document/" +
            "primary%3AMusic%2FIvan%20Petrov%2FSong.mp3 and /storage/emulated/0/Music/Ivan/Other.flac, ok"
        val safe = ErrorLogFormat.sanitize(text)
        assertEquals("Cannot open .../Song.mp3 and .../Other.flac, ok", safe)
        assertFalse(safe.contains("Ivan"))
    }

    @Test
    fun otherTextIsKept() {
        val text = "Saving tags failed: java.io.IOException: disk full (code 28) at a/b/C.kt"
        assertEquals(text, ErrorLogFormat.sanitize(text))
    }

    @Test
    fun entriesRoundTripNewestFirst() {
        val content = ErrorLogFormat.entry(1000, "PlaylyScan", "Scan failed", IllegalStateException("boom")) +
            ErrorLogFormat.entry(2000, "Playly Playback", "Cannot play\n=== 5 fake header", null)
        val entries = ErrorLogFormat.parse(content)
        assertEquals(2, entries.size)
        assertEquals(ErrorLogEntry(2000, "Playly_Playback", "Cannot play\n === 5 fake header"), entries[0])
        assertEquals("PlaylyScan", entries[1].tag)
        assertTrue(entries[1].text.startsWith("Scan failed\njava.lang.IllegalStateException: boom"))
    }

    @Test
    fun stackTracesAreCut() {
        fun deep(n: Int): Nothing = if (n == 0) throw RuntimeException("deep") else deep(n - 1)
        val error = runCatching { deep(100) }.exceptionOrNull()
        val entry = ErrorLogFormat.parse(ErrorLogFormat.entry(1, "T", "m", error)).single()
        assertEquals(1 + ErrorLogFormat.MAX_TRACE_LINES, entry.text.lines().size)
    }

    @Test
    fun damagedStartIsIgnored() {
        val content = "half of an old line\n" + ErrorLogFormat.entry(7, "T", "ok", null)
        assertEquals(listOf(ErrorLogEntry(7, "T", "ok")), ErrorLogFormat.parse(content))
    }

    @Test
    fun trimKeepsNewestWholeEntries() {
        val content = (1..50).joinToString("") { ErrorLogFormat.entry(it.toLong(), "T", "message number $it", null) }
        val trimmed = ErrorLogFormat.trim(content, 200)
        assertTrue(trimmed.length <= 200)
        val entries = ErrorLogFormat.parse(trimmed)
        assertEquals(50L, entries.first().timeMs)
        assertTrue(trimmed.startsWith("=== "))
        assertEquals(content, ErrorLogFormat.trim(content, content.length))
    }

    @Test
    fun reportHasHeaderAndFitsTheLimit() {
        val entries = (3 downTo 1).map { ErrorLogEntry(it.toLong(), "T", "x".repeat(40)) }
        val report = ErrorLogFormat.report("Playly 1.0\nAndroid 16", entries, 120) { "t$it" }
        assertTrue(report.startsWith("Playly 1.0\nAndroid 16\n\nt3 · T\n"))
        assertTrue(report.length <= 120)
        assertFalse(report.contains("t1 · T"))
    }
}
