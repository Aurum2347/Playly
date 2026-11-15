package com.playly.player.playback

import android.util.Log
import androidx.core.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** What is needed to continue where the user stopped: queue by track id, position and modes. */
@Serializable
data class SavedPlayback(
    val trackIds: List<Long>,
    val index: Int,
    val positionMs: Long,
    val shuffle: Boolean = false,
    /** Player.REPEAT_MODE_* */
    val repeatMode: Int = 0,
    /** [PlaybackSource.Kind] name; absent in files written before stage 5. */
    val sourceKind: String? = null,
    val sourceLabel: String? = null,
    /** Positions in [trackIds] of the user's own queue ("Play next" / "Add to queue"). Since stage 6. */
    val queuedIndices: List<Int> = emptyList(),
) {
    val source: PlaybackSource? get() = PlaybackSource.parse(sourceKind, sourceLabel)

    companion object {
        const val VERSION = 1
    }
}

@Serializable
private data class SavedFile(val version: Int, val playback: SavedPlayback?)

/**
 * One small JSON file written through [AtomicFile]: a crash or a kill mid-write leaves the
 * previous copy intact, never half a queue. Calls are serialised; the file holds track ids only
 * (a few bytes each), so even a 10 000-track queue stays well under 100 KB.
 */
class PlaybackStateStore(directory: File) {
    private val file = AtomicFile(File(directory, "playback_state.json"))
    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Any()

    fun read(): SavedPlayback? = synchronized(lock) {
        try {
            val text = file.openRead().use { it.readBytes().decodeToString() }
            json.decodeFromString(SavedFile.serializer(), text).takeIf { it.version == SavedPlayback.VERSION }?.playback
                ?.takeIf { it.trackIds.isNotEmpty() }
        } catch (_: FileNotFoundException) {
            null
        } catch (e: IOException) {
            Log.w(TAG, "Saved playback unreadable", e)
            null
        } catch (e: SerializationException) {
            Log.w(TAG, "Saved playback corrupt, starting fresh", e)
            null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Saved playback corrupt, starting fresh", e)
            null
        }
    }

    /** [playback] null forgets the queue (the user cleared it). */
    fun write(playback: SavedPlayback?) = synchronized(lock) {
        val bytes = json.encodeToString(SavedFile.serializer(), SavedFile(SavedPlayback.VERSION, playback)).encodeToByteArray()
        val stream = try {
            file.startWrite()
        } catch (e: IOException) {
            Log.w(TAG, "Cannot save playback state", e)
            return@synchronized
        }
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
            Log.w(TAG, "Cannot save playback state", e)
        }
    }

    private companion object {
        const val TAG = "PlaylyPlayback"
    }
}
