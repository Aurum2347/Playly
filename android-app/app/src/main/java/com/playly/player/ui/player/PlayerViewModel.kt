package com.playly.player.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.favorites.FavoritesRepository
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackState
import com.playly.player.playback.QueueEntry
import com.playly.player.playback.QueueSnapshot
import com.playly.player.playback.SleepTimerRules
import com.playly.player.ui.UiMessage
import com.playly.player.ui.UiMessageBus
import com.playly.player.ui.container
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Whether there is a current track (shows the mini-player). Changes only with the track or play/pause. */
data class NowPlayingBadge(
    val trackId: Long,
    val title: String,
    val artist: String?,
    val artwork: Artwork?,
    val isPlaying: Boolean,
)

/**
 * The full-screen player and the mini-player read the same [PlaybackController]
 * state as the notification (spec §17): no second engine, no copy of the queue.
 */
class PlayerViewModel(
    private val playback: PlaybackController,
    private val library: LibraryRepository,
    settings: SettingsRepository,
    private val bus: UiMessageBus,
    private val favorites: FavoritesRepository,
) : ViewModel() {
    val state: StateFlow<PlaybackState> = playback.state

    val badge: StateFlow<NowPlayingBadge?> = playback.state
        .map { it.toBadge() }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.toBadge())

    /** The optional cover tint behind the player (Settings → Appearance). */
    val artworkTint: StateFlow<Boolean> = settings.settings
        .map { it.playerArtworkTint }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    /** Whether the current track is a favourite (the player's heart). */
    @OptIn(ExperimentalCoroutinesApi::class)
    val isFavorite: StateFlow<Boolean> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .flatMapLatest { id -> if (id == null) flowOf(false) else favorites.isFavorite(id) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    fun setFavorite(trackId: Long, favorite: Boolean) {
        viewModelScope.launch { favorites.set(trackId, favorite) }
    }

    fun setSpeed(speed: Float) = playback.setSpeed(speed)
    fun startSleepTimer(minutes: Int) = playback.startSleepTimer(minutes)
    fun extendSleepTimer() = playback.extendSleepTimer(SleepTimerRules.EXTEND_MINUTES)
    fun sleepAtEndOfTrack() = playback.sleepAtEndOfTrack()
    fun cancelSleepTimer() = playback.cancelSleepTimer()

    /** Built only while the queue sheet collects it. */
    val queue: Flow<QueueSnapshot> = playback.queue

    fun togglePlayPause() = playback.togglePlayPause()
    fun next() = playback.next()
    fun previous() = playback.previous()
    fun seekTo(positionMs: Long) = playback.seekTo(positionMs)
    fun toggleShuffle() = playback.toggleShuffle()
    fun cycleRepeat() = playback.cycleRepeat()
    fun playQueueEntry(entry: QueueEntry) = playback.playQueueEntry(entry)

    fun moveQueueItem(uid: Long, afterUid: Long, toQueue: Boolean) = playback.moveQueueItem(uid, afterUid, toQueue)

    fun removeFromQueue(uid: Long) = playback.removeFromQueue(listOf(uid))

    fun clearUpcoming() {
        playback.clearUpcoming()
        viewModelScope.launch { bus.send(UiMessage(R.string.queue_message_cleared)) }
    }

    /** After a failed track: prepare and play it again (the file may be back). */
    fun retry() = playback.play()

    /** Full tags and file facts for "File details" and "Share". */
    suspend fun track(id: Long): TrackEntity? = library.track(id)

    companion object {
        val Factory = viewModelFactory {
            initializer { PlayerViewModel(container.playback, container.library, container.settings, container.messages, container.favorites) }
        }
    }
}

private fun PlaybackState.toBadge(): NowPlayingBadge? = nowPlaying?.let {
    NowPlayingBadge(it.trackId, it.title, it.artist, it.artwork, isPlaying)
}
