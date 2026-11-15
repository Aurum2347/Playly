package com.playly.player.designsystem

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf

val LocalPlaylyColors = staticCompositionLocalOf { PlaylyColors() }
val LocalPlaylyTypography = staticCompositionLocalOf { PlaylyTypography() }
val LocalPlaylySpacing = staticCompositionLocalOf { PlaylySpacing() }
val LocalPlaylyShapes = staticCompositionLocalOf { PlaylyShapes() }
val LocalPlaylyMotion = staticCompositionLocalOf { PlaylyMotion() }

object PlaylyTheme {
    val colors: PlaylyColors @Composable @ReadOnlyComposable get() = LocalPlaylyColors.current
    val typography: PlaylyTypography @Composable @ReadOnlyComposable get() = LocalPlaylyTypography.current
    val spacing: PlaylySpacing @Composable @ReadOnlyComposable get() = LocalPlaylySpacing.current
    val shapes: PlaylyShapes @Composable @ReadOnlyComposable get() = LocalPlaylyShapes.current
    val motion: PlaylyMotion @Composable @ReadOnlyComposable get() = LocalPlaylyMotion.current
}

/**
 * Playly's own design system. Material 3 is kept underneath only so stock widgets
 * (text fields, switches, dialogs, snackbars) pick up the same monochrome palette.
 */
@Composable
fun PlaylyTheme(reduceMotion: Boolean = false, content: @Composable () -> Unit) {
    val colors = remember { PlaylyColors() }
    val typography = remember { PlaylyTypography() }
    val motion = remember(reduceMotion) { PlaylyMotion(reduced = reduceMotion) }
    val scheme = remember(colors) {
        darkColorScheme(
            primary = colors.accent,
            onPrimary = colors.onAccent,
            primaryContainer = colors.surfaceRaised,
            onPrimaryContainer = colors.textPrimary,
            secondary = colors.textSecondary,
            onSecondary = colors.background,
            secondaryContainer = colors.surfaceRaised,
            onSecondaryContainer = colors.textPrimary,
            background = colors.background,
            onBackground = colors.textPrimary,
            surface = colors.background,
            onSurface = colors.textPrimary,
            surfaceVariant = colors.surface,
            onSurfaceVariant = colors.textMuted,
            surfaceContainerLowest = colors.background,
            surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface,
            surfaceContainerHigh = colors.surfaceRaised,
            surfaceContainerHighest = colors.surfaceOverlay,
            inverseSurface = colors.textPrimary,
            inverseOnSurface = colors.background,
            outline = colors.textFaint,
            outlineVariant = colors.border,
            error = colors.danger,
            onError = colors.background,
        )
    }
    val materialType = remember(typography) {
        Typography(
            headlineSmall = typography.pageTitle,
            titleLarge = typography.sectionTitle,
            titleMedium = typography.title,
            bodyLarge = typography.body,
            bodyMedium = typography.subtitle,
            labelLarge = typography.button,
            labelMedium = typography.caption,
        )
    }
    MaterialTheme(colorScheme = scheme, typography = materialType) {
        CompositionLocalProvider(
            LocalPlaylyColors provides colors,
            LocalPlaylyTypography provides typography,
            LocalPlaylySpacing provides PlaylySpacing(),
            LocalPlaylyShapes provides PlaylyShapes(),
            LocalPlaylyMotion provides motion,
            LocalIndication provides ripple(color = colors.textPrimary),
            LocalTextSelectionColors provides TextSelectionColors(
                handleColor = colors.accent,
                backgroundColor = colors.accent.copy(alpha = 0.25f),
            ),
            content = content,
        )
    }
}
