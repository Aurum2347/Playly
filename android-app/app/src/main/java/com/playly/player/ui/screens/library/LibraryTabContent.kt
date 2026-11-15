package com.playly.player.ui.screens.library

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.artwork.artwork
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.browse.AlbumSort
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.browse.GroupSort
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaCard
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.screens.collections.FolderRow
import com.playly.player.ui.screens.collections.GroupRow
import com.playly.player.ui.screens.collections.albumSubtitle
import com.playly.player.ui.screens.collections.folderSubtitle
import com.playly.player.ui.screens.collections.groupTarget
import com.playly.player.ui.screens.collections.groupTitle

/** "12 albums", or "Found: 3 of 12" while a filter is on. */
@Composable
fun countLabel(plural: Int, shown: Int, total: Int, query: String): String =
    if (query.isEmpty()) pluralStringResource(plural, total, total) else stringResource(R.string.library_filter_found, shown, total)

@Composable
fun NoMatch(query: String) = EmptyState(
    icon = R.drawable.ic_search,
    title = stringResource(R.string.search_no_results_title),
    message = stringResource(R.string.library_filter_no_match, query),
)

/** Album covers in a grid that adapts to the width (two columns on a phone, more on a tablet). */
@Composable
fun AlbumsTab(list: TabList<TrackGroup>?, sort: AlbumSort?, state: LazyGridState, onSort: (AlbumSort) -> Unit, onOpen: (CollectionKind, String) -> Unit) {
    when {
        list == null -> LoadingState(stringResource(R.string.state_loading_library))
        list.total == 0 -> EmptyState(
            icon = R.drawable.ic_album,
            title = stringResource(R.string.library_albums_empty_title),
            message = stringResource(R.string.library_albums_empty_message),
        )
        list.items.isEmpty() -> NoMatch(list.query)
        else -> {
            val actions = LocalTrackActions.current
            val menuLabel = stringResource(R.string.collection_menu)
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                state = state,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = PlaylyTheme.spacing.page - 4.dp, end = PlaylyTheme.spacing.page - 4.dp, bottom = PlaylyTheme.spacing.md),
            ) {
                item(key = "header", span = { GridItemSpan(maxLineSpan) }, contentType = "header") {
                    TabHeader(countLabel(R.plurals.albums_count, list.items.size, list.total, list.query)) {
                        if (sort != null) SortButton(AlbumSort.entries, sort, { it.label }, onSort)
                    }
                }
                items(list.items, key = { it.key }, contentType = { "album" }) { album ->
                    val target = groupTarget(album)
                    BoxWithConstraints {
                        MediaCard(
                            title = groupTitle(album),
                            subtitle = albumSubtitle(album),
                            artwork = album.cover?.artwork(),
                            placeholderIcon = R.drawable.ic_album,
                            width = maxWidth - 8.dp,
                            onClick = { onOpen(CollectionKind.Album, album.key) },
                            onLongClick = actions?.let { a -> { a.openCollection(target) } },
                            longClickLabel = menuLabel,
                        )
                    }
                }
            }
        }
    }
}

/** Artists or genres: one row each with the number of tracks. */
@Composable
fun GroupsTab(
    tab: LibraryTab,
    list: TabList<TrackGroup>?,
    sort: GroupSort?,
    state: LazyListState,
    onSort: (GroupSort) -> Unit,
    onOpen: (CollectionKind, String) -> Unit,
) {
    when {
        list == null -> LoadingState(stringResource(R.string.state_loading_library))
        list.total == 0 && tab == LibraryTab.Genres -> EmptyState(
            icon = R.drawable.ic_genre,
            title = stringResource(R.string.library_genres_empty_title),
            message = stringResource(R.string.library_genres_empty_message),
        )
        list.items.isEmpty() -> NoMatch(list.query)
        else -> LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md)) {
            item(key = "header", contentType = "header") {
                val plural = if (tab == LibraryTab.Genres) R.plurals.genres_count else R.plurals.artists_count
                TabHeader(countLabel(plural, list.items.size, list.total, list.query)) {
                    if (sort != null) SortButton(GroupSort.entries, sort, { it.label }, onSort)
                }
            }
            items(list.items, key = { it.key }, contentType = { "group" }) { group -> GroupRow(group, onOpen) }
        }
    }
}

/**
 * The music folder: its subfolders, then its own files. While filtering, every matching folder
 * of the tree with its path. Tapping a file plays the whole folder from that file.
 */
@Composable
fun FoldersTab(
    folders: FolderTab?,
    sort: GroupSort?,
    state: LazyListState,
    nowPlayingId: Long?,
    onSort: (GroupSort) -> Unit,
    onOpen: (CollectionKind, String) -> Unit,
    onPlay: (List<TrackListItem>, Int, Any) -> Unit,
) {
    val root = folders?.root
    val matches = folders?.matches
    when {
        folders == null -> LoadingState(stringResource(R.string.state_loading_library))
        matches != null && matches.isEmpty() -> NoMatch(folders.query)
        else -> LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md)) {
            item(key = "header", contentType = "header") {
                val shown = matches?.size ?: root?.subfolders?.size ?: 0
                val title = if (matches != null) {
                    countLabel(R.plurals.folders_count, shown, folders.total, folders.query)
                } else {
                    root?.let { folderSubtitle(it) }.orEmpty()
                }
                TabHeader(title) {
                    if (sort != null) SortButton(GroupSort.entries, sort, { it.label }, onSort)
                }
            }
            if (matches != null) {
                items(matches, key = { "f:" + it.path }, contentType = { "folder" }) { node -> FolderRow(node, onOpen, subtitle = node.path) }
            } else if (root != null) {
                items(root.subfolders, key = { "f:" + it.path }, contentType = { "folder" }) { node -> FolderRow(node, onOpen) }
                trackItems(root.tracks, nowPlayingId) { index, key -> onPlay(root.allTracks, index, key) }
            }
        }
    }
}

val AlbumSort.label: Int
    get() = when (this) {
        AlbumSort.Title -> R.string.sort_title
        AlbumSort.Artist -> R.string.sort_artist
        AlbumSort.Year -> R.string.sort_year
        AlbumSort.DateAdded -> R.string.sort_recently_added
    }

val GroupSort.label: Int
    get() = when (this) {
        GroupSort.Name -> R.string.sort_name
        GroupSort.TrackCount -> R.string.sort_track_count
    }
