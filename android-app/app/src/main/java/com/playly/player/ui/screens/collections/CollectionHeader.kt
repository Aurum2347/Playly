package com.playly.player.ui.screens.collections

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import com.playly.player.data.artwork.artwork
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.TrackArtwork
import com.playly.player.ui.tracksSummaryLabel

/** Cover, name, "artist · year" (album) or the folder path, "N tracks · length", play / shuffle / select. */
@Composable
internal fun CollectionHeader(
    page: CollectionPage,
    title: String,
    subtitle: String?,
    onPlay: (shuffle: Boolean) -> Unit,
    onSelect: (() -> Unit)?,
) {
    val colors = PlaylyTheme.colors
    Column(Modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs, bottom = PlaylyTheme.spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md)) {
            val cover = if (page.kind == CollectionKind.Album) page.group?.cover?.artwork() else null
            TrackArtwork(cover, size = COVER, placeholderIcon = page.kind.icon, shape = PlaylyTheme.shapes.medium, iconSize = 48.dp)
            Column(Modifier.weight(1f).padding(end = PlaylyTheme.spacing.xs)) {
                Text(
                    title,
                    style = PlaylyTheme.typography.sectionTitle,
                    color = colors.textPrimary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                if (!subtitle.isNullOrBlank()) {
                    Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                    Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                Text(
                    tracksSummaryLabel(page.queue.size, page.totalDurationMs),
                    style = PlaylyTheme.typography.subtitle,
                    color = colors.textMuted,
                )
            }
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.md))
        Row(horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            PlaylyButton(stringResource(R.string.action_play_all), { onPlay(false) }, icon = R.drawable.ic_play)
            PlaylyButton(stringResource(R.string.action_shuffle_all), { onPlay(true) }, style = PlaylyButtonStyle.Secondary, icon = R.drawable.ic_shuffle)
            if (onSelect != null) {
                Spacer(Modifier.weight(1f))
                PlaylyIconButton(R.drawable.ic_select, stringResource(R.string.action_select), onSelect, tint = colors.textSecondary)
            } else {
                Spacer(Modifier.width(PlaylyTheme.spacing.xs))
            }
        }
    }
}

private val COVER = 112.dp
