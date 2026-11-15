package com.playly.player.ui.screens.playlists

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.semantics.toggleableState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.artwork.artwork
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylyTextField
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.screens.library.trackSubtitle

/** Library picker for a playlist: search, check boxes, one "Add N tracks" button. */
@Composable
fun AddTracksScreen(onBack: () -> Unit, viewModel: AddTracksViewModel = viewModel(factory = AddTracksViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val query by viewModel.query.collectAsStateWithLifecycle()
    val selected by viewModel.selected.collectAsStateWithLifecycle()
    val current = state
    val close = dropUnlessResumed { onBack() }
    if (current == null) {
        // The playlist was deleted meanwhile.
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val inPlaylist = stringResource(R.string.add_tracks_in_playlist)
    Column(Modifier.fillMaxSize().imePadding()) {
        PlaylyTopBar(title = stringResource(R.string.add_tracks_title, current.playlistName), onBack = close)
        PlaylyTextField(
            value = query,
            onValueChange = viewModel::onQueryChange,
            label = stringResource(R.string.add_tracks_search),
            leadingIcon = R.drawable.ic_search,
            modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs),
        )
        val rows = current.rows
        Box(Modifier.weight(1f)) {
            when {
                rows == null -> LoadingState(stringResource(R.string.state_loading_library))
                rows.isEmpty() -> EmptyState(
                    icon = R.drawable.ic_search,
                    title = stringResource(R.string.search_no_results_title),
                    message = if (query.isBlank()) stringResource(R.string.search_not_ready_message) else stringResource(R.string.search_no_results_message, query),
                )
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.md)) {
                    items(rows, key = { it.track.id }, contentType = { "pick" }) { row ->
                        val checked = row.track.id in selected
                        val subtitle = trackSubtitle(row.track)
                        MediaRow(
                            title = row.track.title,
                            subtitle = if (row.inPlaylist) stringResource(R.string.summary_separator, subtitle, inPlaylist) else subtitle,
                            trailingText = if (row.track.durationMs > 0) formatClock(row.track.durationMs) else null,
                            artwork = row.track.artwork(),
                            dimmed = row.inPlaylist && !checked,
                            onClick = { viewModel.toggle(row.track.id) },
                            trailing = {
                                PlaylyIcon(
                                    if (checked) R.drawable.ic_checkbox_on else R.drawable.ic_checkbox_off,
                                    contentDescription = null,
                                    tint = if (checked) PlaylyTheme.colors.accent else PlaylyTheme.colors.textMuted,
                                    modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.sm),
                                )
                            },
                            modifier = Modifier.semantics {
                                role = Role.Checkbox
                                toggleableState = ToggleableState(checked)
                                if (row.inPlaylist) stateDescription = inPlaylist
                            },
                        )
                    }
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
            contentAlignment = Alignment.Center,
        ) {
            val count = selected.size
            PlaylyButton(
                text = if (count == 0) stringResource(R.string.add_tracks_none_selected) else pluralStringResource(R.plurals.add_tracks_confirm, count, count),
                onClick = { viewModel.confirm(current.playlistName, onDone = onBack) },
                enabled = count > 0,
                icon = R.drawable.ic_add,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
