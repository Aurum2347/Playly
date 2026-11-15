package com.playly.player.ui.screens.search

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.db.TrackEntity
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.ErrorState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.SectionHeader
import com.playly.player.ui.player.LocalPlayerLauncher
import com.playly.player.ui.player.NowPlayingAction
import com.playly.player.ui.player.rememberListOrigin
import com.playly.player.ui.tracksSummaryLabel

@Composable
fun SearchScreen(onBack: () -> Unit, viewModel: SearchViewModel = viewModel(factory = SearchViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val nowPlayingId by viewModel.nowPlayingId.collectAsStateWithLifecycle()
    val launcher = LocalPlayerLauncher.current
    Column(Modifier.fillMaxSize().imePadding()) {
        SearchField(query = viewModel.query, onQueryChange = viewModel::onQueryChange, onBack = onBack)
        Box(Modifier.weight(1f)) {
            when (val current = state) {
                SearchUiState.Idle -> EmptyState(
                    icon = R.drawable.ic_search,
                    title = stringResource(R.string.search_idle_title),
                    message = stringResource(R.string.search_idle_message),
                )
                SearchUiState.LibraryNotReady -> EmptyState(
                    icon = R.drawable.ic_library,
                    title = stringResource(R.string.search_not_ready_title),
                    message = stringResource(R.string.search_not_ready_message),
                )
                SearchUiState.Indexing -> LoadingState(stringResource(R.string.search_indexing))
                is SearchUiState.NoResults -> EmptyState(
                    icon = R.drawable.ic_search,
                    title = stringResource(R.string.search_no_results_title),
                    message = stringResource(R.string.search_no_results_message, current.query),
                )
                SearchUiState.Error -> ErrorState(
                    title = stringResource(R.string.state_error_title),
                    message = stringResource(R.string.search_error),
                    onRetry = null,
                )
                is SearchUiState.Results -> SearchResults(current, nowPlayingId) { tracks, index, origin ->
                    viewModel.play(tracks, index)
                    launcher.trackStarted(origin)
                }
            }
        }
    }
}

@Composable
private fun SearchField(query: String, onQueryChange: (String) -> Unit, onBack: () -> Unit) {
    val colors = PlaylyTheme.colors
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val label = stringResource(R.string.search_hint)
    // The user explicitly opened search, so focus the field right away (spec §8).
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = PlaylyTheme.spacing.xxs, end = PlaylyTheme.spacing.md, top = PlaylyTheme.spacing.xs, bottom = PlaylyTheme.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlaylyIconButton(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
        Row(
            modifier = Modifier
                .weight(1f)
                .height(PlaylyTheme.spacing.minTouch)
                .clip(PlaylyTheme.shapes.pill)
                .background(colors.surfaceRaised)
                .padding(start = PlaylyTheme.spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PlaylyIcon(R.drawable.ic_search, contentDescription = null, tint = colors.textMuted, size = 20.dp)
            Box(Modifier.weight(1f).padding(horizontal = PlaylyTheme.spacing.sm), contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) {
                    Text(label, style = PlaylyTheme.typography.body, color = colors.textMuted, maxLines = 1)
                }
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = PlaylyTheme.typography.body.copy(color = colors.textPrimary),
                    cursorBrush = SolidColor(colors.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focus)
                        .semantics { contentDescription = label },
                )
            }
            if (query.isNotEmpty()) {
                PlaylyIconButton(R.drawable.ic_close, stringResource(R.string.action_clear), { onQueryChange("") }, tint = colors.textSecondary)
            }
        }
        NowPlayingAction(Modifier.padding(start = PlaylyTheme.spacing.xxs))
    }
}

/**
 * Grouped results. A track plays within the found tracks; playlists open in stage 6, so their
 * rows stay display-only rather than pretend to work.
 */
@Composable
private fun SearchResults(
    results: SearchUiState.Results,
    nowPlayingId: Long?,
    onPlay: (List<TrackEntity>, Int, Offset?) -> Unit,
) {
    val listState = rememberLazyListState()
    val origins = rememberListOrigin(listState)
    LazyColumn(Modifier.fillMaxSize().then(origins.modifier), state = listState) {
        if (results.tracks.isNotEmpty()) {
            item(key = "tracks-header") { SectionHeader(stringResource(R.string.search_section_tracks)) }
            itemsIndexed(results.tracks, key = { _, track -> "t${track.id}" }) { index, track ->
                MediaRow(
                    title = track.title,
                    subtitle = listOfNotNull(track.artist, track.album).filter { it.isNotBlank() }.joinToString(" · "),
                    trailingText = if (track.durationMs > 0) formatClock(track.durationMs) else null,
                    artwork = Artwork(track.uri, track.mediaStoreId, track.albumId, track.dateModified, track.sizeBytes),
                    isActive = track.id == nowPlayingId,
                    onClick = { onPlay(results.tracks, index, origins.of("t${track.id}")) },
                )
            }
        }
        if (results.playlists.isNotEmpty()) {
            item(key = "playlists-header") { SectionHeader(stringResource(R.string.search_section_playlists)) }
            items(results.playlists, key = { "p${it.playlist.id}" }) { item ->
                MediaRow(
                    title = item.playlist.name,
                    subtitle = tracksSummaryLabel(item.trackCount, item.totalDurationMs),
                    placeholderIcon = R.drawable.ic_playlists,
                )
            }
        }
    }
}
