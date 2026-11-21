package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * List row: artwork, title, subtitle, optional trailing text. Long text is ellipsised.
 * [onClick] makes the whole row one touch target; [isActive] marks the current track with a
 * quiet surface (no glow) and tells TalkBack "Now playing". [onMore] adds a "⋮" button; a long
 * press opens the same menu (spec §8, §12). [dimmed] is for files that cannot be played now.
 * [leading] / [trailing] hold extra controls such as a drag handle or a remove button.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailingText: String? = null,
    @DrawableRes placeholderIcon: Int = R.drawable.ic_music_note,
    artwork: Artwork? = null,
    isActive: Boolean = false,
    dimmed: Boolean = false,
    onClick: (() -> Unit)? = null,
    onMore: (() -> Unit)? = null,
    moreDescription: String? = null,
    leading: (@Composable RowScope.() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    accessibilityActions: List<CustomAccessibilityAction> = emptyList(),
) {
    val colors = PlaylyTheme.colors
    val listStyle = PlaylyTheme.listStyle
    val background by animateColorAsState(
        targetValue = if (isActive) colors.selected else Color.Transparent,
        animationSpec = PlaylyTheme.motion.press(),
        label = "rowActive",
    )
    val nowPlaying = stringResource(R.string.playback_now_playing)
    val moreLabel = moreDescription ?: stringResource(R.string.player_track_menu)
    val clicks = when {
        onClick != null && onMore != null -> Modifier.combinedClickable(role = Role.Button, onLongClick = onMore, onLongClickLabel = moreLabel, onClick = onClick)
        onClick != null -> Modifier.clickable(role = Role.Button, onClick = onClick)
        else -> Modifier
    }
    val hasEndControls = onMore != null || trailing != null
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = listStyle.rowMinHeight)
            .drawBehind { drawRect(background) }
            .then(clicks)
            .semantics(mergeDescendants = true) {
                if (isActive) stateDescription = nowPlaying
                val more = if (onMore != null) listOf(CustomAccessibilityAction(moreLabel) { onMore(); true }) else emptyList()
                if (more.isNotEmpty() || accessibilityActions.isNotEmpty()) customActions = more + accessibilityActions
            }
            .padding(
                start = if (leading != null) PlaylyTheme.spacing.xxs else PlaylyTheme.spacing.md,
                end = if (hasEndControls) PlaylyTheme.spacing.xxs else PlaylyTheme.spacing.md,
                top = listStyle.verticalPadding,
                bottom = listStyle.verticalPadding,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
    ) {
        leading?.invoke(this)
        val faded = if (dimmed) Modifier.alpha(DIMMED_ALPHA) else Modifier
        // "Covers in lists" off: the icon only, no image is decoded (big libraries scroll lighter).
        if (artwork != null && listStyle.showArtwork) {
            TrackArtwork(artwork, modifier = faded, size = listStyle.artSize, placeholderIcon = placeholderIcon)
        } else {
            ArtworkPlaceholder(modifier = faded, size = listStyle.artSize, icon = placeholderIcon)
        }
        Column(Modifier.weight(1f).then(faded)) {
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
            Text(trailingText, style = PlaylyTheme.typography.caption, color = colors.textMuted, modifier = faded)
        }
        trailing?.invoke(this)
        if (onMore != null) {
            PlaylyIconButton(R.drawable.ic_more_vert, moreLabel, onMore, tint = colors.textMuted)
        }
    }
}

private const val DIMMED_ALPHA = 0.45f
