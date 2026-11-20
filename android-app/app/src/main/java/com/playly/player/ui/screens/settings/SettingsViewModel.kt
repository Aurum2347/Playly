package com.playly.player.ui.screens.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.SourceSummary
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.data.library.AddSourceResult
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.QueueEndAction
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.audio.Equalizer
import com.playly.player.ui.UiMessage
import com.playly.player.ui.container
import com.playly.player.ui.toMessages
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val reduceMotion: Boolean,
    val openPlayerOnPlay: Boolean,
    val playerArtworkTint: Boolean,
    val sources: List<SourceSummary>,
    val trackCount: Int,
    val unavailableCount: Int,
    val lastScanAt: Long?,
    val sound: SoundSettingsUi,
    /** Stage 9.1. */
    val minTrackSeconds: Int,
    val excludedFolders: List<String>,
    val playback: PlaybackSettingsUi,
)

/** Stage 9.1: the "Playback" section. */
data class PlaybackSettingsUi(
    val resumePosition: Boolean,
    val pauseOnNoisy: Boolean,
    val queueEnd: QueueEndAction,
)

/** Stage 8.3: the "Sound" section and the equaliser sheet. */
data class SoundSettingsUi(
    val eqEnabled: Boolean,
    val eqPreset: String,
    val eqGains: List<Float>,
    val mono: Boolean,
    val normalize: Boolean,
    val skipSilence: Boolean,
) {
    companion object {
        fun of(app: AppSettings) = SoundSettingsUi(
            app.eqEnabled, app.eqPreset, app.eqGains, app.monoAudio, app.normalizeVolume, app.skipSilence,
        )
    }
}

class SettingsViewModel(
    private val settings: SettingsRepository,
    private val library: LibraryRepository,
    private val playback: PlaybackController,
) : ViewModel() {
    private val _messages = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = _messages.receiveAsFlow()

    /** Null until the first values arrive, so the screen never shows wrong defaults. */
    val state: StateFlow<SettingsUiState?> = combine(
        settings.settings,
        library.snapshot,
        library.sourceSummaries,
        library.unavailableCount,
    ) { app, snapshot, sources, unavailable ->
        SettingsUiState(
            reduceMotion = app.reduceMotion,
            openPlayerOnPlay = app.openPlayerOnPlay,
            playerArtworkTint = app.playerArtworkTint,
            sources = sources,
            trackCount = snapshot.trackCount,
            unavailableCount = unavailable,
            lastScanAt = app.lastScanAt,
            sound = SoundSettingsUi.of(app),
            minTrackSeconds = app.minTrackSeconds,
            excludedFolders = app.excludedFolders.sortedWith(String.CASE_INSENSITIVE_ORDER),
            playback = PlaybackSettingsUi(app.resumePosition, app.pauseOnNoisy, app.queueEnd),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val scanProgress: StateFlow<ScanProgress?> = library.scanProgress

    fun rescan() {
        viewModelScope.launch { library.rescan().toMessages().forEach { _messages.send(it) } }
    }

    fun setReduceMotion(enabled: Boolean) {
        viewModelScope.launch { settings.setReduceMotion(enabled) }
    }

    fun setOpenPlayerOnPlay(enabled: Boolean) {
        viewModelScope.launch { settings.setOpenPlayerOnPlay(enabled) }
    }

    fun setPlayerArtworkTint(enabled: Boolean) {
        viewModelScope.launch { settings.setPlayerArtworkTint(enabled) }
    }

    fun setEqEnabled(enabled: Boolean) = update { settings.setEqEnabled(enabled) }

    /** Choosing a preset (or a band below) also turns the equaliser on: that is what the user wants to hear. */
    fun chooseEqPreset(id: String) = update {
        settings.setEqPreset(id)
        settings.setEqEnabled(true)
    }

    fun setEqBand(band: Int, gainDb: Float) = update {
        settings.setEqBand(band, gainDb)
        settings.setEqEnabled(true)
    }

    fun resetEq() = update { settings.setEqPreset(Equalizer.FLAT) }

    fun setMonoAudio(enabled: Boolean) = update { settings.setMonoAudio(enabled) }

    fun setNormalizeVolume(enabled: Boolean) = update { settings.setNormalizeVolume(enabled) }

    fun setSkipSilence(enabled: Boolean) = update { settings.setSkipSilence(enabled) }

    /** The library rescans by itself when the filter changes (LibraryScanner.start). */
    fun setMinTrackSeconds(seconds: Int) = update { settings.setMinTrackSeconds(seconds) }

    fun includeFolder(path: String) = update {
        settings.includeFolder(path)
        _messages.send(UiMessage(R.string.message_folder_shown, path.substringAfterLast('/')))
    }

    fun setResumePosition(enabled: Boolean) = update { settings.setResumePosition(enabled) }

    fun setPauseOnNoisy(enabled: Boolean) = update { settings.setPauseOnNoisy(enabled) }

    fun setQueueEnd(action: QueueEndAction) = update { settings.setQueueEnd(action) }

    /** Unavailable rows go from the library, playlists, favourites and the player's queue. */
    fun forgetUnavailable() = update {
        val ids = library.forgetUnavailable()
        playback.forgetTracks(ids)
        _messages.send(UiMessage(R.plurals.message_forgot_unavailable, listOf(ids.size), quantity = ids.size))
    }

    private fun update(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    fun addSource(uri: Uri) {
        viewModelScope.launch {
            _messages.send(
                when (val result = library.addSource(uri)) {
                    is AddSourceResult.Added -> UiMessage(R.string.message_folder_added, result.name)
                    is AddSourceResult.AlreadyAdded -> UiMessage(R.string.message_folder_already_added, result.name)
                    AddSourceResult.AccessRefused -> UiMessage(R.string.message_folder_refused)
                },
            )
        }
    }

    fun removeSource(source: LibrarySourceEntity) {
        viewModelScope.launch {
            library.removeSource(source.id)
            _messages.send(UiMessage(R.string.message_folder_removed, source.displayName))
        }
    }

    companion object {
        val Factory = viewModelFactory { initializer { SettingsViewModel(container.settings, container.library, container.playback) } }
    }
}
