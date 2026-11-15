package com.playly.player.ui.screens.library

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.NowPlayingAction
import com.playly.player.ui.player.rememberListOrigin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Library tab. Until stage 7 adds albums / artists / folders / genres it is the full track list. */
@Composable
fun LibraryScreen(
    onOpenSettings: () -> Unit,
    viewModel: LibraryViewModel = viewModel(factory = LibraryViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val progress by viewModel.scanProgress.collectAsStateWithLifecycle()
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val sort by viewModel.sort.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    CollectMessages(viewModel.messages)
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = stringResource(R.string.nav_library),
            actions = {
                NowPlayingAction()
                PlaylyIconButton(R.drawable.ic_refresh, stringResource(R.string.action_rescan), viewModel::rescan)
                PlaylyIconButton(R.drawable.ic_settings, stringResource(R.string.action_settings), onOpenSettings)
            },
        )
        LibraryStateContent(
            state = state,
            onRetry = viewModel::retry,
            onRescan = viewModel::rescan,
            onFolderPicked = { viewModel.addSource(it) },
        ) { content ->
            val list = tracks
            if (list == null) {
                LoadingState(stringResource(R.string.state_loading_library))
            } else {
                AllTracksList(content, list, progress, sort, nowPlayingId, viewModel)
            }
        }
    }
}

/**
 * Header plus every track. The list state is remembered through the navigation back stack, so
 * the position survives tab switches, the player and rotation.
 */
@Composable
private fun AllTracksList(
    content: LibraryContent.Tracks,
    tracks: List<TrackListItem>,
    progress: ScanProgress?,
    sort: TrackSort?,
    nowPlayingId: Long?,
    viewModel: LibraryViewModel,
) {
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)
    val launcher = LocalPlayerLauncher.current
    val scope = rememberCoroutineScope()
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().then(origins.modifier),
        contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
    ) {
        item(key = HEADER_KEY, contentType = "header") {
            TrackListHeader(
                content = content,
                progress = progress,
                sort = sort,
                onSort = { option ->
                    scope.revealHeader(listState, headerIndex = 0)
                    viewModel.setSort(option)
                },
                onPlayAll = {
                    viewModel.playAll(tracks, shuffle = false)
                    launcher.trackStarted(origins.of(HEADER_KEY))
                },
                onShuffleAll = {
                    viewModel.playAll(tracks, shuffle = true)
                    launcher.trackStarted(origins.of(HEADER_KEY))
                },
            )
        }
        trackItems(tracks, nowPlayingId) { index, key ->
            viewModel.play(tracks, index)
            launcher.trackStarted(origins.of(key))
        }
    }
}

/** A new sort starts at the top of the list (the header stays where the user can see it). */
internal fun CoroutineScope.revealHeader(listState: LazyListState, headerIndex: Int) {
    if (listState.firstVisibleItemIndex > headerIndex) launch { listState.scrollToItem(headerIndex) }
}

internal const val HEADER_KEY = "tracks-header"
