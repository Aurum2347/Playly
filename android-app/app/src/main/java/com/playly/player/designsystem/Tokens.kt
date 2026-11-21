package com.playly.player.designsystem

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Monochrome dark palette, taken from the desktop CSS variables (src/index.css). */
@Immutable
data class PlaylyColors(
    val background: Color = Color(0xFF0A0A0C),
    val surface: Color = Color(0xFF141417),
    val surfaceRaised: Color = Color(0xFF1C1C20),
    val surfaceOverlay: Color = Color(0xFF1E1E22),
    val border: Color = Color(0x14FFFFFF),
    val pressed: Color = Color(0x0FFFFFFF),
    val selected: Color = Color(0x14FFFFFF),
    val textPrimary: Color = Color(0xFFF0F0F0),
    val textSecondary: Color = Color(0xFFC8C8CE),
    val textMuted: Color = Color(0xFF8A8A90),
    val textFaint: Color = Color(0xFF6A6A72),
    /** The single configurable accent; neutral by default, like the desktop. */
    val accent: Color = Color(0xFFF0F0F0),
    val onAccent: Color = Color(0xFF0A0A0C),
    val danger: Color = Color(0xFFFF6B6B),
    val success: Color = Color(0xFF7EE0A3),
)

/** Type scale. Sizes are in sp so system font scaling applies. */
@Immutable
data class PlaylyTypography(
    val pageTitle: TextStyle = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    val sectionTitle: TextStyle = TextStyle(fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    val title: TextStyle = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    val body: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Normal),
    val subtitle: TextStyle = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal),
    val label: TextStyle = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    val button: TextStyle = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    val caption: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    val navLabel: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
)

/** 8dp grid with 4dp half-steps. */
@Immutable
data class PlaylySpacing(
    val xxs: Dp = 4.dp,
    val xs: Dp = 8.dp,
    val sm: Dp = 12.dp,
    val md: Dp = 16.dp,
    val lg: Dp = 20.dp,
    val xl: Dp = 24.dp,
    val xxl: Dp = 32.dp,
    val xxxl: Dp = 48.dp,
    /** Horizontal page margin (spec: 16–20dp). */
    val page: Dp = 20.dp,
    val minTouch: Dp = 48.dp,
    val listArt: Dp = 52.dp,
    val bottomBarHeight: Dp = 64.dp,
)

@Immutable
data class PlaylyShapes(
    val small: RoundedCornerShape = RoundedCornerShape(12.dp),
    val medium: RoundedCornerShape = RoundedCornerShape(16.dp),
    val large: RoundedCornerShape = RoundedCornerShape(20.dp),
    val pill: RoundedCornerShape = RoundedCornerShape(percent = 50),
)

/**
 * Durations and curves. When [reduced] is true every spec collapses to an instant change,
 * so components never need their own "reduce motion" branches.
 */
@Immutable
data class PlaylyMotion(val reduced: Boolean = false) {
    fun <T> press(): FiniteAnimationSpec<T> = spec(DURATION_SHORT, Standard)
    fun <T> standard(): FiniteAnimationSpec<T> = spec(DURATION_MEDIUM, Standard)
    fun <T> enter(): FiniteAnimationSpec<T> = spec(DURATION_MEDIUM, EmphasizedDecelerate)
    fun <T> exit(): FiniteAnimationSpec<T> = spec(DURATION_EXIT, EmphasizedAccelerate)
    fun <T> expand(): FiniteAnimationSpec<T> = spec(DURATION_LONG, Standard)

    private fun <T> spec(durationMs: Int, easing: Easing): FiniteAnimationSpec<T> =
        if (reduced) snap() else tween(durationMillis = durationMs, easing = easing)

    companion object {
        const val DURATION_SHORT = 120
        const val DURATION_EXIT = 180
        const val DURATION_MEDIUM = 220
        const val DURATION_LONG = 280
        val Standard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
        val EmphasizedDecelerate: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
        val EmphasizedAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
    }
}

/** Stage 9.3: list rows as the user set them (Settings → Appearance). */
@Immutable
data class PlaylyListStyle(val compact: Boolean = false, val showArtwork: Boolean = true) {
    val rowMinHeight: Dp get() = if (compact) 52.dp else 64.dp
    val artSize: Dp get() = if (compact) 40.dp else 52.dp
    val verticalPadding: Dp get() = if (compact) 4.dp else 8.dp
}
