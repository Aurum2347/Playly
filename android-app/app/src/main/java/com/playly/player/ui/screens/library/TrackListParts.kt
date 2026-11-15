package com.playly.player.ui.screens.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.artwork.artwork
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.LibraryContent
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.BackgroundTaskIndicator
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.TrackSelection
import com.playly.player.ui.actions.TrackTarget
import com.playly.player.ui.tracksSummaryLabel

/**
 * "All tracks" header shared by Home and Library: count and total length, sort, "Play" and
 * "Shuffle", and a quiet indicator while a rescan runs.
 */
@Composable
fun TrackListHeader(
    content: LibraryContent.Tracks,
    progress: ScanProgress?,
    sort: TrackSort?,
    onSort: (TrackSort) -> Unit,
    onPlayAll: () -> Unit,
    onShuffleAll: () -> Unit,
    modifier: Modifier = Modifier,
    /** Replaces "N tracks · length", e.g. while a filter is on. */
    summary: String? = null,
    /** Adds "Select" (multi-select) next to "Play" and "Shuffle". */
    onSelect: (() -> Unit)? = null,
) {
    val motion = PlaylyTheme.motion
    Column(modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.all_tracks),
                    style = PlaylyTheme.typography.sectionTitle,
                    color = PlaylyTheme.colors.textPrimary,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                Text(
                    summary ?: tracksSummaryLabel(content.count, content.totalDurationMs),
                    style = PlaylyTheme.typography.subtitle,
                    color = PlaylyTheme.colors.textMuted,
                )
            }
            if (sort != null) SortButton(sort, onSort)
        }
        AnimatedVisibility(
            visible = progress != null,
            enter = fadeIn(motion.standard()) + expandVertically(motion.standard()),
            exit = fadeOut(motion.exit()) + shrinkVertically(motion.exit()),
        ) {
            BackgroundTaskIndicator(
                label = stringResource(R.string.state_scanning_found, progress?.found ?: 0),
                modifier = Modifier.padding(top = PlaylyTheme.spacing.xs),
            )
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.sm))
        Row(horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm)) {
            PlaylyButton(stringResource(R.string.action_play_all), onPlayAll, icon = R.drawable.ic_play)
            PlaylyButton(
                stringResource(R.string.action_shuffle_all),
                onShuffleAll,
                style = PlaylyButtonStyle.Secondary,
                icon = R.drawable.ic_shuffle,
            )
            if (onSelect != null) {
                Spacer(Modifier.weight(1f))
                PlaylyIconButton(R.drawable.ic_select, stringResource(R.string.action_select), onSelect, tint = PlaylyTheme.colors.textSecondary)
            }
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.xs))
    }
}

@Composable
private fun SortButton(sort: TrackSort, onSort: (TrackSort) -> Unit) =
    SortButton(TrackSort.entries, sort, { it.label }, onSort)

/** Current order as a small label; the menu marks the chosen one with a check and for TalkBack. */
@Composable
fun <T> SortButton(options: List<T>, sort: T, labelOf: (T) -> Int, onSort: (T) -> Unit) {
    val colors = PlaylyTheme.colors
    var open by remember { mutableStateOf(false) }
    val label = stringResource(labelOf(sort))
    val description = stringResource(R.string.sort_current, label)
    Box {
        Row(
            modifier = Modifier
                .heightIn(min = PlaylyTheme.spacing.minTouch)
                .clip(PlaylyTheme.shapes.pill)
                .clickable(role = Role.Button) { open = true }
                .semantics(mergeDescendants = true) { contentDescription = description }
                .padding(horizontal = PlaylyTheme.spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PlaylyIcon(R.drawable.ic_sort, contentDescription = null, tint = colors.textSecondary, size = 20.dp)
            Spacer(Modifier.width(PlaylyTheme.spacing.xxs))
            Text(label, style = PlaylyTheme.typography.caption, color = colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = colors.surfaceOverlay,
            shape = PlaylyTheme.shapes.medium,
        ) {
            options.forEach { option ->
                val chosen = option == sort
                DropdownMenuItem(
                    text = { Text(stringResource(labelOf(option)), style = PlaylyTheme.typography.body, color = colors.textPrimary) },
                    onClick = {
                        open = false
                        if (!chosen) onSort(option)
                    },
                    trailingIcon = if (chosen) {
                        { PlaylyIcon(R.drawable.ic_check, contentDescription = null, size = 20.dp) }
                    } else {
                        null
                    },
                    modifier = Modifier.semantics { selected = chosen },
                )
            }
        }
    }
}

val TrackSort.label: Int
    get() = when (this) {
        TrackSort.Title -> R.string.sort_title
        TrackSort.Artist -> R.string.sort_artist
        TrackSort.Album -> R.string.sort_album
        TrackSort.DateAdded -> R.string.sort_date_added
        TrackSort.Duration -> R.string.sort_duration
    }

/**
 * Virtualised track rows keyed by track id: rows are recycled, covers load lazily at row size,
 * and the list keeps its place when tracks are added or re-sorted. [onPlay] gets the index and
 * the row's key (to anchor the player animation); "⋮" and a long press open the track menu.
 */
fun LazyListScope.trackItems(
    tracks: List<TrackListItem>,
    nowPlayingId: Long?,
    selection: TrackSelection? = null,
    onPlay: (index: Int, key: Any) -> Unit,
) {
    itemsIndexed(tracks, key = { _, track -> track.id }, contentType = { _, _ -> "track" }) { index, track ->
        val actions = LocalTrackActions.current
        val subtitle = trackSubtitle(track)
        val selected = selection?.ids?.let { track.id in it }
        MediaRow(
            title = track.title,
            subtitle = subtitle,
            trailingText = if (track.durationMs > 0) formatClock(track.durationMs) else null,
            artwork = track.artwork(),
            isActive = track.id == nowPlayingId,
            onClick = { if (selected != null) selection?.toggle(track.id) else onPlay(index, track.id) },
            onMore = if (selected != null) null else actions?.let { a -> { a.open(TrackTarget(track.id, track.title, subtitle, track.artwork())) } },
            trailing = if (selected != null) { { SelectionCheck(selected) } } else null,
            modifier = if (selected != null) {
                Modifier.semantics {
                    role = Role.Checkbox
                    toggleableState = ToggleableState(selected)
                }
            } else {
                Modifier
            },
        )
    }
}

/** Check box at the end of a row while selecting; the row itself is the touch target. */
@Composable
fun SelectionCheck(checked: Boolean) {
    PlaylyIcon(
        if (checked) R.drawable.ic_checkbox_on else R.drawable.ic_checkbox_off,
        contentDescription = null,
        tint = if (checked) PlaylyTheme.colors.accent else PlaylyTheme.colors.textMuted,
        modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.sm),
    )
}

@Composable
fun trackSubtitle(track: TrackListItem): String {
    val parts = listOfNotNull(track.artist, track.album).filter { it.isNotBlank() }
    return if (parts.isEmpty()) stringResource(R.string.unknown_artist) else parts.joinToString(" · ")
}
