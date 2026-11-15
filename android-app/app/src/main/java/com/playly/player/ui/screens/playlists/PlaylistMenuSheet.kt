package com.playly.player.ui.screens.playlists

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.playlists.PlaylistCard
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylistCover
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.SheetAction
import com.playly.player.ui.tracksSummaryLabel

/** What the playlist menu can do; null actions are not shown (e.g. "cover" outside the page). */
class PlaylistMenuActions(
    val onPlay: () -> Unit,
    val onShuffle: () -> Unit,
    val onAddToQueue: () -> Unit,
    val onEdit: () -> Unit,
    val onDelete: () -> Unit,
    val onPickCover: (() -> Unit)? = null,
    val onResetCover: (() -> Unit)? = null,
)

/** "⋮" of a playlist (spec §12): the same actions on the Playlists tab and on its page. */
@Composable
internal fun PlaylistMenuSheet(card: PlaylistCard, actions: PlaylistMenuActions, onDismiss: () -> Unit) {
    PlaylySheet(onDismiss = onDismiss) { close ->
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
        ) {
            PlaylistCover(card.covers, card.coverUri, size = 56.dp)
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) { heading() }) {
                Text(card.name, style = PlaylyTheme.typography.title, color = PlaylyTheme.colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    tracksSummaryLabel(card.summary.trackCount, card.summary.totalDurationMs),
                    style = PlaylyTheme.typography.subtitle,
                    color = PlaylyTheme.colors.textMuted,
                    maxLines = 1,
                )
            }
        }
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Spacer(Modifier.height(PlaylyTheme.spacing.xs))
            if (card.summary.trackCount > 0) {
                SheetAction(R.drawable.ic_play, stringResource(R.string.playlist_menu_play), onClick = { close(actions.onPlay) })
                SheetAction(R.drawable.ic_shuffle, stringResource(R.string.playlist_menu_shuffle), onClick = { close(actions.onShuffle) })
                SheetAction(R.drawable.ic_queue_music, stringResource(R.string.playlist_menu_add_to_queue), onClick = { close(actions.onAddToQueue) })
            }
            SheetAction(R.drawable.ic_edit, stringResource(R.string.playlist_menu_edit), onClick = { close(actions.onEdit) })
            actions.onPickCover?.let { pick ->
                SheetAction(R.drawable.ic_image, stringResource(R.string.playlist_menu_cover), onClick = { close(pick) })
            }
            if (card.coverUri != null) {
                actions.onResetCover?.let { reset ->
                    SheetAction(R.drawable.ic_refresh, stringResource(R.string.playlist_menu_cover_reset), onClick = { close(reset) })
                }
            }
            SheetAction(R.drawable.ic_delete, stringResource(R.string.playlist_menu_delete), onClick = { close(actions.onDelete) })
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}
