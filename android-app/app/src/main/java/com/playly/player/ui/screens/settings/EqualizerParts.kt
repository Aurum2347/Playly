package com.playly.player.ui.screens.settings

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylySeekBar
import com.playly.player.playback.audio.Equalizer
import java.util.Locale
import kotlin.math.roundToInt

@StringRes
internal fun eqPresetLabel(id: String): Int = when (id) {
    "bass" -> R.string.eq_preset_bass
    "rock" -> R.string.eq_preset_rock
    "pop" -> R.string.eq_preset_pop
    "electronic" -> R.string.eq_preset_electronic
    "vocal" -> R.string.eq_preset_vocal
    "jazz" -> R.string.eq_preset_jazz
    "classic" -> R.string.eq_preset_classic
    "treble" -> R.string.eq_preset_treble
    Equalizer.CUSTOM -> R.string.eq_preset_custom
    else -> R.string.eq_preset_flat
}

/** "+3", "-1,5", "0": the band value without the unit, in the user's number format. */
internal fun formatDb(gain: Float, locale: Locale): String = when {
    gain == 0f -> "0"
    gain == gain.roundToInt().toFloat() -> String.format(locale, "%+d", gain.roundToInt())
    else -> String.format(locale, "%+.1f", gain)
}

internal fun dbToFraction(gain: Float) = (gain - Equalizer.MIN_DB) / (Equalizer.MAX_DB - Equalizer.MIN_DB)

internal fun fractionToDb(fraction: Float) = Equalizer.clampDb(Equalizer.MIN_DB + fraction * (Equalizer.MAX_DB - Equalizer.MIN_DB))

@Composable
internal fun EqPresetChip(label: String, chosen: Boolean, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    Box(
        Modifier
            .heightIn(min = PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .background(if (chosen) colors.accent else colors.surfaceRaised)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { selected = chosen }
            .padding(horizontal = PlaylyTheme.spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PlaylyTheme.typography.label, color = if (chosen) colors.onAccent else colors.textSecondary, maxLines = 1)
    }
}

/** One band: frequency, a horizontal slider over ±12 dB, the value. Applies on release. */
@Composable
internal fun EqBandRow(
    freq: Int,
    gain: Float,
    locale: Locale,
    onScrub: (Float) -> Unit,
    onSet: (Float) -> Unit,
) {
    val colors = PlaylyTheme.colors
    val value = formatDb(gain, locale)
    Row(
        Modifier.padding(horizontal = PlaylyTheme.spacing.page),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            Equalizer.bandLabel(freq),
            style = PlaylyTheme.typography.caption,
            color = colors.textMuted,
            modifier = Modifier.width(40.dp),
        )
        PlaylySeekBar(
            fraction = dbToFraction(gain),
            onScrub = { onScrub(fractionToDb(it)) },
            onSeek = { onSet(fractionToDb(it)) },
            contentDescription = stringResource(R.string.eq_band, freq.toString()),
            stateDescription = stringResource(R.string.eq_gain, value),
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            style = PlaylyTheme.typography.caption,
            color = if (gain == 0f) colors.textMuted else colors.textPrimary,
            textAlign = TextAlign.End,
            modifier = Modifier.width(44.dp),
        )
    }
}
