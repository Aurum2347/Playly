package com.playly.player.ui.screens.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.data.artwork.artwork
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaCard
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyLogo
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.TrackTarget
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.NowPlayingAction
import com.playly.player.ui.player.rememberListOrigin

/**
 * Home (spec §5): "Recently played" shelf when there is history, then every track with count,
 * length, sort, play and shuffle. Local data only: no recommendations, no network.
 */
@Composable
fun HomeScreen(
    onOpenSearch: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenRecent: () -> Unit,
    viewModel: LibraryViewModel = viewModel(factory = LibraryViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val progress by viewModel.scanProgress.collectAsStateWithLifecycle()
    val tracks by viewModel.tracks.collectAsStateWithLifecycle()
    val recent by viewModel.recent.collectAsStateWithLifecycle()
    val sort by viewModel.sort.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    CollectMessages(viewModel.messages)
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = stringResource(R.string.app_name),
            leading = { PlaylyLogo() },
            actions = {
                NowPlayingAction()
                PlaylyIconButton(R.drawable.ic_search, stringResource(R.string.action_search), onOpenSearch)
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
            val shelf = recent
            // Wait for both, so a restored scroll position lands on the same rows.
            if (list == null || shelf == null) {
                LoadingState(stringResource(R.string.state_loading_library))
            } else {
                HomeContent(content, list, shelf, progress, sort, nowPlayingId, viewModel, onOpenRecent)
            }
        }
    }
}

@Composable
private fun HomeContent(
    content: LibraryContent.Tracks,
    tracks: List<TrackListItem>,
    recent: List<TrackListItem>,
    progress: ScanProgress?,
    sort: TrackSort?,
    nowPlayingId: Long?,
    viewModel: LibraryViewModel,
    onOpenRecent: () -> Unit,
) {
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)
    val launcher = LocalPlayerLauncher.current
    val scope = rememberCoroutineScope()
    val headerIndex = if (recent.isNotEmpty()) 2 else 0
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().then(origins.modifier),
        contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
    ) {
        if (recent.isNotEmpty()) {
            item(key = "recent-header", contentType = "shelfHeader") {
                ShelfHeader(stringResource(R.string.home_recent), onSeeAll = onOpenRecent)
            }
            item(key = "recent-shelf", contentType = "shelf") {
                RecentShelf(recent, nowPlayingId) { index, origin ->
                    viewModel.play(recent, index)
                    launcher.trackStarted(origin)
                }
            }
        }
        item(key = HEADER_KEY, contentType = "header") {
            TrackListHeader(
                content = content,
                progress = progress,
                sort = sort,
                onSort = { option ->
                    scope.revealHeader(listState, headerIndex)
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
                modifier = Modifier.padding(top = if (recent.isNotEmpty()) PlaylyTheme.spacing.lg else 0.dp),
            )
        }
        trackItems(tracks, nowPlayingId) { index, key ->
            viewModel.play(tracks, index)
            launcher.trackStarted(origins.of(key))
        }
    }
}

/** Section title with a "See all" link. */
@Composable
private fun ShelfHeader(title: String, onSeeAll: () -> Unit) {
    val description = stringResource(R.string.action_see_all_description)
    Row(
        Modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = PlaylyTheme.typography.sectionTitle,
            color = PlaylyTheme.colors.textPrimary,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        Box(
            Modifier
                .heightIn(min = PlaylyTheme.spacing.minTouch)
                .clip(PlaylyTheme.shapes.pill)
                .clickable(role = Role.Button, onClick = onSeeAll)
                .semantics(mergeDescendants = true) { contentDescription = description }
                .padding(horizontal = PlaylyTheme.spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.action_see_all), style = PlaylyTheme.typography.label, color = PlaylyTheme.colors.textSecondary)
        }
    }
}

/** Horizontal cards; a tap plays the shelf as the queue from that track. */
@Composable
private fun RecentShelf(recent: List<TrackListItem>, nowPlayingId: Long?, onPlay: (Int, Offset?) -> Unit) {
    val rowState = rememberLazyListState()
    val origins = rememberListOrigin(rowState, Orientation.Horizontal)
    val unknown = stringResource(R.string.unknown_artist)
    val actions = LocalTrackActions.current
    val menuLabel = stringResource(R.string.player_track_menu)
    LazyRow(
        state = rowState,
        modifier = Modifier.fillMaxWidth().then(origins.modifier),
        contentPadding = PaddingValues(horizontal = PlaylyTheme.spacing.md - 4.dp),
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xxs),
    ) {
        itemsIndexed(recent, key = { _, track -> track.id }, contentType = { _, _ -> "card" }) { index, track ->
            MediaCard(
                title = track.title,
                subtitle = track.artist?.takeIf { it.isNotBlank() } ?: unknown,
                artwork = track.artwork(),
                isActive = track.id == nowPlayingId,
                onClick = { onPlay(index, origins.of(track.id)) },
                onLongClick = actions?.let { a -> { a.open(TrackTarget(track.id, track.title, track.artist, track.artwork())) } },
                longClickLabel = menuLabel,
            )
        }
    }
}
