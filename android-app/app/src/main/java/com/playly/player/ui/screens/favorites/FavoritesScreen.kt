package com.playly.player.ui.screens.favorites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.data.favorites.FavoriteSort
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.actions.SelectionTopBar
import com.playly.player.ui.actions.rememberTrackSelection
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.NowPlayingAction
import com.playly.player.ui.player.rememberListOrigin
import com.playly.player.ui.screens.library.SortButton
import com.playly.player.ui.screens.library.trackItems
import com.playly.player.ui.tracksSummaryLabel

/**
 * Favourites (stage 8.1): opened from the Playlists tab. "N tracks · length", play / shuffle,
 * order and selection; the track menu removes a track from here (with "Undo").
 */
@Composable
fun FavoritesScreen(onBack: () -> Unit, viewModel: FavoritesViewModel = viewModel(factory = FavoritesViewModel.Factory)) {
    val page by viewModel.page.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val launcher = LocalPlayerLauncher.current
    val selection = rememberTrackSelection()
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)
    val current = page

    Column(Modifier.fillMaxSize()) {
        if (current != null && selection.isActive) {
            SelectionTopBar(selection, current.tracks)
        } else {
            PlaylyTopBar(title = stringResource(R.string.favorites_title), onBack = onBack, actions = { NowPlayingAction() })
        }
        when {
            current == null -> LoadingState(stringResource(R.string.state_loading_library))
            current.tracks.isEmpty() -> EmptyState(
                icon = R.drawable.ic_favorite_border,
                title = stringResource(R.string.favorites_empty_title),
                message = stringResource(R.string.favorites_empty_message),
            )
            else -> LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().then(origins.modifier),
                contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
            ) {
                item(key = "header", contentType = "header") {
                    FavoritesHeader(
                        page = current,
                        onPlay = { shuffle ->
                            viewModel.playAll(current.tracks, shuffle)
                            launcher.trackStarted(origins.of("header"))
                        },
                        onSort = viewModel::setSort,
                        onSelect = selection::start,
                    )
                }
                trackItems(current.tracks, nowPlayingId, selection) { index, key ->
                    viewModel.play(current.tracks, index)
                    launcher.trackStarted(origins.of(key))
                }
            }
        }
    }
}

@Composable
private fun FavoritesHeader(page: FavoritesPage, onPlay: (shuffle: Boolean) -> Unit, onSort: (FavoriteSort) -> Unit, onSelect: () -> Unit) {
    val colors = PlaylyTheme.colors
    Column(Modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs, bottom = PlaylyTheme.spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                tracksSummaryLabel(page.tracks.size, page.totalDurationMs),
                style = PlaylyTheme.typography.subtitle,
                color = colors.textMuted,
                modifier = Modifier.weight(1f),
            )
            SortButton(FavoriteSort.entries, page.sort, { it.label }, onSort)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            PlaylyButton(stringResource(R.string.action_play_all), { onPlay(false) }, icon = R.drawable.ic_play)
            PlaylyButton(stringResource(R.string.action_shuffle_all), { onPlay(true) }, style = PlaylyButtonStyle.Secondary, icon = R.drawable.ic_shuffle)
            Spacer(Modifier.weight(1f))
            PlaylyIconButton(R.drawable.ic_select, stringResource(R.string.action_select), onSelect, tint = colors.textSecondary)
        }
    }
}

private val FavoriteSort.label: Int
    get() = when (this) {
        FavoriteSort.Added -> R.string.sort_favorite_added
        FavoriteSort.Title -> R.string.sort_title
        FavoriteSort.Artist -> R.string.sort_artist
        FavoriteSort.Album -> R.string.sort_album
        FavoriteSort.Duration -> R.string.sort_duration
    }
