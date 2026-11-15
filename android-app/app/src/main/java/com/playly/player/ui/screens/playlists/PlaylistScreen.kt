package com.playly.player.ui.screens.playlists

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.UiMessage
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.NowPlayingAction

/**
 * A playlist's page (spec §7): cover, name, description, play / shuffle, sort, drag to reorder,
 * remove a track from the playlist (never from the device), add from the library, edit, cover,
 * delete with confirmation. If the playlist disappears, the page closes.
 */
@Composable
fun PlaylistScreen(
    onBack: () -> Unit,
    onAddTracks: (Long) -> Unit,
    viewModel: PlaylistViewModel = viewModel(factory = PlaylistViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val launcher = LocalPlayerLauncher.current
    val actions = LocalTrackActions.current
    var menuOpen by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val id = viewModel.playlistId

    LaunchedEffect(state) {
        if (state is PlaylistPageState.Missing) {
            viewModel.onMissing()
            onBack()
        }
    }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.commands.setCover(id, uri)
    }
    val pickCover: () -> Unit = {
        try {
            coverPicker.launch(arrayOf("image/*"))
        } catch (_: ActivityNotFoundException) {
            actions?.notify(UiMessage(R.string.playlist_message_picker_unavailable))
        }
    }

    val page = (state as? PlaylistPageState.Ready)?.page
    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = page?.card?.name.orEmpty(),
            onBack = onBack,
            actions = {
                NowPlayingAction()
                if (page != null) PlaylyIconButton(R.drawable.ic_more_vert, stringResource(R.string.playlist_menu), { menuOpen = true })
            },
        )
        when (state) {
            PlaylistPageState.Loading, PlaylistPageState.Missing -> LoadingState(stringResource(R.string.state_loading_playlists))
            is PlaylistPageState.Ready -> if (page != null) PlaylistTracks(page, nowPlayingId, viewModel, onAddTracks = { onAddTracks(id) })
        }
    }

    if (page == null) return
    val card = page.card
    if (menuOpen) {
        PlaylistMenuSheet(
            card = card,
            actions = PlaylistMenuActions(
                onPlay = { viewModel.commands.play(id, card.name, shuffle = false) { launcher.trackStarted(null) } },
                onShuffle = { viewModel.commands.play(id, card.name, shuffle = true) { launcher.trackStarted(null) } },
                onAddToQueue = { viewModel.commands.addToQueue(id) },
                onEdit = { editing = true },
                onDelete = { deleting = true },
                onPickCover = pickCover,
                onResetCover = { viewModel.commands.setCover(id, null) },
            ),
            onDismiss = { menuOpen = false },
        )
    }
    if (editing) PlaylistEditDialog(card, viewModel.commands, onDone = { editing = false })
    // The page closes by itself once the playlist is gone (state Missing).
    if (deleting) PlaylistDeleteDialog(card, onDone = { deleting = false }, onConfirm = { viewModel.delete(card.name) })
}
