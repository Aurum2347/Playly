package com.playly.player.playback

import android.os.Bundle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.ConnectionResult
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.withContext

/**
 * Session rules: what controllers may do and how their requests become playable items.
 * Runs on the main thread (the player's thread); database work hops to IO.
 */
@OptIn(UnstableApi::class)
internal class PlaybackSessionCallback(
    private val service: PlaybackService,
    private val scope: CoroutineScope,
    private val store: PlaybackStateStore,
    private val onResumptionUsed: () -> Unit,
) : MediaSession.Callback {

    /**
     * Media3's per-controller defaults (trusted apps, the notification, System UI) plus Playly's
     * commands. Note: the deprecated synchronous onConnect's default grants no commands at all.
     */
    override fun onConnectAsync(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): ListenableFuture<ConnectionResult> {
        val defaults = ConnectionResult.AcceptedResultBuilder(session, controller).build()
        val commands = defaults.availableSessionCommands.buildUpon()
            .add(PlaybackCommands.TOGGLE_SHUFFLE)
            .add(PlaybackCommands.CYCLE_REPEAT)
            .add(PlaybackCommands.PLAY_TRACKS)
            .build()
        return Futures.immediateFuture(
            ConnectionResult.AcceptedResultBuilder(session, controller)
                .setAvailableSessionCommands(commands)
                .build(),
        )
    }

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> {
        when (customCommand.customAction) {
            PlaybackCommands.PLAY_TRACKS.customAction -> return playTracks(session, args)
            PlaybackCommands.TOGGLE_SHUFFLE.customAction -> service.toggleShuffle()
            PlaybackCommands.CYCLE_REPEAT.customAction -> service.cycleRepeat()
            else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
        }
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    private fun playTracks(session: MediaSession, args: Bundle): ListenableFuture<SessionResult> = scope.future {
        val requested = args.getLongArray(PlaybackCommands.ARG_TRACK_IDS)?.toList().orEmpty()
        val startIndex = args.getInt(PlaybackCommands.ARG_START_INDEX, 0)
        val shuffle = if (args.containsKey(PlaybackCommands.ARG_SHUFFLE)) args.getBoolean(PlaybackCommands.ARG_SHUFFLE) else null
        val source = PlaybackSource.from(args.getBundle(PlaybackCommands.ARG_SOURCE))
        val resolved = service.items.resolve(requested)
        if (resolved.isEmpty()) {
            session.broadcastCustomCommand(SessionCommand(PlaybackCommands.EVENT_NOTHING_PLAYABLE, Bundle.EMPTY), Bundle.EMPTY)
            return@future SessionResult(SessionError.ERROR_BAD_VALUE)
        }
        val resolvedIds = resolved.map { TrackMediaItems.trackId(it) ?: INVALID_ID }
        val index = PlaybackPolicy.startIndexAfterResolve(requested, startIndex, resolvedIds) ?: 0
        service.playQueue(resolved, index, shuffle, source)
        SessionResult(SessionResult.RESULT_SUCCESS)
    }

    /** "Play next" / "add to queue": ids in, playable items out; gone files are dropped. */
    override fun onAddMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: List<MediaItem>,
    ): ListenableFuture<List<MediaItem>> = scope.future {
        service.items.resolve(mediaItems.mapNotNull(TrackMediaItems::trackId))
    }

    /**
     * A new queue. If the chosen track itself is gone, playback starts at its nearest surviving
     * neighbour from the start. If nothing survived, the request fails and the current queue keeps
     * playing; controllers are told why.
     */
    override fun onSetMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: List<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> = scope.future {
        val requested = mediaItems.map { TrackMediaItems.trackId(it) ?: INVALID_ID }
        val resolved = service.items.resolve(requested.filter { it != INVALID_ID })
        if (resolved.isEmpty()) {
            mediaSession.broadcastCustomCommand(SessionCommand(PlaybackCommands.EVENT_NOTHING_PLAYABLE, Bundle.EMPTY), Bundle.EMPTY)
            throw IOException("None of the requested tracks is playable")
        }
        // A queue from outside Playly's lists (another app, a system surface): no known source.
        service.setSource(null)
        if (startIndex == C.INDEX_UNSET) return@future MediaItemsWithStartPosition(resolved, C.INDEX_UNSET, C.TIME_UNSET)
        val resolvedIds = resolved.map { TrackMediaItems.trackId(it) ?: INVALID_ID }
        val index = PlaybackPolicy.startIndexAfterResolve(requested, startIndex, resolvedIds) ?: 0
        val sameTrack = requested.getOrNull(startIndex) == resolvedIds[index]
        MediaItemsWithStartPosition(resolved, index, if (sameTrack) startPositionMs else C.TIME_UNSET)
    }

    /**
     * Headset/Bluetooth "play" or the system resume card while Playly holds no queue (for
     * example after a reboot). [isForPlayback] false only asks what would play, for the card.
     */
    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        isForPlayback: Boolean,
    ): ListenableFuture<MediaItemsWithStartPosition> = scope.future {
        onResumptionUsed()
        val saved = withContext(Dispatchers.IO) { store.read() } ?: throw IOException("Nothing to resume")
        val restored = resolveSaved(service.items, saved) ?: throw IOException("Saved tracks are gone")
        if (isForPlayback) {
            service.applyModes(saved.shuffle, saved.repeatMode)
            service.setSource(saved.source)
            return@future restored
        }
        val item = restored.mediaItems[restored.startIndex]
        val artwork = ArtworkUri.parse(item.mediaMetadata.artworkUri)
        val bytes = artwork?.let { ArtworkBitmapLoader.loadBytes(service, it) }
        val metadata = item.mediaMetadata.buildUpon()
            .setArtworkUri(null)
            .setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
            .build()
        MediaItemsWithStartPosition(listOf(item.buildUpon().setMediaMetadata(metadata).build()), 0, restored.startPositionMs)
    }

    companion object {
        private const val INVALID_ID = -1L

        /** The saved queue as playable items, or null when none of its files is left. */
        suspend fun resolveSaved(items: TrackMediaItems, saved: SavedPlayback): MediaItemsWithStartPosition? {
            val resolved = items.resolve(saved.trackIds)
            val ids = resolved.map { TrackMediaItems.trackId(it) ?: INVALID_ID }
            val index = PlaybackPolicy.startIndexAfterResolve(saved.trackIds, saved.index, ids) ?: return null
            val sameTrack = saved.trackIds.getOrNull(saved.index) == ids[index]
            return MediaItemsWithStartPosition(resolved, index, if (sameTrack) saved.positionMs else 0)
        }
    }
}
