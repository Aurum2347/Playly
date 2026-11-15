package com.playly.player.ui.screens.library

import android.net.Uri
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.AddSourceResult
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.sortedFor
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.UiMessage
import com.playly.player.ui.container
import com.playly.player.ui.toMessages
import kotlin.random.Random
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface LibraryUiState {
    data object Loading : LibraryUiState
    data object Error : LibraryUiState
    data class Ready(val content: LibraryContent, val sourceCount: Int) : LibraryUiState
}

/** Shared by Home, Library and onboarding: what the library holds and how to add a folder. */
class LibraryViewModel(
    private val library: LibraryRepository,
    private val playback: PlaybackController,
    private val settings: SettingsRepository,
) : ViewModel() {
    private val retryTick = MutableStateFlow(0)
    private val _messages = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = _messages.receiveAsFlow()
    private val sortSetting = settings.settings.map { it.trackSort }.distinctUntilChanged()

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<LibraryUiState> = retryTick
        .flatMapLatest {
            library.snapshot
                .map<_, LibraryUiState> { LibraryUiState.Ready(LibraryContent.from(it), it.sources.size) }
                .catch { error ->
                    Log.e(TAG, "Library state failed", error)
                    emit(LibraryUiState.Error)
                }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LibraryUiState.Loading)

    /** Only queried while a screen showing the list is visible. Null until the first load. */
    val tracks: StateFlow<List<TrackListItem>?> = combine(library.trackList, sortSetting) { list, sort -> list.sortedFor(sort) }
        .flowOn(Dispatchers.Default)
        .map<_, List<TrackListItem>?> { it }
        .catch { error ->
            Log.e(TAG, "Track list failed", error)
            emit(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Order of the "All tracks" list; null until settings load. */
    val sort: StateFlow<TrackSort?> = sortSetting
        .map<_, TrackSort?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Home's "Recently played" shelf. Null until the first load; empty when nothing was played. */
    val recent: StateFlow<List<TrackListItem>?> = library.recentlyPlayed(RECENT_ON_HOME)
        .map<_, List<TrackListItem>?> { it }
        .catch { error ->
            Log.e(TAG, "Recently played failed", error)
            emit(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val scanProgress: StateFlow<ScanProgress?> = library.scanProgress

    /** Id of the current track, to mark its row. */
    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    /** Plays [tracks] as the queue, starting at [index]: the list the user sees is the context. */
    fun play(tracks: List<TrackListItem>, index: Int) = playback.playTracks(tracks.map { it.id }, index, source = SOURCE)

    /** A file of the music folder's root: the whole folder plays from it (Folders section). */
    fun playFolder(queue: List<TrackListItem>, index: Int) =
        playback.playTracks(queue.map { it.id }, index, source = PlaybackSource(PlaybackSource.Kind.Folder))

    /** "Play": the whole list in order from the top. "Shuffle": all of it, from a random track. */
    fun playAll(tracks: List<TrackListItem>, shuffle: Boolean) {
        if (tracks.isEmpty()) return
        val start = if (shuffle) Random.nextInt(tracks.size) else 0
        playback.playTracks(tracks.map { it.id }, start, shuffle = shuffle, source = SOURCE)
    }

    fun setSort(sort: TrackSort) {
        viewModelScope.launch { settings.setTrackSort(sort) }
    }

    fun retry() = retryTick.update { it + 1 }

    /** User-requested rescan: reports what changed once it finishes. */
    fun rescan() {
        viewModelScope.launch {
            library.rescan().toMessages().forEach { _messages.send(it) }
        }
    }

    /** [onAdded] runs only when the folder is (or already was) a library source. */
    fun addSource(uri: Uri, onAdded: () -> Unit = {}) {
        viewModelScope.launch {
            val result = library.addSource(uri)
            _messages.send(
                when (result) {
                    is AddSourceResult.Added -> UiMessage(R.string.message_folder_added, result.name)
                    is AddSourceResult.AlreadyAdded -> UiMessage(R.string.message_folder_already_added, result.name)
                    AddSourceResult.AccessRefused -> UiMessage(R.string.message_folder_refused)
                },
            )
            if (result !is AddSourceResult.AccessRefused) onAdded()
        }
    }

    companion object {
        private const val TAG = "PlaylyLibrary"
        private const val RECENT_ON_HOME = 20
        private val SOURCE = PlaybackSource(PlaybackSource.Kind.AllTracks)
        val Factory = viewModelFactory {
            initializer { LibraryViewModel(container.library, container.playback, container.settings) }
        }
    }
}
