package com.playly.player

import com.playly.player.data.backup.M3u
import com.playly.player.data.backup.M3uEntry
import org.junit.Assert.assertEquals
import org.junit.Test

/* 9.2: M3U playlist files. */
class M3uTest {
    @Test
    fun roundTripKeepsOrderTagsAndLengths() {
        val entries = listOf(M3uEntry("Rock/01 Intro.mp3", "Intro", "Band", 61_400), M3uEntry("Pop/Song.flac", "Song", null, 0))
        val text = M3u.write("Road", entries)
        val expected = "#EXTM3U\n#PLAYLIST:Road\n#EXTINF:61,Band - Intro\nRock/01 Intro.mp3\n#EXTINF:-1,Song\nPop/Song.flac\n"
        assertEquals(expected, text)
        val parsed = M3u.parse(text)
        assertEquals("Road", parsed.name)
        assertEquals(listOf(entries[0].copy(durationMs = 61_000), entries[1]), parsed.entries)
    }

    @Test
    fun readsFilesOfOtherPlayers() {
        val text = "\r\n#EXTM3U\r\n#EXTINF:200,Artist - A - B\r\nD:\\Music\\a.mp3\r\n" +
            "http://radio.example/stream\r\n#EXTINF:5\r\nfile:///storage/My%20Music/b.mp3\r\nplain.ogg\r\n"
        val parsed = M3u.parse(text)
        assertEquals(null, parsed.name)
        assertEquals(
            listOf(
                M3uEntry("D:\\Music\\a.mp3", "A - B", "Artist", 200_000),
                M3uEntry("/storage/My Music/b.mp3", null, null, 5_000),
                M3uEntry("plain.ogg"),
            ),
            parsed.entries,
        )
    }

    @Test
    fun decodesUtf8WithBomAndWindows1251() {
        val utf8 = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "Ёлка.mp3".toByteArray(Charsets.UTF_8)
        assertEquals("Ёлка.mp3", M3u.decode(utf8))
        val cp1251 = "Ёлка.mp3".toByteArray(charset("windows-1251"))
        assertEquals("Ёлка.mp3", M3u.decode(cp1251))
    }
}
