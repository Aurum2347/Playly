package com.playly.player.ui.screens.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.core.SearchText
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.browse.AlbumSort
import com.playly.player.data.library.browse.FolderNode
import com.playly.player.data.library.browse.GroupSort
import com.playly.player.data.library.browse.LibraryBrowser
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.data.library.browse.matching
import com.playly.player.data.library.browse.sortedFoldersFor
import com.playly.player.data.library.browse.sortedFor
import com.playly.player.data.library.sortedFor
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.ui.container
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Library sections (spec §6). Genres appear only when some track has a genre tag. */
enum class LibraryTab { Tracks, Albums, Artists, Folders, Genres }

/** What a tab lists after its filter, and how many there are without it. */
data class TabList<T>(val items: List<T>, val total: Int, val query: String)

/** The Folders tab: the music folder's content, or matching folders while filtering. */
data class FolderTab(val root: FolderNode?, val matches: List<FolderNode>?, val total: Int, val query: String)

/**
 * Tabs, filters and sorts of the Library screen. Each tab is computed off the main thread only
 * while it is on screen; the filter of every tab and the open tab survive process death.
 */
class BrowseViewModel(
    private val savedState: SavedStateHandle,
    browser: LibraryBrowser,
    private val settings: SettingsRepository,
) : ViewModel() {
    private val index = browser.index
    private val prefs: Flow<AppSettings> = settings.settings

    val tab: StateFlow<LibraryTab> = savedState.getStateFlow(KEY_TAB, LibraryTab.Tracks.name)
        .map { name -> LibraryTab.entries.firstOrNull { it.name == name } ?: LibraryTab.Tracks }
        .stateIn(viewModelScope, SharingStarted.Eagerly, LibraryTab.Tracks)

    fun selectTab(tab: LibraryTab) {
        savedState[KEY_TAB] = tab.name
    }

    fun query(tab: LibraryTab): StateFlow<String> = savedState.getStateFlow(KEY_QUERY + tab.name, "")

    fun setQuery(tab: LibraryTab, value: String) {
        savedState[KEY_QUERY + tab.name] = value
    }

    /** Null until settings load. */
    val sorts: StateFlow<AppSettings?> = prefs.map<_, AppSettings?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val hasGenres: StateFlow<Boolean> = index.map { it.genres.isNotEmpty() }.distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val tracks: StateFlow<TabList<TrackListItem>?> = combine(
        index,
        prefs.map { it.trackSort }.distinctUntilChanged(),
        query(LibraryTab.Tracks),
    ) { idx, sort, q -> TabList(idx.filterTracks(idx.tracks.sortedFor(sort), q), idx.tracks.size, q.trim()) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val albums: StateFlow<TabList<TrackGroup>?> = combine(
        index,
        prefs.map { it.albumSort }.distinctUntilChanged(),
        query(LibraryTab.Albums),
    ) { idx, sort, q -> TabList(idx.albums.sortedFor(sort).matching(q), idx.albums.size, q.trim()) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val artists: StateFlow<TabList<TrackGroup>?> = combine(
        index,
        prefs.map { it.artistSort }.distinctUntilChanged(),
        query(LibraryTab.Artists),
    ) { idx, sort, q -> TabList(idx.artists.sortedFor(sort).matching(q), idx.artists.size, q.trim()) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val genres: StateFlow<TabList<TrackGroup>?> = combine(
        index,
        prefs.map { it.genreSort }.distinctUntilChanged(),
        query(LibraryTab.Genres),
    ) { idx, sort, q -> TabList(idx.genres.sortedFor(sort).matching(q), idx.genres.size, q.trim()) }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val folders: StateFlow<FolderTab?> = combine(
        index,
        prefs.map { it.folderSort }.distinctUntilChanged(),
        query(LibraryTab.Folders),
    ) { idx, sort, q ->
        val all = idx.allFolders
        val root = idx.rootFolder?.let { it.copy(subfolders = it.subfolders.sortedFoldersFor(sort)) }
        val matches = q.trim().takeIf { it.isNotEmpty() }?.let { text ->
            val key = SearchText.normalize(text)
            all.filter { SearchText.normalize(it.name).contains(key) }.sortedFoldersFor(sort)
        }
        FolderTab(root, matches, all.size, q.trim())
    }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setTrackSort(sort: TrackSort) = save { settings.setTrackSort(sort) }
    fun setAlbumSort(sort: AlbumSort) = save { settings.setAlbumSort(sort) }
    fun setArtistSort(sort: GroupSort) = save { settings.setArtistSort(sort) }
    fun setGenreSort(sort: GroupSort) = save { settings.setGenreSort(sort) }
    fun setFolderSort(sort: GroupSort) = save { settings.setFolderSort(sort) }

    private fun save(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    companion object {
        private const val KEY_TAB = "library.tab"
        private const val KEY_QUERY = "library.query."
        val Factory = viewModelFactory {
            initializer { BrowseViewModel(createSavedStateHandle(), container.browser, container.settings) }
        }
    }
}
