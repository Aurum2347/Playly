package com.playly.player.ui.screens.favorites

import com.playly.player.core.ErrorLog
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.favorites.FavoriteSort
import com.playly.player.data.favorites.FavoritesRepository
import com.playly.player.data.favorites.sortedFor
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.container
import kotlin.random.Random
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The Favourites page in the chosen order. */
data class FavoritesPage(val tracks: List<TrackListItem>, val sort: FavoriteSort) {
    val totalDurationMs: Long get() = tracks.sumOf { it.durationMs }
}

/** Favourites page (stage 8.1): sortable, plays as its own source. */
class FavoritesViewModel(
    favorites: FavoritesRepository,
    private val settings: SettingsRepository,
    private val playback: PlaybackController,
) : ViewModel() {
    /** Null until loaded. */
    val page: StateFlow<FavoritesPage?> = combine(
        favorites.tracks,
        settings.settings.map { it.favoriteSort }.distinctUntilChanged(),
    ) { rows, sort -> FavoritesPage(rows.sortedFor(sort).map { it.track }, sort) }
        .catch { error ->
            ErrorLog.e("PlaylyFavorites", "Favourites failed", error)
            emit(FavoritesPage(emptyList(), FavoriteSort.Added))
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val nowPlayingId: StateFlow<Long?> = playback.state
        .map { it.nowPlaying?.trackId }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), playback.state.value.nowPlaying?.trackId)

    fun play(tracks: List<TrackListItem>, index: Int) = playback.playTracks(tracks.map { it.id }, index, source = SOURCE)

    fun playAll(tracks: List<TrackListItem>, shuffle: Boolean) {
        if (tracks.isEmpty()) return
        val start = if (shuffle) Random.nextInt(tracks.size) else 0
        playback.playTracks(tracks.map { it.id }, start, shuffle = shuffle, source = SOURCE)
    }

    fun setSort(sort: FavoriteSort) {
        viewModelScope.launch { settings.setFavoriteSort(sort) }
    }

    companion object {
        private val SOURCE = PlaybackSource(PlaybackSource.Kind.Favorites)
        val Factory = viewModelFactory {
            initializer { FavoritesViewModel(container.favorites, container.settings, container.playback) }
        }
    }
}
