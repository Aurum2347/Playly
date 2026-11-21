package com.playly.player.ui.screens.collections

import com.playly.player.core.ErrorLog
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.toRoute
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.browse.FolderNode
import com.playly.player.data.library.browse.LibraryBrowser
import com.playly.player.data.library.browse.LibraryIndex
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.actions.playbackKind
import com.playly.player.ui.container
import com.playly.player.ui.navigation.CollectionRoute
import kotlin.random.Random
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * An album, artist, genre or folder page. [rows] are the tracks listed on the page; [queue] is
 * what plays (a folder's own files first, then its subfolders'), so row i starts queue item i.
 */
data class CollectionPage(
    val kind: CollectionKind,
    val group: TrackGroup?,
    val folder: FolderNode?,
    val rows: List<TrackListItem>,
    val queue: List<TrackListItem>,
    val albums: List<TrackGroup> = emptyList(),
    val subfolders: List<FolderNode> = emptyList(),
) {
    val totalDurationMs: Long get() = folder?.totalDurationMs ?: group?.totalDurationMs ?: 0
}

sealed interface CollectionPageState {
    data object Loading : CollectionPageState
    /** The collection left the library (rescan, tags changed): the page closes. */
    data object Missing : CollectionPageState
    data class Ready(val page: CollectionPage) : CollectionPageState
}

class CollectionViewModel(
    savedState: SavedStateHandle,
    browser: LibraryBrowser,
    private val playback: PlaybackController,
) : ViewModel() {
    private val route = savedState.toRoute<CollectionRoute>()
    val kind: CollectionKind = CollectionKind.entries.firstOrNull { it.name == route.kind } ?: CollectionKind.Album

    val state: StateFlow<CollectionPageState> = browser.index
        .map { index -> page(index)?.let { CollectionPageState.Ready(it) } ?: CollectionPageState.Missing }
        .catch { error ->
            ErrorLog.e("PlaylyCollection", "Collection page failed", error)
            emit(CollectionPageState.Missing)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionPageState.Loading)

    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    private fun page(index: LibraryIndex): CollectionPage? {
        if (kind == CollectionKind.Folder) {
            val folder = index.folder(route.key) ?: return null
            if (folder.allTracks.isEmpty()) return null
            return CollectionPage(kind, null, folder, folder.tracks, folder.allTracks, subfolders = folder.subfolders)
        }
        val group = index.group(kind, route.key) ?: return null
        val albums = if (kind == CollectionKind.Artist) index.albumsOf(group) else emptyList()
        return CollectionPage(kind, group, null, group.tracks, group.tracks, albums = albums)
    }

    /** Row [index] of the page starts the collection's queue at that track. */
    fun play(page: CollectionPage, index: Int, title: String?) =
        playback.playTracks(page.queue.map { it.id }, index, source = source(title))

    fun playAll(page: CollectionPage, shuffle: Boolean, title: String?) {
        if (page.queue.isEmpty()) return
        val start = if (shuffle) Random.nextInt(page.queue.size) else 0
        playback.playTracks(page.queue.map { it.id }, start, shuffle = shuffle, source = source(title))
    }

    private fun source(title: String?) = PlaybackSource(kind.playbackKind, title)

    companion object {
        val Factory = viewModelFactory {
            initializer { CollectionViewModel(createSavedStateHandle(), container.browser, container.playback) }
        }
    }
}
