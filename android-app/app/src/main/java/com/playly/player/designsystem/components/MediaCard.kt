package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme

/**
 * Card for horizontal shelves (Home): square cover, title, one caption line.
 * The whole card is one touch target; [isActive] marks the current track like [MediaRow] does.
 * [onLongClick] opens the item's menu (also offered to TalkBack as [longClickLabel]).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaCard(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    artwork: Artwork? = null,
    @DrawableRes placeholderIcon: Int = R.drawable.ic_music_note,
    isActive: Boolean = false,
    width: Dp = CARD_WIDTH,
    onLongClick: (() -> Unit)? = null,
    longClickLabel: String? = null,
) {
    val colors = PlaylyTheme.colors
    val nowPlaying = stringResource(R.string.playback_now_playing)
    Column(
        modifier = modifier
            .width(width + PADDING * 2)
            .clip(PlaylyTheme.shapes.medium)
            .combinedClickable(role = Role.Button, onLongClick = onLongClick, onLongClickLabel = longClickLabel, onClick = onClick)
            .semantics(mergeDescendants = true) {
                if (isActive) stateDescription = nowPlaying
                if (onLongClick != null && longClickLabel != null) {
                    customActions = listOf(CustomAccessibilityAction(longClickLabel) { onLongClick(); true })
                }
            }
            .padding(PADDING),
    ) {
        TrackArtwork(
            artwork = artwork,
            size = width,
            placeholderIcon = placeholderIcon,
            shape = PlaylyTheme.shapes.medium,
            iconSize = 40.dp,
        )
        Spacer(Modifier.height(PlaylyTheme.spacing.xs))
        Text(
            title,
            style = if (isActive) PlaylyTheme.typography.label.copy(fontWeight = FontWeight.SemiBold) else PlaylyTheme.typography.label,
            color = colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (!subtitle.isNullOrBlank()) {
            Text(subtitle, style = PlaylyTheme.typography.caption, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

private val CARD_WIDTH = 136.dp
private val PADDING = 4.dp
