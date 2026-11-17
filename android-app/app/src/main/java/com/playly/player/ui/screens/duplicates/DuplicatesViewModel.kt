package com.playly.player.ui.screens.duplicates

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.TrackFiles
import com.playly.player.data.library.duplicates.DuplicateFinder
import com.playly.player.data.library.duplicates.DuplicateGroup
import com.playly.player.data.library.duplicates.Duplicates
import com.playly.player.playback.PlaybackController
import com.playly.player.ui.UiMessageBus
import com.playly.player.ui.actions.TrackActionsViewModel
import com.playly.player.ui.container
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface DuplicatesState {
    /** [total]: files that need hashing (0 while the library is read). */
    data class Scanning(val done: Int, val total: Int) : DuplicatesState
    data class Found(val groups: List<DuplicateGroup>, val tracks: Map<Long, TrackEntity>) : DuplicatesState {
        val exactCount: Int get() = groups.count { it.kind == DuplicateGroup.Kind.Exact }
    }
    data object Failed : DuplicatesState
}

/**
 * Duplicates page (stage 8.4), as the desktop's Duplicates window: every visit searches anew,
 * nothing is deleted until the user picks the tracks and confirms. Deleted tracks drop out of
 * their groups; a group left with one track disappears.
 */
class DuplicatesViewModel(
    private val finder: DuplicateFinder,
    private val files: TrackFiles,
    private val playback: PlaybackController,
    private val messages: UiMessageBus,
) : ViewModel() {
    private val _state = MutableStateFlow<DuplicatesState>(DuplicatesState.Scanning(0, 0))
    val state: StateFlow<DuplicatesState> = _state.asStateFlow()

    private val _selected = MutableStateFlow<Set<Long>>(emptySet())
    val selected: StateFlow<Set<Long>> = _selected.asStateFlow()

    private val _deleting = MutableStateFlow(false)
    val deleting: StateFlow<Boolean> = _deleting.asStateFlow()

    private var scanning = false

    init {
        scan()
    }

    /** A new search (on open, and "Retry" after a failure). */
    fun scan() {
        if (scanning) return
        scanning = true
        _state.value = DuplicatesState.Scanning(0, 0)
        _selected.value = emptySet()
        viewModelScope.launch {
            _state.value = try {
                val scan = finder.scan { done, total -> _state.value = DuplicatesState.Scanning(done, total) }
                DuplicatesState.Found(scan.groups, scan.tracks)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Duplicate search failed", e)
                DuplicatesState.Failed
            } finally {
                scanning = false
            }
        }
    }

    fun toggle(id: Long) {
        if (_deleting.value) return
        _selected.update { if (id in it) it - id else it + id }
    }

    /** In every group all but the earliest added track. */
    fun selectExtras() {
        val found = _state.value as? DuplicatesState.Found ?: return
        if (_deleting.value) return
        _selected.value = Duplicates.extras(found.groups) { found.tracks[it]?.dateAdded ?: Long.MAX_VALUE }
    }

    /** Deletes the selected files for good (the user has confirmed). */
    fun deleteSelected() {
        val found = _state.value as? DuplicatesState.Found ?: return
        val ids = _selected.value.filter { it in found.tracks }
        if (ids.isEmpty() || _deleting.value) return
        _deleting.value = true
        viewModelScope.launch {
            try {
                val result = files.delete(ids)
                playback.forgetTracks(result.deleted)
                val gone = result.deleted.toHashSet()
                _state.value = found.copy(
                    groups = found.groups
                        .map { it.copy(ids = it.ids.filterNot(gone::contains)) }
                        .filter { it.ids.size > 1 },
                    tracks = found.tracks - gone,
                )
                _selected.update { it - gone }
                messages.send(TrackActionsViewModel.deleteMessage(result))
            } finally {
                _deleting.value = false
            }
        }
    }

    companion object {
        private const val TAG = "PlaylyDuplicates"
        val Factory = viewModelFactory {
            initializer { DuplicatesViewModel(container.duplicates, container.trackFiles, container.playback, container.messages) }
        }
    }
}
