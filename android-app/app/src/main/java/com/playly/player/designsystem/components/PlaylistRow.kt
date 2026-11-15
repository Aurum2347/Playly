package com.playly.player.designsystem.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * A playlist in a list: its cover, name and "N tracks · length". Same rhythm as [MediaRow];
 * [onMore] adds "⋮" and a long press, [trailing] e.g. a check mark.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PlaylistRow(
    name: String,
    subtitle: String,
    covers: List<Artwork>,
    coverUri: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onMore: (() -> Unit)? = null,
    moreDescription: String? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val colors = PlaylyTheme.colors
    val clicks = if (onMore != null) {
        Modifier.combinedClickable(role = Role.Button, onLongClick = onMore, onLongClickLabel = moreDescription, onClick = onClick)
    } else {
        Modifier.clickable(role = Role.Button, onClick = onClick)
    }
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .then(clicks)
            .semantics(mergeDescendants = true) {
                if (onMore != null && moreDescription != null) {
                    customActions = listOf(CustomAccessibilityAction(moreDescription) { onMore(); true })
                }
            }
            .padding(
                start = PlaylyTheme.spacing.md,
                end = if (onMore != null || trailing != null) PlaylyTheme.spacing.xxs else PlaylyTheme.spacing.md,
                top = PlaylyTheme.spacing.xs,
                bottom = PlaylyTheme.spacing.xs,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
    ) {
        PlaylistCover(covers, coverUri)
        Column(Modifier.weight(1f)) {
            Text(name, style = PlaylyTheme.typography.title, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke(this)
        if (onMore != null) {
            PlaylyIconButton(R.drawable.ic_more_vert, moreDescription.orEmpty(), onMore, tint = colors.textMuted)
        }
    }
}
