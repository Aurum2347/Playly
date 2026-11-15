package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * List row: artwork, title, subtitle, optional trailing text. Long text is ellipsised.
 * [onClick] makes the whole row one touch target; [isActive] marks the current track with a
 * quiet surface (no glow) and tells TalkBack "Now playing". The "⋮" menu arrives in stage 6.
 */
@Composable
fun MediaRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailingText: String? = null,
    @DrawableRes placeholderIcon: Int = R.drawable.ic_music_note,
    artwork: Artwork? = null,
    isActive: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val colors = PlaylyTheme.colors
    val background by animateColorAsState(
        targetValue = if (isActive) colors.selected else Color.Transparent,
        animationSpec = PlaylyTheme.motion.press(),
        label = "rowActive",
    )
    val nowPlaying = stringResource(R.string.playback_now_playing)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .drawBehind { drawRect(background) }
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .semantics(mergeDescendants = true) { if (isActive) stateDescription = nowPlaying }
            .padding(horizontal = PlaylyTheme.spacing.md, vertical = PlaylyTheme.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
    ) {
        if (artwork != null) TrackArtwork(artwork, placeholderIcon = placeholderIcon) else ArtworkPlaceholder(icon = placeholderIcon)
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = if (isActive) PlaylyTheme.typography.title.copy(fontWeight = FontWeight.SemiBold) else PlaylyTheme.typography.title,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (trailingText != null) {
            Text(trailingText, style = PlaylyTheme.typography.caption, color = colors.textMuted)
        }
    }
}
