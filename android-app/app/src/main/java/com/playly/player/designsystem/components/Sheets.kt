package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.playly.player.data.artwork.Artwork
import com.playly.player.designsystem.PlaylyTheme
import kotlinx.coroutines.launch

/**
 * Closes the sheet with its slide-down animation, then runs [then] (open the next sheet, start
 * an activity). Calling it twice is harmless.
 */
typealias SheetCloser = (then: () -> Unit) -> Unit

/**
 * Playly's bottom sheet: dark raised surface, drag handle, scrim, system back and swipe to close.
 * The caller owns a single "which sheet is open" state, so a second tap can never stack a
 * duplicate window (spec §12).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylySheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.(close: SheetCloser) -> Unit,
) {
    val colors = PlaylyTheme.colors
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val latestDismiss = rememberUpdatedState(onDismiss)
    val close: SheetCloser = remember(state, scope) {
        { then ->
            scope.launch { state.hide() }.invokeOnCompletion {
                latestDismiss.value()
                then()
            }
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = state,
        shape = SheetShape,
        containerColor = colors.surfaceOverlay,
        contentColor = colors.textPrimary,
        tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = 0.55f),
        dragHandle = { SheetHandle() },
    ) {
        content(close)
    }
}

@Composable
private fun SheetHandle() {
    Box(
        Modifier
            .padding(top = PlaylyTheme.spacing.xs, bottom = PlaylyTheme.spacing.xxs)
            .size(width = 36.dp, height = 4.dp)
            .clip(PlaylyTheme.shapes.pill)
            .background(PlaylyTheme.colors.textFaint),
    )
}

/** Sheet header for a track: cover, title (up to two lines) and artist. */
@Composable
fun SheetTrackHeader(title: String, subtitle: String?, artwork: Artwork?, modifier: Modifier = Modifier) {
    val colors = PlaylyTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
    ) {
        TrackArtwork(artwork, size = 56.dp)
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) { heading() }) {
            Text(title, style = PlaylyTheme.typography.title, color = colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** One action row of a sheet: icon and label, a full-width 56dp touch target. */
@Composable
fun SheetAction(@DrawableRes icon: Int, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = PlaylyTheme.spacing.page),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md),
    ) {
        PlaylyIcon(icon, contentDescription = null, tint = PlaylyTheme.colors.textSecondary)
        Text(label, style = PlaylyTheme.typography.body, color = PlaylyTheme.colors.textPrimary)
    }
}

private val SheetShape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
