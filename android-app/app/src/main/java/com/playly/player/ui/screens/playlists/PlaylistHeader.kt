package com.playly.player.ui.screens.playlists

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.playlists.PlaylistSort
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylistCover
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.ui.screens.library.SortButton
import com.playly.player.ui.tracksSummaryLabel

/** Cover, name, description, "N tracks · length · unavailable: K", play / shuffle, add, sort. */
@Composable
internal fun PlaylistHeader(
    page: PlaylistPage,
    onPlay: (shuffle: Boolean) -> Unit,
    onAddTracks: () -> Unit,
    onSort: (PlaylistSort) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = PlaylyTheme.colors
    val summary = page.card.summary
    Column(modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs, bottom = PlaylyTheme.spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md)) {
            PlaylistCover(page.card.covers, page.card.coverUri, size = COVER, shape = PlaylyTheme.shapes.medium)
            Column(Modifier.weight(1f).padding(end = PlaylyTheme.spacing.xs)) {
                Text(
                    page.card.name,
                    style = PlaylyTheme.typography.sectionTitle,
                    color = colors.textPrimary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                val count = tracksSummaryLabel(summary.trackCount, summary.totalDurationMs)
                Text(
                    if (page.unavailable > 0) {
                        stringResource(R.string.summary_separator, count, stringResource(R.string.playlist_unavailable_count, page.unavailable))
                    } else {
                        count
                    },
                    style = PlaylyTheme.typography.subtitle,
                    color = colors.textMuted,
                )
            }
        }
        summary.playlist.description?.let { description ->
            Spacer(Modifier.height(PlaylyTheme.spacing.sm))
            Text(
                description,
                style = PlaylyTheme.typography.body,
                color = colors.textSecondary,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = PlaylyTheme.spacing.xs),
            )
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.md))
        if (page.rows.size > page.unavailable) {
            Row(horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm)) {
                PlaylyButton(stringResource(R.string.action_play_all), { onPlay(false) }, icon = R.drawable.ic_play)
                PlaylyButton(stringResource(R.string.action_shuffle_all), { onPlay(true) }, style = PlaylyButtonStyle.Secondary, icon = R.drawable.ic_shuffle)
            }
            Spacer(Modifier.height(PlaylyTheme.spacing.xs))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            PlaylyButton(stringResource(R.string.action_add_tracks), onAddTracks, style = PlaylyButtonStyle.Text, icon = R.drawable.ic_add)
            Spacer(Modifier.weight(1f))
            if (page.rows.size > 1) SortButton(PlaylistSort.entries, page.sort, { it.label }, onSort)
        }
    }
}

/** Shown under the header while the playlist has no tracks. */
@Composable
internal fun PlaylistEmptyNote() {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = PlaylyTheme.spacing.xxl, vertical = PlaylyTheme.spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.playlist_empty_title),
            style = PlaylyTheme.typography.title,
            color = PlaylyTheme.colors.textPrimary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(PlaylyTheme.spacing.xs))
        Text(
            stringResource(R.string.playlist_empty_message),
            style = PlaylyTheme.typography.subtitle,
            color = PlaylyTheme.colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

val PlaylistSort.label: Int
    get() = when (this) {
        PlaylistSort.Manual -> R.string.sort_manual
        PlaylistSort.Title -> R.string.sort_title
        PlaylistSort.Artist -> R.string.sort_artist
        PlaylistSort.Album -> R.string.sort_album
        PlaylistSort.DateAdded -> R.string.sort_recently_added
        PlaylistSort.Duration -> R.string.sort_duration
    }

private val COVER = 112.dp
