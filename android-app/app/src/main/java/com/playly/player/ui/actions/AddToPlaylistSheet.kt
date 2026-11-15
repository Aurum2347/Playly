package com.playly.player.ui.actions

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.playly.player.R
import com.playly.player.core.SearchText
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.PlaylistRow
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.PlaylyTextField
import com.playly.player.designsystem.components.SheetAction
import com.playly.player.designsystem.components.SheetTrackHeader
import com.playly.player.ui.tracksSummaryLabel
import kotlinx.coroutines.flow.flowOf

/**
 * "Add to playlist" (spec §12): local playlists with search, "New playlist", a check on those
 * that already hold the track. Adding a track again needs a confirmation; nothing stops playback.
 */
@Composable
internal fun AddToPlaylistSheet(sheet: TrackSheet.AddToPlaylist, viewModel: TrackActionsViewModel) {
    val cards by viewModel.playlistCards.collectAsStateWithLifecycle()
    val single = sheet.single
    val containingFlow = remember(single?.trackId) { single?.let { viewModel.containing(it.trackId) } ?: flowOf(emptySet()) }
    val containing by containingFlow.collectAsStateWithLifecycle(emptySet())
    var query by rememberSaveable { mutableStateOf("") }
    var creating by rememberSaveable { mutableStateOf(false) }
    var duplicateOf by rememberSaveable { mutableStateOf<Long?>(null) }

    PlaylySheet(onDismiss = viewModel::dismiss) { close ->
        if (single != null) SheetTrackHeader(single.title, single.subtitle, single.artwork)
        Text(
            if (single != null) {
                stringResource(R.string.add_to_playlist_title)
            } else {
                pluralStringResource(R.plurals.add_to_playlist_title_many, sheet.trackIds.size, sheet.trackIds.size)
            },
            style = PlaylyTheme.typography.sectionTitle,
            color = PlaylyTheme.colors.textPrimary,
            modifier = Modifier
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs)
                .semantics { heading() },
        )
        val all = cards
        if (all == null) {
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.xxxl))
            return@PlaylySheet
        }
        if (all.size > SEARCH_FROM) {
            PlaylyTextField(
                value = query,
                onValueChange = { query = it },
                label = stringResource(R.string.add_to_playlist_search),
                leadingIcon = R.drawable.ic_search,
                modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs),
            )
        }
        SheetAction(R.drawable.ic_add, stringResource(R.string.playlist_new), onClick = { creating = true })
        val needle = SearchText.normalize(query.trim())
        val shown = remember(all, needle) { if (needle.isEmpty()) all else all.filter { SearchText.normalize(it.name).contains(needle) } }
        LazyColumn(Modifier.fillMaxWidth()) {
            if (shown.isEmpty()) {
                item(key = "note") { SheetNote(stringResource(if (all.isEmpty()) R.string.add_to_playlist_empty else R.string.add_to_playlist_no_match)) }
            }
            items(shown, key = { it.id }) { card ->
                val has = card.id in containing
                PlaylistRow(
                    name = card.name,
                    subtitle = if (has) {
                        stringResource(R.string.add_to_playlist_contains)
                    } else {
                        tracksSummaryLabel(card.summary.trackCount, card.summary.totalDurationMs)
                    },
                    covers = card.covers,
                    coverUri = card.coverUri,
                    onClick = {
                        if (has) {
                            duplicateOf = card.id
                        } else {
                            close { viewModel.addToPlaylist(card.id, card.name, sheet.trackIds) }
                        }
                    },
                    trailing = if (has) {
                        { PlaylyIcon(R.drawable.ic_check, contentDescription = null, tint = PlaylyTheme.colors.textSecondary) }
                    } else {
                        null
                    },
                )
            }
            item(key = "end") { Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md)) }
        }
    }

    if (creating) {
        PlaylistDialog(
            title = stringResource(R.string.playlist_new),
            confirmLabel = stringResource(R.string.action_create),
            onConfirm = { name, _ ->
                creating = false
                viewModel.dismiss()
                viewModel.createPlaylistAndAdd(name, sheet.trackIds)
            },
            onDismiss = { creating = false },
        )
    }
    val duplicate = duplicateOf?.let { id -> cards?.firstOrNull { it.id == id } }
    if (duplicate != null && single != null) {
        ConfirmDialog(
            title = stringResource(R.string.dialog_duplicate_title),
            message = stringResource(R.string.dialog_duplicate_message, single.title, duplicate.name),
            confirmLabel = stringResource(R.string.action_add_again),
            onConfirm = {
                duplicateOf = null
                viewModel.dismiss()
                viewModel.addToPlaylist(duplicate.id, duplicate.name, sheet.trackIds, allowDuplicates = true)
            },
            onDismiss = { duplicateOf = null },
        )
    }
}

@Composable
private fun SheetNote(text: String) {
    Text(
        text,
        style = PlaylyTheme.typography.subtitle,
        color = PlaylyTheme.colors.textMuted,
        modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.md),
    )
}

/** Below this many playlists the list fits on screen and a search field would only add noise. */
private const val SEARCH_FROM = 6
