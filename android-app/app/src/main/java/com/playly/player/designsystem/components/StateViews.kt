package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

/** An action shown under an empty or error state. Only pass actions that really work. */
data class StateAction(val label: String, val onClick: () -> Unit, @DrawableRes val icon: Int? = null)

/** Calm, centred placeholder for screens without content. Scrolls when space is tight. */
@Composable
fun EmptyState(
    @DrawableRes icon: Int,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    primaryAction: StateAction? = null,
    secondaryAction: StateAction? = null,
) {
    StateLayout(modifier) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(PlaylyTheme.shapes.large)
                .background(PlaylyTheme.colors.surfaceRaised),
            contentAlignment = Alignment.Center,
        ) {
            PlaylyIcon(icon, contentDescription = null, tint = PlaylyTheme.colors.textSecondary, size = 32.dp)
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.lg))
        StateTexts(title, message)
        StateActions(primaryAction, secondaryAction)
    }
}

@Composable
fun LoadingState(message: String, modifier: Modifier = Modifier) {
    StateLayout(modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        CircularProgressIndicator(
            modifier = Modifier.size(32.dp),
            color = PlaylyTheme.colors.textSecondary,
            trackColor = PlaylyTheme.colors.surfaceRaised,
            strokeWidth = 3.dp,
        )
        Spacer(Modifier.height(PlaylyTheme.spacing.md))
        Text(
            text = message,
            style = PlaylyTheme.typography.subtitle,
            color = PlaylyTheme.colors.textMuted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
fun ErrorState(
    title: String,
    message: String,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    StateLayout(modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        PlaylyIcon(R.drawable.ic_error, contentDescription = null, tint = PlaylyTheme.colors.danger, size = 40.dp)
        Spacer(Modifier.height(PlaylyTheme.spacing.md))
        StateTexts(title, message)
        if (onRetry != null) StateActions(StateAction(androidx.compose.ui.res.stringResource(R.string.action_retry), onRetry), null)
    }
}

@Composable
private fun StateLayout(modifier: Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PlaylyTheme.spacing.xxl, vertical = PlaylyTheme.spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) { content() }
}

@Composable
private fun StateTexts(title: String, message: String) {
    Text(
        text = title,
        style = PlaylyTheme.typography.sectionTitle,
        color = PlaylyTheme.colors.textPrimary,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { heading() },
    )
    Spacer(Modifier.height(PlaylyTheme.spacing.xs))
    Text(
        text = message,
        style = PlaylyTheme.typography.subtitle,
        color = PlaylyTheme.colors.textMuted,
        textAlign = TextAlign.Center,
        modifier = Modifier.widthIn(max = 360.dp),
    )
}

@Composable
private fun StateActions(primary: StateAction?, secondary: StateAction?) {
    if (primary == null && secondary == null) return
    Spacer(Modifier.height(PlaylyTheme.spacing.xl))
    Column(
        modifier = Modifier.widthIn(max = 320.dp).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
    ) {
        if (primary != null) {
            PlaylyButton(primary.label, primary.onClick, Modifier.fillMaxWidth(), icon = primary.icon)
        }
        if (secondary != null) {
            PlaylyButton(secondary.label, secondary.onClick, Modifier.fillMaxWidth(), style = PlaylyButtonStyle.Secondary, icon = secondary.icon)
        }
    }
}

/** Small inline "work in progress" line (e.g. a rescan) that never blocks the content around it. */
@Composable
fun BackgroundTaskIndicator(label: String, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Row(
        modifier = modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(14.dp),
            color = PlaylyTheme.colors.textMuted,
            trackColor = PlaylyTheme.colors.surfaceRaised,
            strokeWidth = 2.dp,
        )
        Text(text = label, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
    }
}
