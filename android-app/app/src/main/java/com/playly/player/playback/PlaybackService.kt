package com.playly.player.playback

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.ShuffleOrder.DefaultShuffleOrder
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import com.playly.player.MainActivity
import com.playly.player.PlaylyApplication
import com.playly.player.R
import com.playly.player.data.db.PlayHistoryDao
import com.playly.player.data.library.scan.ScanPlan
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.audio.PlaylyAudioProcessor
import com.playly.player.playback.audio.SoundParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The single audio engine. Owns the ExoPlayer and the media session; the app UI, the system
 * notification, the lock screen, headset buttons and Bluetooth all control it through the
 * session, so there is exactly one playback state.
 *
 * Media3 promotes the service to the foreground while audio plays and keeps the notification
 * while paused. An idle player (stopped, failed, or a restored queue nobody started) shows no
 * notification, so it never hangs around in an error state.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private lateinit var store: PlaybackStateStore
    internal lateinit var items: TrackMediaItems
        private set
    private lateinit var queue: QueueEditor

    private var saveJob: Job? = null
    private var periodicSaveJob: Job? = null
    /** False until the saved queue was offered to the player, so an empty start never overwrites it. */
    private var restoreSettled = false
    private var consecutiveErrors = 0
    private var source: PlaybackSource? = null
    private lateinit var history: PlayHistoryDao
    /** Track that became current and is not in the play history yet; written once it actually plays. */
    private var unrecordedTrackId: Long? = null
    /** Stage 8.1: the running sleep timer, null when off. Not saved: a new process starts without one. */
    private var sleepTimer: SleepTimer? = null
    private var sleepJob: Job? = null
    /** Stage 8.3: equaliser, mono and normalisation inside the audio sink. */
    private val soundProcessor = PlaylyAudioProcessor()

    override fun onCreate() {
        super.onCreate()
        val container = (application as PlaylyApplication).container
        store = container.playbackStore
        items = TrackMediaItems(container.database.trackDao())
        history = container.database.playHistoryDao()

        player = ExoPlayer.Builder(this, renderersFactory())
            // Audio focus: pause for calls and other players, duck for navigation prompts.
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true,
            )
            // Headphones unplugged / Bluetooth gone: pause instead of playing out loud.
            .setHandleAudioBecomingNoisy(true)
            // Local files only: keep the CPU (not Wi-Fi, not the screen) awake while playing.
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
        player.addListener(PlayerEvents())
        queue = QueueEditor(player)
        observeSound(container.settings)

        session = MediaSession.Builder(this, player)
            .setCallback(PlaybackSessionCallback(this, scope, store) { restoreSettled = true })
            .setSessionActivity(openPlayerIntent())
            .setBitmapLoader(CacheBitmapLoader(ArtworkBitmapLoader(this, scope)))
            .setMediaButtonPreferences(modeButtons())
            .build()

        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setChannelName(R.string.playback_channel_name)
                .build()
                .apply { setSmallIcon(R.drawable.ic_notification) },
        )
        setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
        restoreSavedQueue()
    }

    /** The app's sound chain runs first, before Media3's own silence skipping and speed change. */
    private fun renderersFactory() = object : DefaultRenderersFactory(this) {
        override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
            DefaultAudioSink.Builder(context)
                .setEnableFloatOutput(enableFloatOutput)
                .setEnableAudioOutputPlaybackParameters(enableAudioTrackPlaybackParams)
                .setAudioProcessors(arrayOf(soundProcessor))
                .build()
    }

    /** Sound settings apply live, also with the app closed: the service reads them itself. */
    private fun observeSound(settings: SettingsRepository) {
        scope.launch {
            settings.settings
                .map { soundParamsOf(it) to it.skipSilence }
                .distinctUntilChanged()
                .collect { (params, skipSilence) ->
                    soundProcessor.params = params
                    player.skipSilenceEnabled = skipSilence
                }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        saveNow()
        // Default: keep playing if audio is ongoing, otherwise pause and stop the service.
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        saveNow()
        session?.run {
            player.release()
            release()
        }
        session = null
        scope.cancel()
        super.onDestroy()
    }

    /**
     * A fresh queue from the app: starts at the beginning of [index] and keeps repeat. [shuffle]
     * null keeps the shuffle mode; true / false set it ("Shuffle" / "Play" buttons).
     */
    internal fun playQueue(queue: List<MediaItem>, index: Int, shuffle: Boolean? = null, source: PlaybackSource? = null) {
        consecutiveErrors = 0
        this.queue.reset()
        setSource(source)
        if (shuffle != null) player.shuffleModeEnabled = shuffle
        player.setMediaItems(queue, index, 0)
        shuffleFromCurrent()
        player.prepare()
        player.play()
    }

    /**
     * What the queue was started from. Published as session extras: every controller (the app's
     * player, a second window) reads the same value, and new controllers get it on connect.
     */
    internal fun setSource(value: PlaybackSource?) {
        source = value
        publishExtras()
    }

    /** Source, the user's queue and the sleep timer for every controller (session extras). */
    private fun publishExtras() {
        val extras = source?.toBundle() ?: Bundle()
        extras.putLongArray(PlaybackCommands.EXTRA_QUEUED_UIDS, queue.queuedUids().toLongArray())
        sleepTimer?.let { extras.putAll(it.toBundle()) }
        session?.setSessionExtras(extras)
    }

    internal fun applyModes(shuffle: Boolean, repeatMode: Int, speed: Float = player.playbackParameters.speed) {
        val keep = queue.queuedIndicesInPlayOrder()
        player.shuffleModeEnabled = shuffle
        player.repeatMode = repeatMode
        player.setPlaybackSpeed(PlaybackSpeed.snap(speed))
        shuffleFromCurrent(keep)
    }

    internal fun toggleShuffle() {
        if (player.shuffleModeEnabled) {
            queue.shuffleOff()
        } else {
            val keep = queue.queuedIndicesInPlayOrder()
            player.shuffleModeEnabled = true
            shuffleFromCurrent(keep)
        }
        publishExtras()
    }

    /**
     * With shuffle on, the current track comes first, then the user's own queue ([next], in
     * order), then every other track exactly once.
     */
    private fun shuffleFromCurrent(next: List<Int> = emptyList()) {
        val count = player.mediaItemCount
        if (!player.shuffleModeEnabled || count < 2) return
        player.setShuffleOrder(
            DefaultShuffleOrder(PlaybackPolicy.shuffledOrder(count, player.currentMediaItemIndex, next = next), System.nanoTime()),
        )
    }

    /** "Recently played": one entry each time a track starts playing (repeats of one track too). */
    private fun recordHistoryIfStarted() {
        val trackId = unrecordedTrackId ?: return
        if (!player.isPlaying) return
        unrecordedTrackId = null
        val now = System.currentTimeMillis()
        scope.launch(Dispatchers.IO) {
            try {
                history.record(trackId, now)
            } catch (e: Exception) {
                // The track row vanished meanwhile (foreign key) or the disk is full: history is optional.
                Log.w(TAG, "Cannot record play history", e)
            }
        }
    }

    /** Sleep timer command: [mode] is one of PlaybackCommands.SLEEP_*; "extend" with no timer starts one. */
    internal fun setSleepTimer(mode: String?, minutes: Int) {
        val now = SystemClock.elapsedRealtime()
        val running = sleepTimer as? SleepTimer.At
        val next: SleepTimer? = when (mode) {
            PlaybackCommands.SLEEP_MINUTES -> SleepTimerRules.start(now, minutes)
            PlaybackCommands.SLEEP_EXTEND ->
                if (running != null) SleepTimerRules.extend(running, now, minutes) else SleepTimerRules.start(now, minutes)
            PlaybackCommands.SLEEP_END_OF_TRACK -> SleepTimer.EndOfTrack
            else -> null
        }
        applySleepTimer(next)
    }

    private fun applySleepTimer(timer: SleepTimer?) {
        sleepJob?.cancel()
        sleepJob = null
        sleepTimer = timer
        // A cancelled or changed timer never leaves the audio faded.
        player.volume = 1f
        player.pauseAtEndOfMediaItems = timer == SleepTimer.EndOfTrack
        if (timer is SleepTimer.At) sleepJob = scope.launch { runSleepTimer(timer) }
        publishExtras()
    }

    /**
     * Waits for the deadline on the elapsed-time clock, fades the volume out over the last
     * seconds, then pauses. While audio plays the player's wake lock keeps this on time.
     */
    private suspend fun runSleepTimer(timer: SleepTimer.At) {
        val fade = SleepTimerRules.fadeMs(timer.totalMs)
        delay((timer.remainingMs(SystemClock.elapsedRealtime()) - fade).coerceAtLeast(0))
        while (true) {
            val remaining = timer.remainingMs(SystemClock.elapsedRealtime())
            if (remaining <= 0) break
            player.volume = SleepTimerRules.volumeAt(remaining, fade)
            delay(minOf(FADE_STEP_MS, remaining))
        }
        sleepJob = null
        player.pause()
        applySleepTimer(null)
    }

    internal fun cycleRepeat() {
        player.repeatMode = PlaybackPolicy.nextRepeatMode(player.repeatMode)
    }

    /**
     * "Play next" / "Add to queue". With nothing queued, [items] become the queue and start;
     * after a finished queue, playback continues with them. True when playback started.
     */
    internal fun addToQueue(items: List<MediaItem>, next: Boolean): Boolean {
        if (items.isEmpty()) return false
        if (player.mediaItemCount == 0) {
            playQueue(items, 0)
            return true
        }
        val ended = player.playbackState == Player.STATE_ENDED
        queue.insert(items, next)
        publishExtras()
        if (ended) {
            player.seekToNextMediaItem()
            player.prepare()
            player.play()
        }
        return ended
    }

    internal fun moveInQueue(uid: Long, afterUid: Long, toQueue: Boolean) {
        queue.move(uid, afterUid, toQueue)
        publishExtras()
    }

    internal fun removeFromQueue(uids: Set<Long>) {
        queue.remove(uids)
        publishExtras()
    }

    /** Rows of deleted files go, the current one included. */
    internal fun forgetTracks(trackIds: Set<Long>) {
        if (trackIds.isEmpty()) return
        queue.removeTracks(trackIds)
        publishExtras()
    }

    /** Rows of re-tagged tracks get the new tags; each keeps its queue uid, so nothing else moves. */
    internal fun refreshTracks(trackIds: Set<Long>) {
        if (trackIds.isEmpty()) return
        scope.launch {
            val fresh = items.resolveById(trackIds)
            for (index in 0 until player.mediaItemCount) {
                val old = player.getMediaItemAt(index)
                val track = TrackMediaItems.trackId(old)?.let(fresh::get) ?: continue
                // Same URI: ExoPlayer swaps the item without re-preparing what plays.
                player.replaceMediaItem(index, TrackMediaItems.toMediaItem(track, TrackMediaItems.uid(old)))
            }
        }
    }

    internal fun clearUpcoming() {
        queue.clearUpcoming()
        publishExtras()
    }

    /** Shuffle and repeat in the notification / system media controls, showing their state. */
    private fun modeButtons(): List<CommandButton> {
        val shuffleOn = player.shuffleModeEnabled
        val shuffle = CommandButton.Builder(if (shuffleOn) CommandButton.ICON_SHUFFLE_ON else CommandButton.ICON_SHUFFLE_OFF)
            .setDisplayName(getString(if (shuffleOn) R.string.playback_shuffle_on else R.string.playback_shuffle_off))
            .setSessionCommand(PlaybackCommands.TOGGLE_SHUFFLE)
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build()
        val (icon, label) = when (player.repeatMode) {
            Player.REPEAT_MODE_ALL -> CommandButton.ICON_REPEAT_ALL to R.string.playback_repeat_all
            Player.REPEAT_MODE_ONE -> CommandButton.ICON_REPEAT_ONE to R.string.playback_repeat_one
            else -> CommandButton.ICON_REPEAT_OFF to R.string.playback_repeat_off
        }
        val repeat = CommandButton.Builder(icon)
            .setDisplayName(getString(label))
            .setSessionCommand(PlaybackCommands.CYCLE_REPEAT)
            .setSlots(CommandButton.SLOT_OVERFLOW)
            .build()
        return listOf(shuffle, repeat)
    }

    private fun openPlayerIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java)
            .setAction(PlaybackCommands.ACTION_OPEN_PLAYER)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * Puts the last queue back without preparing it: no audio focus, no notification, nothing
     * plays until the user presses play (then Media3 prepares it). Skipped if a controller set
     * a new queue first.
     */
    private fun restoreSavedQueue() {
        scope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { store.read() } ?: return@launch
                val restored = PlaybackSessionCallback.resolveSaved(items, saved) ?: return@launch
                if (player.mediaItemCount > 0) return@launch
                player.setMediaItems(restored.mediaItems, restored.startIndex, restored.startPositionMs)
                val restoredIds = restored.mediaItems.map { TrackMediaItems.trackId(it) ?: -1L }
                queue.restore(PlaybackPolicy.survivingIndices(saved.trackIds, restoredIds, saved.queuedIndices))
                applyModes(saved.shuffle, saved.repeatMode, saved.speed)
                setSource(saved.source)
            } finally {
                restoreSettled = true
            }
        }
    }

    private fun snapshot(): SavedPlayback? {
        val count = player.mediaItemCount
        if (count == 0) return null
        val ids = ArrayList<Long>(count)
        var index = player.currentMediaItemIndex
        val queuedAt = queue.queuedIndices().toHashSet()
        val queuedOut = ArrayList<Int>()
        for (i in 0 until count) {
            val id = TrackMediaItems.trackId(player.getMediaItemAt(i))
            if (id != null) {
                if (i in queuedAt) queuedOut += ids.size
                ids += id
            } else if (i < index) {
                index--
            }
        }
        if (ids.isEmpty()) return null
        val ended = player.playbackState == Player.STATE_ENDED
        return SavedPlayback(
            trackIds = ids,
            index = index.coerceIn(0, ids.lastIndex),
            // A finished queue resumes from the start of its last track, not its very end.
            positionMs = if (ended) 0 else player.currentPosition.coerceAtLeast(0),
            shuffle = player.shuffleModeEnabled,
            repeatMode = player.repeatMode,
            sourceKind = source?.kind?.name,
            sourceLabel = source?.label,
            queuedIndices = queuedOut,
            speed = player.playbackParameters.speed,
        )
    }

    /** Coalesces bursts of events into one write; the snapshot itself is taken on the main thread. */
    private fun scheduleSave() {
        if (!restoreSettled && player.mediaItemCount == 0) return
        val snapshot = snapshot()
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(SAVE_DEBOUNCE_MS)
            withContext(Dispatchers.IO) { store.write(snapshot) }
        }
    }

    private fun saveNow() {
        if (!::player.isInitialized || (!restoreSettled && player.mediaItemCount == 0)) return
        saveJob?.cancel()
        store.write(snapshot())
    }

    private fun onPlaybackError(error: PlaybackException) {
        val item = player.currentMediaItem
        val kind = PlaybackPolicy.errorKind(error.errorCode)
        consecutiveErrors++
        val skip = PlaybackPolicy.shouldSkipAfterError(consecutiveErrors, player.mediaItemCount, player.hasNextMediaItem())
        Log.w(TAG, "Cannot play track ${item?.mediaId} (${error.errorCodeName}), skip=$skip", error)
        session?.broadcastCustomCommand(
            SessionCommand(PlaybackCommands.EVENT_ERROR, Bundle.EMPTY),
            Bundle().apply {
                putString(PlaybackCommands.ARG_KIND, kind.name)
                putString(PlaybackCommands.ARG_TITLE, item?.mediaMetadata?.title?.toString())
                item?.let(TrackMediaItems::trackId)?.let { putLong(PlaybackCommands.ARG_TRACK_ID, it) }
                putBoolean(PlaybackCommands.ARG_SKIPPED, skip)
            },
        )
        if (kind == PlaybackErrorKind.Missing || kind == PlaybackErrorKind.NoAccess) {
            // Let the library flag the file (or the revoked folder) so lists stop offering it.
            (application as PlaylyApplication).container.scanner.request(ScanPlan.FULL)
        }
        if (skip) {
            player.seekToNextMediaItem()
            player.prepare()
        } else {
            // Nothing playable left: settle in a clean paused state, the notification goes away.
            consecutiveErrors = 0
            player.pause()
            player.stop()
        }
    }

    private inner class PlayerEvents : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(
                    Player.EVENT_TIMELINE_CHANGED,
                    Player.EVENT_MEDIA_ITEM_TRANSITION,
                    Player.EVENT_POSITION_DISCONTINUITY,
                    Player.EVENT_IS_PLAYING_CHANGED,
                    Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                    Player.EVENT_REPEAT_MODE_CHANGED,
                    Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
                )
            ) {
                scheduleSave()
            }
            // A queued track started, or rows went around it: keep the user's queue exact.
            if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION) && queue.normalize()) {
                publishExtras()
            }
            if (events.containsAny(Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_IS_PLAYING_CHANGED)) {
                recordHistoryIfStarted()
            }
            if (events.containsAny(Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED, Player.EVENT_REPEAT_MODE_CHANGED)) {
                session?.setMediaButtonPreferences(modeButtons())
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            unrecordedTrackId = mediaItem?.let(TrackMediaItems::trackId)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY) consecutiveErrors = 0
            // The queue ran out before the track-end timer fired: nothing left to wait for.
            if (playbackState == Player.STATE_ENDED && sleepTimer == SleepTimer.EndOfTrack) applySleepTimer(null)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            // "End of track" did its job: the player paused itself at the end of the item.
            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM && sleepTimer == SleepTimer.EndOfTrack) {
                applySleepTimer(null)
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            // Audio resumed: re-arm the timer on the real clock (the wait may have slept with the
            // CPU while paused). One that ran out meanwhile is just dropped, not applied now.
            val timer = sleepTimer
            if (isPlaying && timer is SleepTimer.At && sleepJob != null) {
                applySleepTimer(timer.takeIf { it.remainingMs(SystemClock.elapsedRealtime()) > 0 })
            }
            periodicSaveJob?.cancel()
            // While audio plays, refresh the saved position now and then, so even a process the
            // system kills resumes close to where it was. Stops the moment playback stops.
            if (isPlaying) {
                periodicSaveJob = scope.launch {
                    while (isActive) {
                        delay(PERIODIC_SAVE_MS)
                        scheduleSave()
                    }
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) = onPlaybackError(error)
    }

    private companion object {
        const val TAG = "PlaylyPlayback"
        const val SAVE_DEBOUNCE_MS = 400L
        const val PERIODIC_SAVE_MS = 20_000L
        /** Volume steps of the sleep-timer fade: smooth to the ear, ~100 updates over 10 s. */
        const val FADE_STEP_MS = 100L
    }
}

/** What the sound chain plays with, from the app settings (the equaliser only when on). */
internal fun soundParamsOf(settings: AppSettings) = SoundParams(
    eqGains = if (settings.eqEnabled) settings.eqGains else null,
    mono = settings.monoAudio,
    normalize = settings.normalizeVolume,
)
