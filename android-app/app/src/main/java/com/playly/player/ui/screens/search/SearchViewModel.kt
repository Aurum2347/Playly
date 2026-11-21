package com.playly.player.ui.screens.search

import com.playly.player.core.ErrorLog
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.core.SearchText
import com.playly.player.data.db.PlaylistSummary
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.library.browse.LibraryBrowser
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.data.library.browse.matching
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.container
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn

sealed interface SearchUiState {
    /** Empty query over a library that has tracks. */
    data object Idle : SearchUiState
    /** The library has nothing to search yet (no access, not scanned or empty). */
    data object LibraryNotReady : SearchUiState
    /** A scan is running, so results may be incomplete or missing. */
    data object Indexing : SearchUiState
    data class NoResults(val query: String) : SearchUiState
    data class Results(
        val tracks: List<TrackEntity>,
        val playlists: List<PlaylistSummary>,
        val albums: List<TrackGroup> = emptyList(),
        val artists: List<TrackGroup> = emptyList(),
    ) : SearchUiState {
        val isEmpty: Boolean get() = tracks.isEmpty() && playlists.isEmpty() && albums.isEmpty() && artists.isEmpty()
    }
    data object Error : SearchUiState
}

/** Local-only search: Unicode/Cyrillic aware, debounced, newest query wins. */
class SearchViewModel(
    private val library: LibraryRepository,
    private val playback: PlaybackController,
    private val browser: LibraryBrowser,
) : ViewModel() {
    var query by mutableStateOf("")
        private set

    fun onQueryChange(value: String) {
        query = value
    }

    /** Id of the current track, to mark its row. */
    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    /** Plays the found tracks as the queue (spec section 8: the result set is the context). */
    fun play(tracks: List<TrackEntity>, index: Int) =
        playback.playTracks(tracks.map { it.id }, index, source = PlaybackSource(PlaybackSource.Kind.Search, query.trim()))

    @OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
    val state: StateFlow<SearchUiState> = combine(
        snapshotFlow { query.trim() }
            .debounce { if (it.isEmpty()) 0L else DEBOUNCE_MS }
            .distinctUntilChanged(),
        library.snapshot.map { LibraryContent.from(it) }.distinctUntilChanged(),
        ::Pair,
    )
        .mapLatest { (text, content) -> resolve(text, content) }
        .catch { error ->
            ErrorLog.e("PlaylySearch", "Search failed", error)
            emit(SearchUiState.Error)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchUiState.Idle)

    private suspend fun resolve(text: String, content: LibraryContent): SearchUiState {
        if (text.isEmpty()) {
            return when (content) {
                is LibraryContent.Tracks -> SearchUiState.Idle
                LibraryContent.Scanning -> SearchUiState.Indexing
                else -> SearchUiState.LibraryNotReady
            }
        }
        val key = SearchText.normalize(text)
        val tracks = library.searchTracks(text)
        val playlists = library.playlistSummaries.first()
            .filter { SearchText.normalize(it.playlist.name).contains(key) }
        val index = browser.index.first()
        val results = SearchUiState.Results(
            tracks = tracks,
            playlists = playlists,
            albums = index.albums.matching(text).take(GROUP_LIMIT),
            artists = index.artists.matching(text).take(GROUP_LIMIT),
        )
        return when {
            !results.isEmpty -> results
            content == LibraryContent.Scanning -> SearchUiState.Indexing
            content !is LibraryContent.Tracks -> SearchUiState.LibraryNotReady
            else -> SearchUiState.NoResults(text)
        }
    }


    companion object {
        const val DEBOUNCE_MS = 250L
        private const val GROUP_LIMIT = 20
        val Factory = viewModelFactory { initializer { SearchViewModel(container.library, container.playback, container.browser) } }
    }
}
