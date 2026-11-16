package com.playly.player.ui.screens.library

import android.util.Log
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
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
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.LibraryRepository
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.container
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.rememberListOrigin
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class RecentViewModel(library: LibraryRepository, private val playback: PlaybackController) : ViewModel() {
    /** Null until loaded. */
    val tracks: StateFlow<List<TrackListItem>?> = library.recentlyPlayed(LIMIT)
        .map<_, List<TrackListItem>?> { it }
        .catch { error ->
            Log.e("PlaylyLibrary", "Recently played failed", error)
            emit(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    fun play(tracks: List<TrackListItem>, index: Int) = playback.playTracks(tracks.map { it.id }, index, source = SOURCE)

    companion object {
        private const val LIMIT = 200
        private val SOURCE = PlaybackSource(PlaybackSource.Kind.Recent)
        val Factory = viewModelFactory { initializer { RecentViewModel(container.library, container.playback) } }
    }
}

/** "See all" from Home's shelf: recently played tracks, newest first. */
@Composable
fun RecentScreen(onBack: () -> Unit, viewModel: RecentViewModel = viewModel(factory = RecentViewModel.Factory)) {
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val launcher = LocalPlayerLauncher.current
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = stringResource(R.string.home_recent),
            onBack = onBack,
        )
        val list = tracks
        when {
            list == null -> LoadingState(stringResource(R.string.state_loading_library))
            list.isEmpty() -> EmptyState(
                icon = R.drawable.ic_music_note,
                title = stringResource(R.string.recent_empty_title),
                message = stringResource(R.string.recent_empty_message),
            )
            else -> {
                val listState = rememberLazyListState()
                val origins = rememberListOrigin(listState)
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().then(origins.modifier),
                    contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
                ) {
                    trackItems(list, nowPlayingId) { index, key ->
                        viewModel.play(list, index)
                        launcher.trackStarted(origins.of(key))
                    }
                }
            }
        }
    }
}
