package com.playly.player.ui.screens.collections

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.data.artwork.artwork
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaCard
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.designsystem.components.SectionHeader
import com.playly.player.ui.UiMessage
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.SelectionTopBar
import com.playly.player.ui.actions.rememberTrackSelection
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.rememberListOrigin
import com.playly.player.ui.screens.library.trackItems

/**
 * Album, artist, genre or folder page (spec §6): header with play / shuffle, the "⋮" menu
 * (queue, playlist), an artist's albums or a folder's subfolders, then the tracks.
 * Closes itself if the collection leaves the library.
 */
@Composable
fun CollectionScreen(
    onBack: () -> Unit,
    onOpenCollection: (CollectionKind, String) -> Unit,
    viewModel: CollectionViewModel = viewModel(factory = CollectionViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val actions = LocalTrackActions.current
    val launcher = LocalPlayerLauncher.current
    val selection = rememberTrackSelection()
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)

    LaunchedEffect(state) {
        if (state is CollectionPageState.Missing) {
            actions?.notify(UiMessage(R.string.collection_missing))
            onBack()
        }
    }
    val page = (state as? CollectionPageState.Ready)?.page
    val title = page?.let { p -> p.folder?.name ?: p.group?.let { groupTitle(it) } }.orEmpty()
    val target = page?.let { p -> p.folder?.let { folderTarget(it) } ?: p.group?.let { groupTarget(it) } }
    // The player and its source label get the real name; "Unknown artist" has none.
    val sourceTitle = page?.let { p -> p.folder?.name ?: p.group?.name }

    Column(Modifier.fillMaxSize()) {
        if (page != null && selection.isActive) {
            SelectionTopBar(selection, page.rows)
        } else {
            PlaylyTopBar(
                title = title,
                onBack = onBack,
                actions = {
                    if (target != null && actions != null) {
                        PlaylyIconButton(R.drawable.ic_more_vert, stringResource(R.string.collection_menu), { actions.openCollection(target) })
                    }
                },
            )
        }
        if (page == null) {
            LoadingState(stringResource(R.string.state_loading_library))
            return@Column
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().then(origins.modifier),
            contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md),
        ) {
            item(key = "header", contentType = "header") {
                val subtitle = when (page.kind) {
                    CollectionKind.Album -> page.group?.let { albumSubtitle(it) }
                    CollectionKind.Folder -> page.folder?.path
                    else -> null
                }
                CollectionHeader(
                    page = page,
                    title = title,
                    subtitle = subtitle,
                    onPlay = { shuffle ->
                        viewModel.playAll(page, shuffle, sourceTitle)
                        launcher.trackStarted(origins.of("header"))
                    },
                    onSelect = if (page.rows.isNotEmpty()) selection::start else null,
                )
            }
            if (page.albums.isNotEmpty()) {
                item(key = "albums-header", contentType = "section") { SectionHeader(stringResource(R.string.collection_section_albums)) }
                item(key = "albums", contentType = "shelf") {
                    LazyRow(contentPadding = PaddingValues(horizontal = PlaylyTheme.spacing.page - 4.dp)) {
                        items(page.albums, key = { it.key }) { album ->
                            val albumTarget = groupTarget(album)
                            MediaCard(
                                title = groupTitle(album),
                                subtitle = album.year?.toString(),
                                artwork = album.cover?.artwork(),
                                placeholderIcon = R.drawable.ic_album,
                                onClick = { onOpenCollection(CollectionKind.Album, album.key) },
                                onLongClick = actions?.let { a -> { a.openCollection(albumTarget) } },
                                longClickLabel = stringResource(R.string.collection_menu),
                            )
                        }
                    }
                }
            }
            if (page.subfolders.isNotEmpty()) {
                item(key = "folders-header", contentType = "section") { SectionHeader(stringResource(R.string.collection_section_folders)) }
                items(page.subfolders, key = { "f:" + it.path }, contentType = { "folder" }) { folder ->
                    FolderRow(folder, onOpenCollection)
                }
            }
            if (page.rows.isNotEmpty() && (page.albums.isNotEmpty() || page.subfolders.isNotEmpty())) {
                item(key = "tracks-header", contentType = "section") { SectionHeader(stringResource(R.string.collection_section_tracks)) }
            }
            trackItems(page.rows, nowPlayingId, selection) { index, key ->
                viewModel.play(page, index, sourceTitle)
                launcher.trackStarted(origins.of(key))
            }
        }
    }
}
