package com.playly.player.ui.screens.playlists

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.data.playlists.PlaylistCard
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.ui.UiMessageBus
import com.playly.player.ui.container
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

sealed interface PlaylistsUiState {
    data object Loading : PlaylistsUiState
    data object Error : PlaylistsUiState
    data class Ready(val playlists: List<PlaylistCard>) : PlaylistsUiState
}

/** The Playlists tab: every playlist with its cover, recently changed first. */
class PlaylistsViewModel(
    playlists: PlaylistRepository,
    playback: PlaybackController,
    bus: UiMessageBus,
) : ViewModel() {
    private val retryTick = MutableStateFlow(0)

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<PlaylistsUiState> = retryTick
        .flatMapLatest {
            playlists.cards
                .map<_, PlaylistsUiState> { PlaylistsUiState.Ready(it) }
                .catch { error ->
                    Log.e("PlaylyPlaylists", "Playlists failed", error)
                    emit(PlaylistsUiState.Error)
                }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaylistsUiState.Loading)

    val commands = PlaylistCommands(playlists, playback, viewModelScope, bus::send)

    fun retry() = retryTick.update { it + 1 }

    companion object {
        val Factory = viewModelFactory {
            initializer { PlaylistsViewModel(container.playlists, container.playback, container.messages) }
        }
    }
}
