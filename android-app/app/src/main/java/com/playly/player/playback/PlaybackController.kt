package com.playly.player.playback

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.playly.player.data.artwork.Artwork
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

enum class RepeatMode { Off, All, One }

/** The current track as the UI shows it. [artwork] uses the same cache key as list rows. */
data class NowPlaying(
    val trackId: Long,
    val title: String,
    val artist: String?,
    val album: String?,
    val artwork: Artwork?,
)

/**
 * Position without polling: a snapshot plus the moment it was taken. A progress bar computes
 * the live value with [at] on its own frame clock, and only while it is visible.
 */
data class PlaybackPosition(
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val capturedAtElapsedMs: Long = 0,
    val advancing: Boolean = false,
    val speed: Float = 1f,
) {
    fun at(elapsedRealtimeMs: Long): Long {
        if (!advancing) return positionMs
        val live = positionMs + ((elapsedRealtimeMs - capturedAtElapsedMs) * speed).toLong()
        return if (durationMs > 0) live.coerceAtMost(durationMs) else live
    }
}

data class PlaybackState(
    val nowPlaying: NowPlaying? = null,
    /** Audio is coming out right now. */
    val isPlaying: Boolean = false,
    /** What the play/pause button should offer (Media3's rule: also true when ended or failed). */
    val showPlayButton: Boolean = true,
    val isBuffering: Boolean = false,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.Off,
    val hasPrevious: Boolean = false,
    val hasNext: Boolean = false,
    val queueIndex: Int = 0,
    val queueSize: Int = 0,
    val position: PlaybackPosition = PlaybackPosition(),
    /** What the queue was started from; null for queues from outside Playly's lists. */
    val source: PlaybackSource? = null,
    /**
     * Why the current track is not playing: it failed and nothing else could start (the service
     * stopped). Cleared as soon as the player tries again or moves to another track.
     */
    val issue: PlaybackErrorKind? = null,
    /** Stage 8.1: playback speed (pitch kept). */
    val speed: Float = 1f,
    /** Stage 8.1: the running sleep timer, null when off. */
    val sleepTimer: SleepTimer? = null,
)

/**
 * One queue row: [index] is the position in the player's list, used to jump there; [uid]
 * identifies the row for edits (the same track can be queued twice). [queued]: the user put it
 * in the queue ("Play next" / "Add to queue"), it is not just the source playing on.
 */
data class QueueEntry(
    val index: Int,
    val uid: Long,
    val trackId: Long,
    val title: String,
    val artist: String?,
    val artwork: Artwork?,
    val queued: Boolean = false,
)

/**
 * The queue in play order (shuffle applied): the current track and what follows it. The user's
 * own queue comes first in [upNext] ([queuedCount] rows), then the rest of the source.
 * [repeat] tells what happens after the last one.
 */
data class QueueSnapshot(
    val current: QueueEntry? = null,
    val upNext: List<QueueEntry> = emptyList(),
    val repeat: RepeatMode = RepeatMode.Off,
) {
    val queuedCount: Int get() = upNext.takeWhile { it.queued }.size
}

/** What "Play next" / "Add to queue" did. */
sealed interface QueueAddResult {
    /** [started]: nothing was playing, so the tracks started right away. */
    data class Added(val count: Int, val started: Boolean) : QueueAddResult
    /** None of the tracks can be played (gone or unavailable). */
    data object Unavailable : QueueAddResult
    /** The playback service could not be reached. */
    data object Failed : QueueAddResult
}

sealed interface PlaybackEvent {
    /** A track failed; [skipped] tells whether the next one started instead. */
    data class TrackFailed(val kind: PlaybackErrorKind, val title: String?, val skipped: Boolean) : PlaybackEvent

    /** The chosen tracks are gone (deleted, or their folder is unavailable). */
    data object NothingPlayable : PlaybackEvent
}

/**
 * The UI's single handle on playback. Connects one [MediaController] to [PlaybackService]
 * while the app is in the foreground and mirrors the session into [state]; the notification and
 * lock screen use the same session, so every surface shows the same thing.
 *
 * Main thread only (MediaController's rule); commands issued before the connection is ready wait
 * for it.
 */
@OptIn(UnstableApi::class)
class PlaybackController(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(PlaybackState())
    val state: StateFlow<PlaybackState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<PlaybackEvent>(extraBufferCapacity = 8)
    /** One-off problems to explain to the user. Dropped when no screen is listening. */
    val events: SharedFlow<PlaybackEvent> = _events.asSharedFlow()

    private var pending: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    /** The last track that failed to play (by id) and why; see [PlaybackState.issue]. */
    private var failure: Pair<Long, PlaybackErrorKind>? = null
    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(
                    Player.EVENT_TIMELINE_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                    Player.EVENT_REPEAT_MODE_CHANGED,
                )
            ) {
                queueChanges.value++
            }
            // Only a real change to "ready" ends a failure: the error event can arrive before the
            // session's own state update, so a stale "ready" must not clear it.
            if (events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) && player.playbackState == Player.STATE_READY) {
                failure = null
            }
            publish()
        }
    }

    /** Bumped whenever the order of the queue may have changed; [queue] rebuilds on it. */
    private val queueChanges = MutableStateFlow(0)

    /**
     * The queue in play order. Built on demand, only while someone collects it (the queue sheet),
     * so a long queue costs nothing while the sheet is closed.
     */
    val queue: Flow<QueueSnapshot> = queueChanges
        .map { buildQueue() }
        .distinctUntilChanged()
        .flowOn(Dispatchers.Main.immediate)

    /** Connect while any activity is started; release in the background (Media3 guidance). */
    fun start() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                connect()
            }

            override fun onStop(owner: LifecycleOwner) = disconnect()
        })
    }

    /**
     * Plays [trackIds] as the queue from [startIndex]. [shuffle] null keeps the shuffle mode and
     * resumes if that exact track of that exact list is already current; true / false set the mode
     * and always start over ("Shuffle" / "Play" buttons).
     */
    fun playTracks(trackIds: List<Long>, startIndex: Int, shuffle: Boolean? = null, source: PlaybackSource? = null) {
        if (trackIds.isEmpty() || startIndex !in trackIds.indices) return
        withController { c ->
            // Tapping the track that is already current in the same list resumes, not restarts.
            if (shuffle == null && isCurrentQueue(c, trackIds, startIndex)) {
                if (!c.isPlaying) Util.handlePlayButtonAction(c)
                return@withController
            }
            val args = Bundle().apply {
                putLongArray(PlaybackCommands.ARG_TRACK_IDS, trackIds.toLongArray())
                putInt(PlaybackCommands.ARG_START_INDEX, startIndex)
                if (shuffle != null) putBoolean(PlaybackCommands.ARG_SHUFFLE, shuffle)
                if (source != null) putBundle(PlaybackCommands.ARG_SOURCE, source.toBundle())
            }
            c.sendCustomCommand(PlaybackCommands.PLAY_TRACKS, args)
        }
    }

    fun togglePlayPause() = withController { Util.handlePlayPauseButtonAction(it) }

    fun play() = withController { Util.handlePlayButtonAction(it) }

    fun pause() = withController { Util.handlePauseButtonAction(it) }

    fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs.coerceAtLeast(0)) }

    fun next() = withController { it.seekToNext() }

    /** Restarts the track after the first seconds, otherwise goes to the previous one. */
    fun previous() = withController { it.seekToPrevious() }

    fun toggleShuffle() = withController { it.sendCustomCommand(PlaybackCommands.TOGGLE_SHUFFLE, Bundle.EMPTY) }

    fun cycleRepeat() = withController { it.sendCustomCommand(PlaybackCommands.CYCLE_REPEAT, Bundle.EMPTY) }

    /**
     * Jumps to a queue row and plays it. The row is matched by track id as well, so a tap on a
     * list that changed meanwhile never starts a different track.
     */
    fun playQueueEntry(entry: QueueEntry) = withController { c ->
        val count = c.mediaItemCount
        val index = entry.index.takeIf { it in 0 until count && TrackMediaItems.trackId(c.getMediaItemAt(it)) == entry.trackId }
            ?: (0 until count).firstOrNull { TrackMediaItems.trackId(c.getMediaItemAt(it)) == entry.trackId }
            ?: return@withController
        if (index != c.currentMediaItemIndex) c.seekToDefaultPosition(index)
        Util.handlePlayButtonAction(c)
    }

    /**
     * "Play next" ([next] true) or "Add to queue": the tracks join the user's queue without
     * interrupting what plays. With nothing playing they start right away.
     */
    suspend fun addToQueue(trackIds: List<Long>, next: Boolean): QueueAddResult {
        if (trackIds.isEmpty()) return QueueAddResult.Unavailable
        val c = connected() ?: return QueueAddResult.Failed
        val args = Bundle()
        args.putLongArray(PlaybackCommands.ARG_TRACK_IDS, trackIds.toLongArray())
        args.putBoolean(PlaybackCommands.ARG_NEXT, next)
        val result = try {
            c.sendCustomCommand(PlaybackCommands.QUEUE_ADD, args).await()
        } catch (e: ExecutionException) {
            Log.w(TAG, "Cannot add to the queue", e)
            return QueueAddResult.Failed
        }
        return when (result.resultCode) {
            SessionResult.RESULT_SUCCESS -> QueueAddResult.Added(
                result.extras.getInt(PlaybackCommands.ARG_ADDED),
                result.extras.getBoolean(PlaybackCommands.ARG_STARTED),
            )
            SessionError.ERROR_BAD_VALUE -> QueueAddResult.Unavailable
            else -> QueueAddResult.Failed
        }
    }

    /** Moves a queue row right after [afterUid] (0 = right after the current track). */
    fun moveQueueItem(uid: Long, afterUid: Long, toQueue: Boolean) = withController { c ->
        val args = Bundle()
        args.putLong(PlaybackCommands.ARG_UID, uid)
        args.putLong(PlaybackCommands.ARG_AFTER_UID, afterUid)
        args.putBoolean(PlaybackCommands.ARG_QUEUED, toQueue)
        c.sendCustomCommand(PlaybackCommands.QUEUE_MOVE, args)
    }

    /** Takes rows out of the queue; the current track is never removed this way. */
    fun removeFromQueue(uids: Collection<Long>) = withController { c ->
        if (uids.isEmpty()) return@withController
        val args = Bundle()
        args.putLongArray(PlaybackCommands.ARG_UIDS, uids.toLongArray())
        c.sendCustomCommand(PlaybackCommands.QUEUE_REMOVE, args)
    }

    /** Removes everything after the current track. */
    fun clearUpcoming() = withController { it.sendCustomCommand(PlaybackCommands.QUEUE_CLEAR_UPCOMING, Bundle.EMPTY) }

    /** The files of [trackIds] were deleted: their rows leave the queue, the current one too. */
    fun forgetTracks(trackIds: Collection<Long>) = trackCommand(PlaybackCommands.QUEUE_FORGET_TRACKS, trackIds)

    /** The tags of [trackIds] changed: the player shows the new ones without a restart. */
    fun refreshTracks(trackIds: Collection<Long>) = trackCommand(PlaybackCommands.QUEUE_REFRESH_TRACKS, trackIds)

    private fun trackCommand(command: SessionCommand, trackIds: Collection<Long>) {
        // Only when connected: with no session there is no queue to fix, the next one is built from the library.
        val c = controller?.takeIf { it.isConnected } ?: return
        if (trackIds.isEmpty()) return
        val args = Bundle()
        args.putLongArray(PlaybackCommands.ARG_TRACK_IDS, trackIds.toLongArray())
        c.sendCustomCommand(command, args)
    }

    /** Playback speed for every track, kept with the queue; snapped to [PlaybackSpeed.STEP]. */
    fun setSpeed(speed: Float) = withController { it.setPlaybackSpeed(PlaybackSpeed.snap(speed)) }

    /** Sleep timer: pause after [minutes]. */
    fun startSleepTimer(minutes: Int) = sleepTimer(PlaybackCommands.SLEEP_MINUTES, minutes)

    /** Adds [minutes] to the running timer. */
    fun extendSleepTimer(minutes: Int) = sleepTimer(PlaybackCommands.SLEEP_EXTEND, minutes)

    /** Sleep timer: pause when the playing track ends. */
    fun sleepAtEndOfTrack() = sleepTimer(PlaybackCommands.SLEEP_END_OF_TRACK, 0)

    fun cancelSleepTimer() = sleepTimer(PlaybackCommands.SLEEP_OFF, 0)

    private fun sleepTimer(mode: String, minutes: Int) = withController { c ->
        val args = Bundle()
        args.putString(PlaybackCommands.ARG_SLEEP_MODE, mode)
        args.putInt(PlaybackCommands.ARG_MINUTES, minutes)
        c.sendCustomCommand(PlaybackCommands.SLEEP_TIMER, args)
    }

    private suspend fun connected(): MediaController? {
        controller?.takeIf { it.isConnected }?.let { return it }
        return try {
            connect().await().takeIf { it.isConnected }
        } catch (e: ExecutionException) {
            Log.w(TAG, "Playback service unavailable", e)
            null
        }
    }

    private fun buildQueue(): QueueSnapshot {
        val c = controller ?: return QueueSnapshot()
        val timeline = c.currentTimeline
        if (timeline.isEmpty) return QueueSnapshot()
        val queuedUids = c.sessionExtras.getLongArray(PlaybackCommands.EXTRA_QUEUED_UIDS)?.toHashSet().orEmpty()
        val window = Timeline.Window()
        fun entryAt(index: Int): QueueEntry? {
            val item = timeline.getWindow(index, window).mediaItem
            val id = TrackMediaItems.trackId(item) ?: return null
            val metadata = item.mediaMetadata
            val uid = TrackMediaItems.uid(item)
            return QueueEntry(
                index = index,
                uid = uid,
                trackId = id,
                title = metadata.title?.toString().orEmpty(),
                artist = metadata.artist?.toString(),
                artwork = ArtworkUri.parse(metadata.artworkUri),
                queued = uid != 0L && uid in queuedUids,
            )
        }
        val shuffle = c.shuffleModeEnabled
        val current = c.currentMediaItemIndex.takeIf { it in 0 until timeline.windowCount } ?: return QueueSnapshot()
        val upNext = ArrayList<QueueEntry>()
        var next = timeline.getNextWindowIndex(current, Player.REPEAT_MODE_OFF, shuffle)
        // Bounded by the window count: a malformed order can never loop forever.
        while (next != C.INDEX_UNSET && upNext.size < timeline.windowCount) {
            entryAt(next)?.let(upNext::add)
            next = timeline.getNextWindowIndex(next, Player.REPEAT_MODE_OFF, shuffle)
        }
        return QueueSnapshot(current = entryAt(current), upNext = upNext, repeat = c.repeat())
    }

    private fun isCurrentQueue(c: MediaController, trackIds: List<Long>, startIndex: Int): Boolean {
        if (c.mediaItemCount != trackIds.size || c.currentMediaItemIndex != startIndex) return false
        if (c.playbackState == Player.STATE_IDLE || c.playbackState == Player.STATE_ENDED) return false
        for (i in trackIds.indices) {
            if (TrackMediaItems.trackId(c.getMediaItemAt(i)) != trackIds[i]) return false
        }
        return true
    }

    private fun withController(block: (MediaController) -> Unit) {
        controller?.takeIf { it.isConnected }?.let {
            block(it)
            return
        }
        val future = connect()
        scope.launch {
            val connected = try {
                future.await()
            } catch (e: CancellationException) {
                return@launch
            } catch (e: ExecutionException) {
                Log.w(TAG, "Playback service unavailable", e)
                return@launch
            }
            if (connected.isConnected) block(connected)
        }
    }

    private fun connect(): ListenableFuture<MediaController> {
        pending?.let { return it }
        val token = SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))
        val future = MediaController.Builder(appContext, token)
            .setListener(SessionEvents())
            .buildAsync()
        pending = future
        future.addListener({
            if (pending !== future) return@addListener
            val c = try {
                future.get()
            } catch (e: ExecutionException) {
                Log.w(TAG, "Cannot connect to playback", e)
                pending = null
                return@addListener
            } catch (e: CancellationException) {
                return@addListener
            }
            controller = c
            c.addListener(playerListener)
            queueChanges.value++
            publish()
        }, ContextCompat.getMainExecutor(appContext))
        return future
    }

    private fun disconnect() {
        val future = pending ?: return
        pending = null
        controller?.removeListener(playerListener)
        controller = null
        MediaController.releaseFuture(future)
    }

    private fun publish() {
        val c = controller ?: return
        val item = c.currentMediaItem
        val metadata = c.mediaMetadata
        val trackId = item?.let(TrackMediaItems::trackId)
        val duration = c.duration.takeIf { it != C.TIME_UNSET } ?: metadata.durationMs ?: 0
        // Shown only while the player sits idle on the failed track: a retry (buffering) hides it.
        val issue = failure?.takeIf { it.first == trackId && c.playbackState == Player.STATE_IDLE }?.second
        _state.value = PlaybackState(
            nowPlaying = trackId?.let {
                NowPlaying(
                    trackId = it,
                    title = metadata.title?.toString().orEmpty(),
                    artist = metadata.artist?.toString(),
                    album = metadata.albumTitle?.toString(),
                    artwork = ArtworkUri.parse(metadata.artworkUri),
                )
            },
            isPlaying = c.isPlaying,
            showPlayButton = Util.shouldShowPlayButton(c),
            isBuffering = c.playbackState == Player.STATE_BUFFERING,
            shuffle = c.shuffleModeEnabled,
            repeat = c.repeat(),
            hasPrevious = c.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS) && trackId != null,
            hasNext = c.hasNextMediaItem(),
            queueIndex = c.currentMediaItemIndex,
            queueSize = c.mediaItemCount,
            position = PlaybackPosition(
                positionMs = c.currentPosition.coerceAtLeast(0),
                durationMs = duration,
                capturedAtElapsedMs = SystemClock.elapsedRealtime(),
                advancing = c.isPlaying,
                speed = c.playbackParameters.speed,
            ),
            source = PlaybackSource.from(c.sessionExtras),
            issue = issue,
            speed = c.playbackParameters.speed,
            sleepTimer = SleepTimer.from(c.sessionExtras),
        )
    }

    private fun Player.repeat(): RepeatMode = when (repeatMode) {
        Player.REPEAT_MODE_ALL -> RepeatMode.All
        Player.REPEAT_MODE_ONE -> RepeatMode.One
        else -> RepeatMode.Off
    }

    private inner class SessionEvents : MediaController.Listener {
        override fun onCustomCommand(
            controller: MediaController,
            command: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (command.customAction) {
                PlaybackCommands.EVENT_ERROR -> {
                    val kind = args.getString(PlaybackCommands.ARG_KIND)
                        ?.let { name -> PlaybackErrorKind.entries.firstOrNull { it.name == name } }
                        ?: PlaybackErrorKind.Other
                    val skipped = args.getBoolean(PlaybackCommands.ARG_SKIPPED)
                    // Only a stop is a lasting state for the player screen; a skip is just news.
                    failure = if (!skipped && args.containsKey(PlaybackCommands.ARG_TRACK_ID)) {
                        args.getLong(PlaybackCommands.ARG_TRACK_ID) to kind
                    } else {
                        null
                    }
                    _events.tryEmit(PlaybackEvent.TrackFailed(kind, args.getString(PlaybackCommands.ARG_TITLE), skipped))
                    publish()
                }
                PlaybackCommands.EVENT_NOTHING_PLAYABLE -> _events.tryEmit(PlaybackEvent.NothingPlayable)
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        override fun onExtrasChanged(controller: MediaController, extras: Bundle) {
            // Extras carry the user's queue too: the queue sheet may need new section headers.
            queueChanges.value++
            publish()
        }

        override fun onDisconnected(controller: MediaController) {
            // The service went away (e.g. killed); reconnect on the next command or app start.
            if (this@PlaybackController.controller === controller) {
                this@PlaybackController.controller = null
                pending = null
                _state.value = _state.value.copy(isPlaying = false, showPlayButton = true, position = _state.value.position.copy(advancing = false))
            }
        }
    }

    private companion object {
        const val TAG = "PlaylyPlayback"
    }
}
