package com.playly.player.ui.actions

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.playly.player.R
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.browse.CollectionKeys
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.SheetAction
import com.playly.player.designsystem.components.SheetTrackHeader
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.UiMessage
import com.playly.player.ui.player.TrackDetailsSheet
import com.playly.player.ui.player.shareTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * The activity-wide [TrackActionsViewModel]. Rows anywhere (tabs, playlist pages, the player,
 * the queue) open their "⋮" menu through it; null only in previews and tests.
 */
val LocalTrackActions = staticCompositionLocalOf<TrackActionsViewModel?> { null }

/** Shows the one open track sheet and the confirmations of its actions. */
@Composable
fun TrackActionsHost(viewModel: TrackActionsViewModel, onOpenCollection: (CollectionKind, String) -> Unit) {
    CollectMessages(viewModel.messages)
    val sheet by viewModel.sheet.collectAsStateWithLifecycle()
    // Outlives the sheets: "Share" finishes after its sheet has closed.
    val scope = rememberCoroutineScope()
    when (val current = sheet) {
        null -> Unit
        is TrackSheet.Menu -> TrackMenu(current.target, viewModel, scope, onOpenCollection)
        is TrackSheet.Details -> TrackDetailsSheet(current.trackId, viewModel::track, viewModel::dismiss)
        is TrackSheet.AddToPlaylist -> AddToPlaylistSheet(current, viewModel)
        is TrackSheet.Collection -> CollectionMenu(current.target, viewModel)
    }
}

/**
 * "⋮" of a track (spec §12): only actions that work for it here. Queue actions are hidden for
 * the current track; a queue row offers "Play next" as a move and "Remove from queue".
 */
@Composable
private fun TrackMenu(
    target: TrackTarget,
    viewModel: TrackActionsViewModel,
    scope: CoroutineScope,
    onOpenCollection: (CollectionKind, String) -> Unit,
) {
    val context = LocalContext.current
    // Tags for "Go to album / artist"; those items appear once the row is read (a few ms).
    val track by produceState<TrackEntity?>(null, target.trackId) { value = viewModel.track(target.trackId) }
    PlaylySheet(onDismiss = viewModel::dismiss) { close ->
        SheetTrackHeader(target.title, target.subtitle, target.artwork)
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Spacer(Modifier.height(PlaylyTheme.spacing.xs))
            val uid = target.queueUid
            if (uid != null) {
                SheetAction(R.drawable.ic_play_next, stringResource(R.string.track_menu_play_next), onClick = {
                    close { viewModel.playNextInQueue(uid) }
                })
                SheetAction(R.drawable.ic_remove_circle, stringResource(R.string.track_menu_remove_from_queue), onClick = {
                    close { viewModel.removeFromQueue(uid) }
                })
            } else if (target.queueActions) {
                SheetAction(R.drawable.ic_play_next, stringResource(R.string.track_menu_play_next), onClick = {
                    close { viewModel.queue(listOf(target.trackId), next = true) }
                })
                SheetAction(R.drawable.ic_queue_music, stringResource(R.string.track_menu_add_to_queue), onClick = {
                    close { viewModel.queue(listOf(target.trackId), next = false) }
                })
            }
            SheetAction(R.drawable.ic_playlist_add, stringResource(R.string.track_menu_add_to_playlist), onClick = {
                close { viewModel.openAddToPlaylist(listOf(target.trackId), single = target) }
            })
            target.playlistEntry?.let { entry ->
                SheetAction(R.drawable.ic_remove_circle, stringResource(R.string.track_menu_remove_from_playlist), onClick = {
                    close { viewModel.removeFromPlaylist(entry) }
                })
            }
            val albumKey = track?.let { CollectionKeys.album(it.album, it.albumArtist, it.folderPath) }
            if (albumKey != null) {
                SheetAction(R.drawable.ic_album, stringResource(R.string.track_menu_open_album), onClick = {
                    close { onOpenCollection(CollectionKind.Album, albumKey) }
                })
            }
            val artist = track?.artist?.takeIf { it.isNotBlank() }
            if (artist != null) {
                SheetAction(R.drawable.ic_artist, stringResource(R.string.track_menu_open_artist), onClick = {
                    close { onOpenCollection(CollectionKind.Artist, CollectionKeys.artist(artist)) }
                })
            }
            SheetAction(R.drawable.ic_info, stringResource(R.string.track_menu_details), onClick = {
                close { viewModel.openDetails(target.trackId) }
            })
            SheetAction(R.drawable.ic_share, stringResource(R.string.track_menu_share), onClick = {
                close {
                    scope.launch {
                        if (!shareTrack(context, viewModel.track(target.trackId))) viewModel.notify(UiMessage(R.string.share_failed))
                    }
                }
            })
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}

/** "⋮" of an album, artist, genre or folder: play, shuffle, queue, add to a playlist. */
@Composable
private fun CollectionMenu(target: CollectionTarget, viewModel: TrackActionsViewModel) {
    val launcher = LocalPlayerLauncher.current
    PlaylySheet(onDismiss = viewModel::dismiss) { close ->
        SheetTrackHeader(target.title, target.subtitle, target.artwork)
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Spacer(Modifier.height(PlaylyTheme.spacing.xs))
            SheetAction(R.drawable.ic_play, stringResource(R.string.action_play_all), onClick = {
                close {
                    viewModel.playCollection(target, shuffle = false)
                    launcher.trackStarted(null)
                }
            })
            SheetAction(R.drawable.ic_shuffle, stringResource(R.string.action_shuffle_all), onClick = {
                close {
                    viewModel.playCollection(target, shuffle = true)
                    launcher.trackStarted(null)
                }
            })
            SheetAction(R.drawable.ic_play_next, stringResource(R.string.track_menu_play_next), onClick = {
                close { viewModel.queue(target.trackIds, next = true) }
            })
            SheetAction(R.drawable.ic_queue_music, stringResource(R.string.track_menu_add_to_queue), onClick = {
                close { viewModel.queue(target.trackIds, next = false) }
            })
            SheetAction(R.drawable.ic_playlist_add, stringResource(R.string.track_menu_add_to_playlist), onClick = {
                close { viewModel.openAddToPlaylist(target.trackIds) }
            })
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}
