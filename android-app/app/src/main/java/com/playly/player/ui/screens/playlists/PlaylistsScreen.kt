package com.playly.player.ui.screens.playlists

import android.util.Log
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.db.PlaylistSummary
import com.playly.player.data.library.LibraryRepository
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.ErrorState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.container
import com.playly.player.ui.player.NowPlayingAction
import com.playly.player.ui.tracksSummaryLabel
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
    data class Ready(val playlists: List<PlaylistSummary>) : PlaylistsUiState
}

class PlaylistsViewModel(library: LibraryRepository) : ViewModel() {
    private val retryTick = MutableStateFlow(0)

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<PlaylistsUiState> = retryTick
        .flatMapLatest {
            library.playlistSummaries
                .map<_, PlaylistsUiState> { PlaylistsUiState.Ready(it) }
                .catch { error ->
                    Log.e("PlaylyPlaylists", "Playlists failed", error)
                    emit(PlaylistsUiState.Error)
                }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaylistsUiState.Loading)

    fun retry() = retryTick.update { it + 1 }

    companion object {
        val Factory = viewModelFactory { initializer { PlaylistsViewModel(container.library) } }
    }
}

/** Read-only list for now; creating and editing playlists is stage 6. */
@Composable
fun PlaylistsScreen(viewModel: PlaylistsViewModel = viewModel(factory = PlaylistsViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val motion = PlaylyTheme.motion
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(title = stringResource(R.string.nav_playlists), actions = { NowPlayingAction() })
        AnimatedContent(
            targetState = state,
            contentKey = { it::class },
            transitionSpec = { fadeIn(motion.standard()) togetherWith fadeOut(motion.exit()) },
            label = "playlistsState",
        ) { current ->
            when (current) {
                PlaylistsUiState.Loading -> LoadingState(stringResource(R.string.state_loading_playlists))
                PlaylistsUiState.Error -> ErrorState(
                    title = stringResource(R.string.state_error_title),
                    message = stringResource(R.string.state_error_playlists),
                    onRetry = viewModel::retry,
                )
                is PlaylistsUiState.Ready -> if (current.playlists.isEmpty()) {
                    EmptyState(
                        icon = R.drawable.ic_playlists,
                        title = stringResource(R.string.state_no_playlists_title),
                        message = stringResource(R.string.state_no_playlists_message),
                    )
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(current.playlists, key = { it.playlist.id }) { item ->
                            MediaRow(
                                title = item.playlist.name,
                                subtitle = tracksSummaryLabel(item.trackCount, item.totalDurationMs),
                                placeholderIcon = R.drawable.ic_playlists,
                            )
                        }
                    }
                }
            }
        }
    }
}
