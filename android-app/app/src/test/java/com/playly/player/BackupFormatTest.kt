package com.playly.player

import com.playly.player.data.backup.BackupFavorite
import com.playly.player.data.backup.BackupFile
import com.playly.player.data.backup.BackupPlaylist
import com.playly.player.data.backup.BackupTrack
import com.playly.player.data.playlists.PlaylistRules
import com.playly.player.ui.screens.playlists.PlaylistCommands
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import kotlinx.serialization.SerializationException
import org.junit.Test

/* 9.2: the backup file format and file names. */
class BackupFormatTest {
    @Test
    fun backupRoundTripsAndToleratesUnknownFields() {
        val file = BackupFile(
            format = BackupFile.FORMAT,
            createdAt = 5,
            appVersion = "1.0",
            playlists = listOf(BackupPlaylist("Road", "desc", 2, 3, listOf(BackupTrack("Rock/a.mp3", "A", null, 1, 2)))),
            favorites = listOf(BackupFavorite(BackupTrack(title = "B"), addedAt = 9)),
        )
        val text = BackupFile.json.encodeToString(BackupFile.serializer(), file)
        assertTrue(text.contains("\"format\": \"playly-android-backup\""))
        assertEquals(file, BackupFile.json.decodeFromString(BackupFile.serializer(), text))
        val future = text.replaceFirst("{", "{\"futureField\": [1, 2],")
        assertEquals(file, BackupFile.json.decodeFromString(BackupFile.serializer(), future))
    }

    @Test(expected = SerializationException::class)
    fun otherJsonIsNotABackup() {
        BackupFile.json.decodeFromString(BackupFile.serializer(), "{\"hello\": 1}")
    }

    @Test
    fun uniqueNamesAndExportFileNames() {
        assertEquals("Road", PlaylistRules.uniqueName("Road", setOf("rock")))
        assertEquals("Road (3)", PlaylistRules.uniqueName("Road", setOf("road", "road (2)")))
        val long = "x".repeat(PlaylistRules.MAX_NAME_LENGTH)
        assertEquals(PlaylistRules.MAX_NAME_LENGTH, PlaylistRules.uniqueName(long, setOf(long)).length)
        assertEquals("AC_DC_ Live_.m3u8", PlaylistCommands.exportFileName("AC/DC: Live?"))
        assertEquals("playlist.m3u8", PlaylistCommands.exportFileName("  "))
    }
}
