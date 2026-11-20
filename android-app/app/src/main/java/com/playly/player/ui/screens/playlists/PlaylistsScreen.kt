package com.playly.player.ui.screens.playlists

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.data.playlists.PlaylistCard
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.ErrorState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylistRow
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.designsystem.components.StateAction
import com.playly.player.ui.actions.PlaylistDialog
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.rememberCreateDocument
import com.playly.player.ui.rememberOpenDocument
import com.playly.player.ui.tracksSummaryLabel

/**
 * Playlists tab (spec §7): cover, name, count and length; "+" creates one and opens it.
 * A tap opens the page, "⋮" or a long press the playlist menu.
 */
@Composable
fun PlaylistsScreen(
    onOpenPlaylist: (Long) -> Unit,
    onOpenFavorites: () -> Unit,
    viewModel: PlaylistsViewModel = viewModel(factory = PlaylistsViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val favorites by viewModel.favoritesCard.collectAsStateWithLifecycle()
    val motion = PlaylyTheme.motion
    var creating by rememberSaveable { mutableStateOf(false) }
    var menuFor by rememberSaveable { mutableStateOf<Long?>(null) }
    var editing by rememberSaveable { mutableStateOf<Long?>(null) }
    var deleting by rememberSaveable { mutableStateOf<Long?>(null) }
    val menuLabel = stringResource(R.string.playlist_menu)
    // Stage 9.2: which playlist the "save as" is for; survives the trip to the picker.
    var exporting by rememberSaveable { mutableStateOf<Long?>(null) }
    val latestCards by rememberUpdatedState((state as? PlaylistsUiState.Ready)?.playlists.orEmpty())
    val exportTo = rememberCreateDocument(PlaylistCommands.M3U_MIME) { uri ->
        latestCards.firstOrNull { it.id == exporting }?.let { viewModel.commands.export(it.id, it.name, uri) }
        exporting = null
    }
    val importFrom = rememberOpenDocument(PlaylistCommands.M3U_OPEN_MIMES) { uri ->
        viewModel.commands.import(uri, onImported = onOpenPlaylist)
    }

    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = stringResource(R.string.nav_playlists),
            actions = {
                PlaylyIconButton(R.drawable.ic_file_download, stringResource(R.string.action_import_playlist), importFrom)
                PlaylyIconButton(R.drawable.ic_add, stringResource(R.string.action_create_playlist), { creating = true })
            },
        )
        AnimatedContent(
            targetState = state,
            contentKey = { it::class },
            transitionSpec = { fadeIn(motion.standard()) togetherWith fadeOut(motion.exit()) },
            label = "playlistsState",
        ) { current ->
            when (current) {
                PlaylistsUiState.Loading -> LoadingState(stringResource(R.string.state_loading_playlists))
                PlaylistsUiState.Error -> ErrorState(
                    title = stringResource(R.string.state_error_title),
                    message = stringResource(R.string.state_error_playlists),
                    onRetry = viewModel::retry,
                )
                is PlaylistsUiState.Ready -> if (current.playlists.isEmpty()) Column(Modifier.fillMaxSize()) {
                    FavoritesEntry(favorites, onOpenFavorites)
                    EmptyState(
                        modifier = Modifier.weight(1f),
                        icon = R.drawable.ic_playlists,
                        title = stringResource(R.string.state_no_playlists_title),
                        message = stringResource(R.string.state_no_playlists_message),
                        primaryAction = StateAction(stringResource(R.string.action_create_playlist), { creating = true }, R.drawable.ic_add),
                    )
                } else {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md)) {
                        item(key = "favorites", contentType = "favorites") { FavoritesEntry(favorites, onOpenFavorites) }
                        items(current.playlists, key = { it.id }) { card ->
                            PlaylistRow(
                                name = card.name,
                                subtitle = tracksSummaryLabel(card.summary.trackCount, card.summary.totalDurationMs),
                                covers = card.covers,
                                coverUri = card.coverUri,
                                onClick = { onOpenPlaylist(card.id) },
                                onMore = { menuFor = card.id },
                                moreDescription = menuLabel,
                                modifier = Modifier.animateItem(),
                            )
                        }
                    }
                }
            }
        }
    }

    val cards = (state as? PlaylistsUiState.Ready)?.playlists.orEmpty()
    val launcher = LocalPlayerLauncher.current
    cards.firstOrNull { it.id == menuFor }?.let { card ->
        PlaylistMenuSheet(
            card = card,
            actions = PlaylistMenuActions(
                onPlay = { viewModel.commands.play(card.id, card.name, shuffle = false) { launcher.trackStarted(null) } },
                onShuffle = { viewModel.commands.play(card.id, card.name, shuffle = true) { launcher.trackStarted(null) } },
                onAddToQueue = { viewModel.commands.addToQueue(card.id) },
                onEdit = { editing = card.id },
                onDelete = { deleting = card.id },
                onExport = {
                    exporting = card.id
                    exportTo(PlaylistCommands.exportFileName(card.name))
                },
            ),
            onDismiss = { menuFor = null },
        )
    }
    if (creating) {
        PlaylistDialog(
            title = stringResource(R.string.playlist_new),
            confirmLabel = stringResource(R.string.action_create),
            onConfirm = { name, _ ->
                creating = false
                viewModel.commands.create(name, onCreated = onOpenPlaylist)
            },
            onDismiss = { creating = false },
        )
    }
    cards.firstOrNull { it.id == editing }?.let { card ->
        PlaylistEditDialog(card, viewModel.commands, onDone = { editing = null })
    }
    cards.firstOrNull { it.id == deleting }?.let { card ->
        PlaylistDeleteDialog(card, onDone = { deleting = null }, onConfirm = { viewModel.commands.delete(card.id, card.name) })
    }
}

/** Name and description of an existing playlist. */
@Composable
internal fun PlaylistEditDialog(card: PlaylistCard, commands: PlaylistCommands, onDone: () -> Unit) {
    PlaylistDialog(
        title = stringResource(R.string.playlist_dialog_edit_title),
        confirmLabel = stringResource(R.string.action_save),
        initialName = card.name,
        initialDescription = card.summary.playlist.description,
        withDescription = true,
        onConfirm = { name, description ->
            onDone()
            commands.edit(card.id, name, description)
        },
        onDismiss = onDone,
    )
}

/** Deleting always asks first; tracks and files are never touched. */
@Composable
internal fun PlaylistDeleteDialog(card: PlaylistCard, onDone: () -> Unit, onConfirm: () -> Unit) {
    ConfirmDialog(
        title = stringResource(R.string.dialog_delete_playlist_title),
        message = stringResource(R.string.dialog_delete_playlist_message, card.name),
        confirmLabel = stringResource(R.string.action_delete),
        dangerous = true,
        onConfirm = {
            onDone()
            onConfirm()
        },
        onDismiss = onDone,
    )
}

/** Favourites always sit first on the tab, even with no playlists yet; heart until something is added. */
@Composable
private fun FavoritesEntry(card: FavoritesCard, onOpen: () -> Unit) {
    MediaRow(
        title = stringResource(R.string.favorites_title),
        subtitle = tracksSummaryLabel(card.count, card.totalDurationMs),
        placeholderIcon = R.drawable.ic_favorite,
        artwork = card.cover,
        onClick = onOpen,
    )
}
