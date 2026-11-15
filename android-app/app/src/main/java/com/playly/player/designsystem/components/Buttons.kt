package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

@Composable
fun PlaylyIcon(
    @DrawableRes icon: Int,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = PlaylyTheme.colors.textPrimary,
    size: Dp = 24.dp,
) {
    Icon(
        painter = painterResource(icon),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        tint = tint,
    )
}

/** Icon-only action with a 48dp touch target. */
@Composable
fun PlaylyIconButton(
    @DrawableRes icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = PlaylyTheme.colors.textPrimary,
    iconSize: Dp = 24.dp,
    size: Dp = PlaylyTheme.spacing.minTouch,
) {
    val colors = PlaylyTheme.colors
    Box(
        modifier = modifier
            .size(size)
            .clip(PlaylyTheme.shapes.pill)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = contentDescription, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        PlaylyIcon(icon, contentDescription, tint = if (enabled) tint else colors.textFaint, size = iconSize)
    }
}

enum class PlaylyButtonStyle { Primary, Secondary, Text, Danger }

/** Pill button. Shrinks slightly while pressed unless motion is reduced. */
@Composable
fun PlaylyButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: PlaylyButtonStyle = PlaylyButtonStyle.Primary,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
) {
    val colors = PlaylyTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.97f else 1f,
        animationSpec = PlaylyTheme.motion.press(),
        label = "buttonScale",
    )
    val (container, content) = when (style) {
        PlaylyButtonStyle.Primary -> colors.accent to colors.onAccent
        PlaylyButtonStyle.Secondary -> colors.surfaceRaised to colors.textPrimary
        PlaylyButtonStyle.Text -> Color.Transparent to colors.textSecondary
        PlaylyButtonStyle.Danger -> colors.surfaceRaised to colors.danger
    }
    Row(
        modifier = modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .defaultMinSize(minHeight = PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .background(if (enabled) container else colors.surface)
            .clickable(
                interactionSource = interaction,
                indication = androidx.compose.foundation.LocalIndication.current,
                enabled = enabled,
                role = Role.Button,
                onClick = onClick,
            )
            .padding(horizontal = PlaylyTheme.spacing.lg, vertical = PlaylyTheme.spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val tint = if (enabled) content else colors.textFaint
        if (icon != null) PlaylyIcon(icon, contentDescription = null, tint = tint, size = 20.dp)
        Text(text = text, style = PlaylyTheme.typography.button, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The Playly brand mark (same artwork as the desktop and launcher icons). Decorative by default. */
@Composable
fun PlaylyLogo(modifier: Modifier = Modifier, size: Dp = 32.dp, contentDescription: String? = null) {
    Image(
        painter = painterResource(R.drawable.playly_logo),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
    )
}
