package com.playly.player.ui.screens.library

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTextField
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.actions.SelectionTopBar
import com.playly.player.ui.actions.TrackSelection
import com.playly.player.ui.actions.rememberTrackSelection
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.rememberListOrigin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Library tab (spec §6): Tracks / Albums / Artists / Folders / Genres, each with a count, a sort,
 * a filter and its own empty state. Every section keeps its scroll position while the user
 * switches sections, opens a page or rotates; tracks can be selected in bulk.
 */
@Composable
fun LibraryScreen(
    onOpenSettings: () -> Unit,
    onOpenCollection: (CollectionKind, String) -> Unit,
    onOpenDuplicates: () -> Unit,
    viewModel: LibraryViewModel = viewModel(factory = LibraryViewModel.Factory),
    browse: BrowseViewModel = viewModel(factory = BrowseViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val tab by browse.tab.collectAsStateWithLifecycle()
    val hasGenres by browse.hasGenres.collectAsStateWithLifecycle()
    val selection = rememberTrackSelection()
    val tabs = if (hasGenres) LibraryTab.entries else LibraryTab.entries - LibraryTab.Genres
    // A section that disappeared (the last genre tag removed) falls back to Tracks.
    val current = if (tab in tabs) tab else LibraryTab.Tracks
    LaunchedEffect(current) { if (current != LibraryTab.Tracks) selection.close() }
    CollectMessages(viewModel.messages)
    val tracks = if (current == LibraryTab.Tracks) browse.tracks.collectAsStateWithLifecycle().value else null

    Column(Modifier.fillMaxSize().imePadding()) {
        if (selection.isActive && tracks != null) {
            SelectionTopBar(selection, tracks.items)
        } else {
            PlaylyTopBar(
                title = stringResource(R.string.nav_library),
                actions = {
                    if ((state as? LibraryUiState.Ready)?.content is LibraryContent.Tracks) {
                        PlaylyIconButton(R.drawable.ic_duplicates, stringResource(R.string.action_find_duplicates), onOpenDuplicates)
                    }
                    PlaylyIconButton(R.drawable.ic_refresh, stringResource(R.string.action_rescan), viewModel::rescan)
                    PlaylyIconButton(R.drawable.ic_settings, stringResource(R.string.action_settings), onOpenSettings)
                },
            )
        }
        LibraryStateContent(
            state = state,
            onRetry = viewModel::retry,
            onRescan = viewModel::rescan,
            onFolderPicked = { viewModel.addSource(it) },
        ) { content ->
            LibrarySections(content, tabs, current, tracks, selection, viewModel, browse, onOpenCollection)
        }
    }
}

@Composable
private fun LibrarySections(
    content: LibraryContent.Tracks,
    tabs: List<LibraryTab>,
    current: LibraryTab,
    tracks: TabList<TrackListItem>?,
    selection: TrackSelection,
    viewModel: LibraryViewModel,
    browse: BrowseViewModel,
    onOpenCollection: (CollectionKind, String) -> Unit,
) {
    val progress by viewModel.scanProgress.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val sorts by browse.sorts.collectAsStateWithLifecycle()
    val query by browse.query(current).collectAsStateWithLifecycle()
    // One remembered position per section, so switching sections never loses the place.
    val tracksState = rememberLazyListState()
    val albumsState = rememberLazyGridState()
    val artistsState = rememberLazyListState()
    val foldersState = rememberLazyListState()
    val genresState = rememberLazyListState()
    val launcher = LocalPlayerLauncher.current
    Column(Modifier.fillMaxSize()) {
        if (!selection.isActive) LibraryTabRow(tabs, current, browse::selectTab)
        PlaylyTextField(
            value = query,
            onValueChange = { browse.setQuery(current, it) },
            label = stringResource(current.filterHint),
            leadingIcon = R.drawable.ic_search,
            onClear = { browse.setQuery(current, "") },
            modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs),
        )
        Box(Modifier.weight(1f)) {
            when (current) {
                LibraryTab.Tracks -> if (tracks == null) {
                    LoadingState(stringResource(R.string.state_loading_library))
                } else if (tracks.items.isEmpty() && tracks.query.isNotEmpty()) {
                    NoMatch(tracks.query)
                } else {
                    AllTracksList(content, tracks, progress, sorts?.trackSort, nowPlayingId, selection, tracksState, viewModel, browse)
                }
                LibraryTab.Albums -> AlbumsTab(
                    browse.albums.collectAsStateWithLifecycle().value, sorts?.albumSort, albumsState, browse::setAlbumSort, onOpenCollection,
                )
                LibraryTab.Artists -> GroupsTab(
                    current, browse.artists.collectAsStateWithLifecycle().value, sorts?.artistSort, artistsState, browse::setArtistSort, onOpenCollection,
                )
                LibraryTab.Genres -> GroupsTab(
                    current, browse.genres.collectAsStateWithLifecycle().value, sorts?.genreSort, genresState, browse::setGenreSort, onOpenCollection,
                )
                LibraryTab.Folders -> {
                    val origins = rememberListOrigin(foldersState)
                    Box(origins.modifier) {
                        FoldersTab(
                            browse.folders.collectAsStateWithLifecycle().value, sorts?.folderSort, foldersState, nowPlayingId,
                            browse::setFolderSort, onOpenCollection,
                        ) { queue, index, key ->
                            viewModel.playFolder(queue, index)
                            launcher.trackStarted(origins.of(key))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Header plus every (matching) track. The list state is remembered through the navigation back
 * stack, so the position survives tab switches, the player and rotation.
 */
@Composable
private fun AllTracksList(
    content: LibraryContent.Tracks,
    tracks: TabList<TrackListItem>,
    progress: ScanProgress?,
    sort: TrackSort?,
    nowPlayingId: Long?,
    selection: TrackSelection,
    listState: LazyListState,
    viewModel: LibraryViewModel,
    browse: BrowseViewModel,
) {
    val list = tracks.items
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
                summary = if (tracks.query.isEmpty()) null else stringResource(R.string.library_filter_found, list.size, tracks.total),
                onSort = { option ->
                    scope.revealHeader(listState, headerIndex = 0)
                    browse.setTrackSort(option)
                },
                onPlayAll = {
                    viewModel.playAll(list, shuffle = false)
                    launcher.trackStarted(origins.of(HEADER_KEY))
                },
                onShuffleAll = {
                    viewModel.playAll(list, shuffle = true)
                    launcher.trackStarted(origins.of(HEADER_KEY))
                },
                onSelect = if (selection.isActive) null else selection::start,
            )
        }
        trackItems(list, nowPlayingId, selection) { index, key ->
            viewModel.play(list, index)
            launcher.trackStarted(origins.of(key))
        }
    }
}

/** A new sort starts at the top of the list (the header stays where the user can see it). */
internal fun CoroutineScope.revealHeader(listState: LazyListState, headerIndex: Int) {
    if (listState.firstVisibleItemIndex > headerIndex) launch { listState.scrollToItem(headerIndex) }
}

internal const val HEADER_KEY = "tracks-header"
