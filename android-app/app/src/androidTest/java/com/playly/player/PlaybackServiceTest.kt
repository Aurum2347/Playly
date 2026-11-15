package com.playly.player

import android.content.ComponentName
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.playly.player.data.db.TrackEntity
import com.playly.player.playback.ArtworkUri
import com.playly.player.playback.PlaybackCommands
import com.playly.player.playback.PlaybackService
import com.playly.player.playback.PlaybackSource
import com.playly.player.playback.QueueEntry
import kotlinx.coroutines.flow.first
import com.playly.player.playback.PlaybackStateStore
import com.playly.player.playback.SavedPlayback
import com.playly.player.data.artwork.Artwork
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real engine on a device: PlaybackService + ExoPlayer + media session, driven through a
 * MediaController like the UI does. Plays generated silent WAV files, so nothing is audible.
 */
@OptIn(UnstableApi::class)
@RunWith(AndroidJUnit4::class)
class PlaybackServiceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val container get() = (context as PlaylyApplication).container
    private val dir = File(context.cacheDir, "playback-test")
    private val trackIds = mutableListOf<Long>()
    private val events = CopyOnWriteArrayList<Pair<String, Bundle>>()
    private lateinit var controller: MediaController

    @Before
    fun setUp() = runBlocking<Unit> {
        dir.mkdirs()
        val files = listOf("a", "b", "c").map { name -> File(dir, "$name.wav").also { writeSilentWav(it, seconds = 6) } }
        val broken = File(dir, "broken.wav").apply { writeText("not audio at all") }
        val entities = (files + broken).map { file ->
            TrackEntity(
                uri = file.toURI().toString(),
                title = "Playly test ${file.nameWithoutExtension}",
                fileName = file.name,
                durationMs = 6_000,
                dateAdded = 0,
                dateModified = file.lastModified(),
                searchKey = "playly test ${file.nameWithoutExtension}",
            )
        }
        trackIds += container.database.trackDao().insertAll(entities)
        controller = onMain {
            MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java)))
                .setApplicationLooper(Looper.getMainLooper())
                .setListener(object : MediaController.Listener {
                    override fun onCustomCommand(
                        controller: MediaController,
                        command: SessionCommand,
                        args: Bundle,
                    ): ListenableFuture<SessionResult> {
                        events += command.customAction to args
                        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                    }
                })
                .buildAsync()
                .await()
                .also {
                    // Modes are sticky across queues (and the service may outlive a test): start clean.
                    it.shuffleModeEnabled = false
                    it.repeatMode = Player.REPEAT_MODE_OFF
                }
        }
    }

    @After
    fun tearDown() = runBlocking<Unit> {
        onMain {
            controller.stop()
            controller.clearMediaItems()
            delay(SAVE_SETTLE_MS)
            controller.release()
        }
        withContext(Dispatchers.IO) {
            container.database.trackDao().deleteAll(trackIds)
            container.playbackStore.write(null)
        }
        dir.deleteRecursively()
    }

    private val a get() = trackIds[0]
    private val b get() = trackIds[1]
    private val c get() = trackIds[2]
    private val broken get() = trackIds[3]

    @Test
    fun playsAQueueFromTheChosenTrackAndNavigates() = runBlocking<Unit> {
        onMain {
            play(listOf(a, b, c), startIndex = 1)
            waitUntil { controller.isPlaying }
            assertEquals(b.toString(), controller.currentMediaItem?.mediaId)
            assertEquals("Playly test b", controller.mediaMetadata.title.toString())
            assertNotNull("artwork travels as a private URI", ArtworkUri.parse(controller.mediaMetadata.artworkUri))
            assertEquals(3, controller.mediaItemCount)

            controller.seekToNext()
            waitUntil { controller.currentMediaItem?.mediaId == c.toString() }
            controller.seekTo(4_000)
            waitUntil { controller.currentPosition >= 4_000 }
            // Past the first seconds, "previous" restarts the track instead of leaving it.
            controller.seekToPrevious()
            waitUntil { controller.currentPosition < 2_000 }
            assertEquals(c.toString(), controller.currentMediaItem?.mediaId)

            controller.pause()
            waitUntil { !controller.isPlaying }
        }
    }

    @Test
    fun shuffleAndRepeatAreSessionCommands() = runBlocking<Unit> {
        onMain {
            play(listOf(a, b, c), startIndex = 0)
            waitUntil { controller.isPlaying }
            controller.sendCustomCommand(PlaybackCommands.TOGGLE_SHUFFLE, Bundle.EMPTY).await()
            waitUntil { controller.shuffleModeEnabled }
            // Turning shuffle on never jumps away from the current track.
            assertEquals(a.toString(), controller.currentMediaItem?.mediaId)
            controller.sendCustomCommand(PlaybackCommands.CYCLE_REPEAT, Bundle.EMPTY).await()
            waitUntil { controller.repeatMode == Player.REPEAT_MODE_ALL }
            controller.sendCustomCommand(PlaybackCommands.CYCLE_REPEAT, Bundle.EMPTY).await()
            waitUntil { controller.repeatMode == Player.REPEAT_MODE_ONE }
            controller.sendCustomCommand(PlaybackCommands.CYCLE_REPEAT, Bundle.EMPTY).await()
            waitUntil { controller.repeatMode == Player.REPEAT_MODE_OFF }
            controller.sendCustomCommand(PlaybackCommands.TOGGLE_SHUFFLE, Bundle.EMPTY).await()
            waitUntil { !controller.shuffleModeEnabled }
        }
    }

    @Test
    fun audioFocusLossPausesAndTransientLossResumes() = runBlocking<Unit> {
        val audio = context.getSystemService(AudioManager::class.java)
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
        onMain {
            play(listOf(a, b), startIndex = 0)
            waitUntil { controller.isPlaying }
        }
        // Another "app" takes focus briefly (a notification sound, a short call)...
        val transient = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).build()
        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, audio.requestAudioFocus(transient))
        onMain { waitUntil { !controller.isPlaying } }
        audio.abandonAudioFocusRequest(transient)
        // ...and gives it back: playback continues by itself.
        onMain { waitUntil { controller.isPlaying } }

        // Another player takes focus for good: Playly pauses and stays paused.
        val permanent = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).build()
        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, audio.requestAudioFocus(permanent))
        onMain {
            waitUntil { !controller.playWhenReady }
            assertFalse(controller.isPlaying)
        }
        audio.abandonAudioFocusRequest(permanent)
    }

    @Test
    fun brokenFileIsSkippedAndReported() = runBlocking<Unit> {
        onMain {
            play(listOf(broken, b), startIndex = 0)
            waitUntil { controller.isPlaying }
            assertEquals(b.toString(), controller.currentMediaItem?.mediaId)
            waitUntil { events.any { it.first == PlaybackCommands.EVENT_ERROR } }
            val error = events.first { it.first == PlaybackCommands.EVENT_ERROR }.second
            assertTrue(error.getBoolean(PlaybackCommands.ARG_SKIPPED))
            assertEquals("Playly test broken", error.getString(PlaybackCommands.ARG_TITLE))
        }
    }

    @Test
    fun onlyBrokenFilesStopCleanlyInsteadOfLooping() = runBlocking<Unit> {
        onMain {
            play(listOf(broken), startIndex = 0)
            waitUntil { events.any { it.first == PlaybackCommands.EVENT_ERROR } }
            waitUntil { controller.playbackState == Player.STATE_IDLE && !controller.playWhenReady }
            assertFalse(events.first { it.first == PlaybackCommands.EVENT_ERROR }.second.getBoolean(PlaybackCommands.ARG_SKIPPED))
        }
    }

    @Test
    fun unknownTracksAreRejectedAndTheQueueKeepsPlaying() = runBlocking<Unit> {
        onMain {
            play(listOf(a), startIndex = 0)
            waitUntil { controller.isPlaying }
            play(listOf(Long.MAX_VALUE), startIndex = 0)
            waitUntil { events.any { it.first == PlaybackCommands.EVENT_NOTHING_PLAYABLE } }
            assertTrue(controller.isPlaying)
            assertEquals(a.toString(), controller.currentMediaItem?.mediaId)
        }
    }

    @Test
    fun queuePositionAndModesAreSaved() = runBlocking<Unit> {
        onMain {
            play(listOf(a, b, c), startIndex = 2)
            waitUntil { controller.isPlaying }
            controller.seekTo(2_500)
            controller.sendCustomCommand(PlaybackCommands.CYCLE_REPEAT, Bundle.EMPTY).await()
            controller.pause()
            waitUntil { !controller.isPlaying }
            delay(SAVE_SETTLE_MS)
        }
        val saved = withContext(Dispatchers.IO) { container.playbackStore.read() }
        assertNotNull(saved)
        assertEquals(listOf(a, b, c), saved!!.trackIds)
        assertEquals(2, saved.index)
        assertTrue("position ${saved.positionMs}", saved.positionMs in 2_400..4_000)
        assertEquals(Player.REPEAT_MODE_ALL, saved.repeatMode)
    }

    @Test
    fun stateStoreSurvivesCorruptionAndRoundTrips() {
        val store = PlaybackStateStore(dir)
        assertNull(store.read())
        val state = SavedPlayback(listOf(3L, 1L, 2L), index = 1, positionMs = 42, shuffle = true, repeatMode = Player.REPEAT_MODE_ONE)
        store.write(state)
        assertEquals(state, PlaybackStateStore(dir).read())
        File(dir, "playback_state.json").writeText("{ broken")
        assertNull(PlaybackStateStore(dir).read())
        store.write(null)
        assertNull(store.read())
    }

    @Test
    fun artworkUriRoundTrips() {
        val artwork = Artwork("content://media/external/audio/media/12?x=1&y=ä", 12, 7, 1_700_000_000_000, 4_096)
        assertEquals(artwork, ArtworkUri.parse(ArtworkUri.from(artwork)))
        assertEquals(artwork.copy(mediaStoreId = null, albumId = null), ArtworkUri.parse(ArtworkUri.from(artwork.copy(mediaStoreId = null, albumId = null))))
        assertNull(ArtworkUri.parse(android.net.Uri.parse("content://media/external/audio/media/12")))
    }

    /** Stage 5: the app's own controller (what the player screen reads) mirrors the session. */
    @Test
    fun playerStateShowsSourceAndQueueInPlayOrder() = runBlocking<Unit> {
        val playback = container.playback
        val source = PlaybackSource(PlaybackSource.Kind.Search, "playly")
        onMain {
            playback.playTracks(listOf(a, b, c), 0, shuffle = true, source = source)
            waitUntil { playback.state.value.isPlaying && playback.state.value.source == source }
            val queue = withTimeout(5_000) { playback.queue.first { it.current?.trackId == a && it.upNext.size == 2 } }
            assertEquals(setOf(b, c), queue.upNext.map { it.trackId }.toSet())
            // "Up next" is the real shuffled order: next goes exactly there.
            for (entry in queue.upNext) {
                playback.next()
                waitUntil { playback.state.value.nowPlaying?.trackId == entry.trackId }
            }
            // Another controller (like the notification) changes a mode: the player state follows.
            controller.sendCustomCommand(PlaybackCommands.TOGGLE_SHUFFLE, Bundle.EMPTY).await()
            waitUntil { !playback.state.value.shuffle }
            // Jump from the queue by id: a stale index (2 is not "a") still finds the right track.
            playback.playQueueEntry(QueueEntry(index = 2, trackId = a, title = "", artist = null, artwork = null))
            waitUntil { playback.state.value.nowPlaying?.trackId == a }
            delay(SAVE_SETTLE_MS)
        }
        val saved = withContext(Dispatchers.IO) { container.playbackStore.read() }
        assertEquals(source, saved?.source)
    }

    @Test
    fun stoppedAfterFailureShowsAnIssueUntilAnotherTrackPlays() = runBlocking<Unit> {
        val playback = container.playback
        onMain {
            playback.playTracks(listOf(broken), 0)
            waitUntil { playback.state.value.issue != null }
            assertEquals(broken, playback.state.value.nowPlaying?.trackId)
            playback.playTracks(listOf(a), 0)
            waitUntil { playback.state.value.isPlaying }
            assertNull(playback.state.value.issue)
        }
    }

    private fun play(ids: List<Long>, startIndex: Int) {
        controller.sendCustomCommand(
            PlaybackCommands.PLAY_TRACKS,
            Bundle().apply {
                putLongArray(PlaybackCommands.ARG_TRACK_IDS, ids.toLongArray())
                putInt(PlaybackCommands.ARG_START_INDEX, startIndex)
            },
        )
    }

    private fun <T> onMain(block: suspend CoroutineScope.() -> T): T =
        runBlocking(Dispatchers.Main) { withTimeout(TIMEOUT_MS) { block() } }

    private suspend fun waitUntil(condition: () -> Boolean) {
        while (!condition()) delay(POLL_MS)
    }

    /** 8 kHz mono 16-bit PCM of silence. */
    private fun writeSilentWav(file: File, seconds: Int) {
        val rate = 8_000
        val dataSize = rate * 2 * seconds
        RandomAccessFile(file, "rw").use { out ->
            out.setLength(0)
            fun int(v: Int) = out.write(byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte()))
            fun short(v: Int) = out.write(byteArrayOf(v.toByte(), (v shr 8).toByte()))
            out.writeBytes("RIFF"); int(36 + dataSize); out.writeBytes("WAVE")
            out.writeBytes("fmt "); int(16); short(1); short(1); int(rate); int(rate * 2); short(2); short(16)
            out.writeBytes("data"); int(dataSize)
            out.write(ByteArray(dataSize))
        }
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val POLL_MS = 50L
        /** Longer than the service's save debounce. */
        const val SAVE_SETTLE_MS = 1_000L
    }
}
