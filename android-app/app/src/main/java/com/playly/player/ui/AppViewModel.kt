package com.playly.player.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.R
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackErrorKind
import com.playly.player.playback.PlaybackEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Root state: whether onboarding is done and global appearance flags. Null until settings load. */
class AppViewModel(
    private val settings: SettingsRepository,
    playback: PlaybackController,
) : ViewModel() {
    val appSettings: StateFlow<AppSettings?> = settings.settings
        .map<AppSettings, AppSettings?> { it }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Playback problems for the shared snackbar, whichever screen is open. */
    val playbackMessages: Flow<UiMessage> = playback.events.map { it.toMessage() }

    private val _openLibraryOnce = MutableStateFlow(false)
    /** After onboarding picks the music folder, the first screen is the library (spec §4). */
    val openLibraryOnce: StateFlow<Boolean> = _openLibraryOnce.asStateFlow()

    fun completeOnboarding(openLibrary: Boolean) {
        _openLibraryOnce.value = openLibrary
        viewModelScope.launch { settings.setOnboardingCompleted() }
    }

    fun consumeOpenLibrary() {
        _openLibraryOnce.value = false
    }

    private val _openPlayerRequest = MutableStateFlow(false)
    /** The notification was tapped: show the full-screen player (spec §9). */
    val openPlayerRequest: StateFlow<Boolean> = _openPlayerRequest.asStateFlow()

    fun requestOpenPlayer() {
        _openPlayerRequest.value = true
    }

    fun consumeOpenPlayer() {
        _openPlayerRequest.value = false
    }

    companion object {
        val Factory = viewModelFactory { initializer { AppViewModel(container.settings, container.playback) } }
    }
}

private fun PlaybackEvent.toMessage(): UiMessage = when (this) {
    PlaybackEvent.NothingPlayable -> UiMessage(R.string.playback_nothing_playable)
    is PlaybackEvent.TrackFailed -> {
        val reason = when (kind) {
            PlaybackErrorKind.Missing -> R.string.playback_error_missing
            PlaybackErrorKind.NoAccess -> R.string.playback_error_no_access
            PlaybackErrorKind.Unsupported -> R.string.playback_error_unsupported
            PlaybackErrorKind.Damaged -> R.string.playback_error_damaged
            PlaybackErrorKind.Other -> R.string.playback_error_other
        }
        val name: Any = title?.takeIf { it.isNotBlank() } ?: UiMessage(R.string.playback_unknown_track)
        UiMessage(
            if (skipped) R.string.playback_error_skipped else R.string.playback_error_stopped,
            listOf(UiMessage(reason, listOf(name))),
        )
    }
}
