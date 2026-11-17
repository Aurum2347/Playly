package com.playly.player.ui.screens.duplicates

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.duplicates.DuplicateGroup
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.ErrorState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.screens.library.SelectionCheck

/**
 * Duplicates (stage 8.4), opened from the Library: exact copies and probable matches in
 * separate groups, tap to mark, "Select extras", then "Delete from disk" after a confirmation.
 */
@Composable
fun DuplicatesScreen(onBack: () -> Unit, viewModel: DuplicatesViewModel = viewModel(factory = DuplicatesViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val selected by viewModel.selected.collectAsStateWithLifecycle()
    val deleting by viewModel.deleting.collectAsStateWithLifecycle()
    var confirming by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(title = stringResource(R.string.duplicates_title), onBack = onBack)
        when (val current = state) {
            is DuplicatesState.Scanning -> LoadingState(
                if (current.total > 1) stringResource(R.string.duplicates_scanning_progress, current.done, current.total)
                else stringResource(R.string.duplicates_scanning),
            )
            DuplicatesState.Failed -> ErrorState(
                title = stringResource(R.string.state_error_title),
                message = stringResource(R.string.duplicates_failed),
                onRetry = viewModel::scan,
            )
            is DuplicatesState.Found -> if (current.groups.isEmpty()) {
                EmptyState(
                    icon = R.drawable.ic_check,
                    title = stringResource(R.string.duplicates_none_title),
                    message = stringResource(R.string.duplicates_none_message),
                )
            } else {
                val chosen = selected.count { it in current.tracks }
                LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md)) {
                    item(key = "summary", contentType = "summary") {
                        Summary(current, deleting, viewModel::selectExtras)
                    }
                    current.groups.forEachIndexed { index, group ->
                        item(key = "group-$index-${group.ids.first()}", contentType = "kind") { GroupHeader(group.kind) }
                        items(group.ids, key = { id -> "row-$index-$id" }, contentType = { "track" }) { id ->
                            current.tracks[id]?.let { track -> DuplicateRow(track, id in selected) { viewModel.toggle(id) } }
                        }
                    }
                }
                PlaylyButton(
                    stringResource(R.string.duplicates_delete, chosen),
                    onClick = { confirming = true },
                    style = PlaylyButtonStyle.Danger,
                    icon = R.drawable.ic_delete,
                    enabled = chosen > 0 && !deleting,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
                )
                if (confirming && chosen > 0) {
                    ConfirmDialog(
                        title = pluralStringResource(R.plurals.duplicates_confirm_title, chosen, chosen),
                        message = stringResource(R.string.duplicates_confirm_message),
                        confirmLabel = stringResource(R.string.action_delete),
                        onConfirm = {
                            confirming = false
                            viewModel.deleteSelected()
                        },
                        onDismiss = { confirming = false },
                        dangerous = true,
                    )
                }
            }
        }
    }
}

@Composable
private fun Summary(found: DuplicatesState.Found, deleting: Boolean, onSelectExtras: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs)) {
        val groups = found.groups.size
        Text(
            stringResource(R.string.duplicates_summary, groups, found.exactCount, groups - found.exactCount),
            style = PlaylyTheme.typography.subtitle,
            color = PlaylyTheme.colors.textSecondary,
        )
        PlaylyButton(
            stringResource(R.string.duplicates_select_extras),
            onClick = onSelectExtras,
            style = PlaylyButtonStyle.Secondary,
            icon = R.drawable.ic_select_all,
            enabled = !deleting,
            modifier = Modifier.padding(top = PlaylyTheme.spacing.sm),
        )
        Text(
            stringResource(R.string.duplicates_select_extras_hint),
            style = PlaylyTheme.typography.caption,
            color = PlaylyTheme.colors.textMuted,
            modifier = Modifier.padding(top = PlaylyTheme.spacing.xxs),
        )
    }
}

@Composable
private fun GroupHeader(kind: DuplicateGroup.Kind) {
    Text(
        stringResource(if (kind == DuplicateGroup.Kind.Exact) R.string.duplicates_exact else R.string.duplicates_similar),
        style = PlaylyTheme.typography.caption,
        color = if (kind == DuplicateGroup.Kind.Exact) PlaylyTheme.colors.accent else PlaylyTheme.colors.textMuted,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.page, top = PlaylyTheme.spacing.md, bottom = PlaylyTheme.spacing.xxs)
            .semantics { heading() },
    )
}

/** Title, then artist and where the file is: copies differ only in their place. */
@Composable
private fun DuplicateRow(track: TrackEntity, checked: Boolean, onToggle: () -> Unit) {
    val place = listOfNotNull(track.folderPath?.takeIf { it.isNotBlank() }, track.fileName).joinToString("/")
    MediaRow(
        title = track.title,
        subtitle = listOfNotNull(track.artist?.takeIf { it.isNotBlank() }, place).joinToString(" · "),
        trailingText = if (track.durationMs > 0) formatClock(track.durationMs) else null,
        artwork = Artwork(track.uri, track.mediaStoreId, track.albumId, track.dateModified, track.sizeBytes),
        onClick = onToggle,
        trailing = { SelectionCheck(checked) },
        modifier = Modifier.semantics {
            role = Role.Checkbox
            toggleableState = ToggleableState(checked)
        },
    )
}
