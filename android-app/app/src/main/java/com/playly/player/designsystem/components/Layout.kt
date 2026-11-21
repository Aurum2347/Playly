package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

/** Page header: optional back button, title, trailing actions. Handles the status bar inset. */
@Composable
fun PlaylyTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .defaultMinSize(minHeight = 64.dp)
            .padding(start = if (onBack != null) PlaylyTheme.spacing.xxs else PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xxs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            PlaylyIconButton(R.drawable.ic_back, androidx.compose.ui.res.stringResource(R.string.action_back), onBack)
            Spacer(Modifier.width(PlaylyTheme.spacing.xxs))
        }
        if (leading != null) {
            leading()
            Spacer(Modifier.width(PlaylyTheme.spacing.sm))
        }
        Text(
            text = title,
            style = if (onBack != null) PlaylyTheme.typography.sectionTitle else PlaylyTheme.typography.pageTitle,
            color = PlaylyTheme.colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        actions()
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        text = title,
        style = PlaylyTheme.typography.caption,
        color = PlaylyTheme.colors.textMuted,
        modifier = modifier
            .fillMaxWidth()
            .padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.page, top = PlaylyTheme.spacing.xl, bottom = PlaylyTheme.spacing.xs)
            .semantics { heading() },
    )
}

/** Grouped block of rows on a raised surface. */
@Composable
fun SettingsGroup(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .padding(horizontal = PlaylyTheme.spacing.md)
            .fillMaxWidth()
            .clip(PlaylyTheme.shapes.medium)
            .background(PlaylyTheme.colors.surface),
    ) { content() }
}

@Composable
fun SettingsRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    @DrawableRes icon: Int? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = PlaylyTheme.spacing.md, vertical = PlaylyTheme.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md),
    ) {
        if (icon != null) PlaylyIcon(icon, contentDescription = null, tint = PlaylyTheme.colors.textSecondary)
        Column(Modifier.weight(1f)) {
            Text(title, style = PlaylyTheme.typography.title, color = PlaylyTheme.colors.textPrimary)
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = PlaylyTheme.typography.subtitle, color = PlaylyTheme.colors.textMuted)
            }
        }
        if (trailing != null) trailing()
    }
}

@Composable
fun SettingsSwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
) {
    val colors = PlaylyTheme.colors
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            // toggleable (not clickable) so TalkBack announces the on/off state.
            .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = PlaylyTheme.spacing.md, vertical = PlaylyTheme.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.md),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = PlaylyTheme.typography.title, color = colors.textPrimary)
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textMuted)
            }
        }
        // The row handles clicks so the whole line is one accessible switch.
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = colors.onAccent,
                checkedTrackColor = colors.accent,
                uncheckedThumbColor = colors.textMuted,
                uncheckedTrackColor = colors.surfaceRaised,
                uncheckedBorderColor = colors.textFaint,
            ),
        )
    }
}

@Composable
fun RowDivider(modifier: Modifier = Modifier) {
    Box(
        modifier
            .padding(start = PlaylyTheme.spacing.md)
            .fillMaxWidth()
            .height(1.dp)
            .background(PlaylyTheme.colors.border),
    )
}

/** Square placeholder used wherever artwork is missing. */
@Composable
fun ArtworkPlaceholder(
    modifier: Modifier = Modifier,
    size: Dp = PlaylyTheme.spacing.listArt,
    @DrawableRes icon: Int = R.drawable.ic_music_note,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(PlaylyTheme.shapes.small)
            .background(PlaylyTheme.colors.surfaceRaised),
        contentAlignment = Alignment.Center,
    ) {
        PlaylyIcon(icon, contentDescription = null, tint = PlaylyTheme.colors.textFaint)
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    dangerous: Boolean = false,
) {
    val colors = PlaylyTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surfaceOverlay,
        titleContentColor = colors.textPrimary,
        textContentColor = colors.textSecondary,
        shape = PlaylyTheme.shapes.large,
        title = { Text(title, style = PlaylyTheme.typography.sectionTitle) },
        text = { Text(message, style = PlaylyTheme.typography.body) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, style = PlaylyTheme.typography.button, color = if (dangerous) colors.danger else colors.textPrimary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(androidx.compose.ui.res.stringResource(R.string.action_cancel), style = PlaylyTheme.typography.button, color = colors.textSecondary)
            }
        },
    )
}
