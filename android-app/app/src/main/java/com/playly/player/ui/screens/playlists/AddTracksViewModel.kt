package com.playly.player.ui.screens.playlists

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.toRoute
import com.playly.player.R
import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.ui.UiAction
import com.playly.player.ui.UiMessage
import com.playly.player.ui.UiMessageBus
import com.playly.player.ui.container
import com.playly.player.ui.navigation.AddTracksRoute
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One row of the picker: the track and whether the playlist already holds it. */
data class PickRow(val track: TrackListItem, val inPlaylist: Boolean)

data class AddTracksState(val playlistName: String, val rows: List<PickRow>?, val query: String)

/**
 * "Add tracks" to a playlist: the library with a search field and check boxes. Tracks already
 * in the playlist are marked and cannot be picked twice by accident; the selection survives
 * rotation and process death.
 */
@OptIn(FlowPreview::class)
class AddTracksViewModel(
    val playlistId: Long,
    private val handle: SavedStateHandle,
    private val library: LibraryRepository,
    private val playlists: PlaylistRepository,
    private val bus: UiMessageBus,
    /** "Undo" may be tapped after this screen has closed, so it runs outside the ViewModel. */
    private val appScope: CoroutineScope,
) : ViewModel() {
    val query: StateFlow<String> = handle.getStateFlow(KEY_QUERY, "")
    val selected: StateFlow<Set<Long>> = handle.getStateFlow<LongArray>(KEY_SELECTED, LongArray(0))
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    private val present = playlists.tracks(playlistId).map { rows -> rows.mapTo(HashSet()) { it.track.id } }
    private val name = playlists.playlist(playlistId).map { it?.name }

    /** Normalised once per library change, not on every keystroke. */
    private val indexed = library.trackList.map { list ->
        list.map { it to SearchText.normalize(listOfNotNull(it.title, it.artist, it.album).joinToString(" ")) }
    }.flowOn(Dispatchers.Default)

    val state: StateFlow<AddTracksState?> = combine(indexed, present, name, query.debounce(QUERY_DEBOUNCE_MS)) { all, inPlaylist, playlistName, q ->
        if (playlistName == null) return@combine null
        val needles = SearchText.normalize(q.trim()).split(' ').filter { it.isNotEmpty() }
        val rows = all.asSequence()
            .filter { (_, text) -> needles.all(text::contains) }
            .map { (track, _) -> PickRow(track, track.id in inPlaylist) }
            .toList()
        AddTracksState(playlistName, rows, q)
    }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AddTracksState("", null, ""))

    fun onQueryChange(value: String) {
        handle[KEY_QUERY] = value
    }

    fun toggle(trackId: Long) {
        val current = selected.value
        handle[KEY_SELECTED] = (if (trackId in current) current - trackId else current + trackId).toLongArray()
    }

    /**
     * Adds the picked tracks in library order (picks hidden by the current search count too);
     * the message follows on the shared snackbar.
     */
    fun confirm(playlistName: String, onDone: () -> Unit) {
        val picked = selected.value
        if (picked.isEmpty()) return
        viewModelScope.launch {
            val ids = library.trackList.first().map { it.id }.filter { it in picked }
            val result = playlists.add(playlistId, ids)
            val added = result.addedEntryIds.size
            val undo = UiAction(R.string.action_undo) { appScope.launch { playlists.undoAdd(result) } }
            bus.send(
                when {
                    added == 0 -> UiMessage(R.string.playlist_message_already, listOf(playlistName))
                    added == 1 -> UiMessage(R.string.playlist_message_added_one, listOf(playlistName), action = undo)
                    else -> UiMessage(R.plurals.playlist_message_added_many, listOf(added, playlistName), quantity = added, action = undo)
                },
            )
            onDone()
        }
    }

    companion object {
        private const val KEY_QUERY = "query"
        private const val KEY_SELECTED = "selected"
        private const val QUERY_DEBOUNCE_MS = 150L

        val Factory = viewModelFactory {
            initializer {
                val handle = createSavedStateHandle()
                val app = container
                AddTracksViewModel(handle.toRoute<AddTracksRoute>().playlistId, handle, app.library, app.playlists, app.messages, app.appScope)
            }
        }
    }
}
