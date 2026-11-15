package com.playly.player.ui.screens.playlists

import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.toRoute
import com.playly.player.R
import com.playly.player.data.db.PLAYLIST_COVER_CANDIDATES
import com.playly.player.data.db.PlaylistSummary
import com.playly.player.data.db.PlaylistTrackRow
import com.playly.player.data.playlists.PlaylistCard
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.data.playlists.PlaylistRules
import com.playly.player.data.playlists.PlaylistSort
import com.playly.player.playback.PlaybackController
import com.playly.player.ui.UiMessage
import com.playly.player.ui.UiMessageBus
import com.playly.player.ui.container
import com.playly.player.ui.navigation.PlaylistRoute
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** A playlist page: its card (for the menu and dialogs), rows in the chosen order, the order. */
data class PlaylistPage(
    val card: PlaylistCard,
    val rows: List<PlaylistTrackRow>,
    val sort: PlaylistSort,
    val unavailable: Int,
)

sealed interface PlaylistPageState {
    data object Loading : PlaylistPageState
    /** Deleted (here or elsewhere) while the page was open. */
    data object Missing : PlaylistPageState
    data class Ready(val page: PlaylistPage) : PlaylistPageState
}

class PlaylistViewModel(
    val playlistId: Long,
    private val playlists: PlaylistRepository,
    private val playback: PlaybackController,
    private val bus: UiMessageBus,
) : ViewModel() {
    val state: StateFlow<PlaylistPageState> = combine(playlists.playlist(playlistId), playlists.tracks(playlistId)) { playlist, rows ->
        if (playlist == null) return@combine PlaylistPageState.Missing
        val sort = PlaylistSort.fromCode(playlist.sortOrder)
        val available = rows.filter { it.isAvailable }
        val summary = PlaylistSummary(playlist, rows.size, rows.sumOf { it.track.durationMs })
        val covers = PlaylistRules.coverArtworks(available.take(PLAYLIST_COVER_CANDIDATES).map { it.track })
        PlaylistPageState.Ready(PlaylistPage(PlaylistCard(summary, covers), PlaylistRules.sorted(rows, sort), sort, rows.size - available.size))
    }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlaylistPageState.Loading)

    val commands = PlaylistCommands(playlists, playback, viewModelScope, bus::send)

    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    /** A tap on a row: the playlist's playable tracks, as shown, from that row. */
    fun play(rows: List<PlaylistTrackRow>, row: PlaylistTrackRow, name: String) {
        if (!row.isAvailable) {
            viewModelScope.launch { bus.send(UiMessage(R.string.playback_nothing_playable)) }
            return
        }
        val playable = rows.filter { it.isAvailable }
        val index = playable.indexOfFirst { it.entryId == row.entryId }
        if (index < 0) return
        playback.playTracks(playable.map { it.track.id }, index, source = PlaylistCommands.source(name))
    }

    private var deletedHere = false

    /** Delete from this page: the page then closes without a "not found" note. */
    fun delete(name: String) {
        deletedHere = true
        commands.delete(playlistId, name)
    }

    /** The playlist vanished while open (deleted elsewhere, or a stale link). */
    fun onMissing() {
        if (!deletedHere) viewModelScope.launch { bus.send(UiMessage(R.string.playlist_not_found)) }
    }

    fun setSort(sort: PlaylistSort) {
        viewModelScope.launch { playlists.setSort(playlistId, sort) }
    }

    /** Drag and drop (or TalkBack "move up/down") in the user's own order. */
    fun move(entryId: Long, toIndex: Int) {
        viewModelScope.launch { playlists.move(playlistId, entryId, toIndex) }
    }

    companion object {
        val Factory = viewModelFactory {
            initializer {
                val route = createSavedStateHandle().toRoute<PlaylistRoute>()
                PlaylistViewModel(route.id, container.playlists, container.playback, container.messages)
            }
        }
    }
}
