package com.playly.player.ui.screens.settings

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.SettingsSwitchRow
import com.playly.player.playback.audio.Equalizer

/** What the equaliser sheet can change; all of it goes to the settings store. */
internal class EqualizerActions(
    val onEnabled: (Boolean) -> Unit,
    val onPreset: (String) -> Unit,
    val onBand: (band: Int, gainDb: Float) -> Unit,
    val onReset: () -> Unit,
)

/**
 * Equaliser (stage 8.3): on/off, presets, the user's own preset, 15 bands of ±12 dB. A slider
 * only moves its label while dragged; the sound changes once, on release.
 */
@Composable
internal fun EqualizerSheet(sound: SoundSettingsUi, actions: EqualizerActions, onDismiss: () -> Unit) {
    val colors = PlaylyTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    var scrub by remember { mutableStateOf<Pair<Int, Float>?>(null) }
    // Released values until the store reports them, so a slider never jumps back for a moment.
    val pending = remember { mutableStateMapOf<Int, Float>() }
    LaunchedEffect(sound.eqGains) { pending.clear() }
    PlaylySheet(onDismiss = onDismiss) { _ ->
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text(
                stringResource(R.string.eq_title),
                style = PlaylyTheme.typography.sectionTitle,
                color = colors.textPrimary,
                modifier = Modifier
                    .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm)
                    .semantics { heading() },
            )
            SettingsSwitchRow(
                title = stringResource(R.string.eq_enabled),
                checked = sound.eqEnabled,
                onCheckedChange = actions.onEnabled,
            )
            Text(
                stringResource(R.string.eq_presets),
                style = PlaylyTheme.typography.caption,
                color = colors.textMuted,
                modifier = Modifier
                    .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs)
                    .semantics { heading() },
            )
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = PlaylyTheme.spacing.page),
                horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
            ) {
                (Equalizer.PRESETS.map { it.id } + Equalizer.CUSTOM).forEach { id ->
                    EqPresetChip(stringResource(eqPresetLabel(id)), chosen = sound.eqPreset == id) { actions.onPreset(id) }
                }
            }
            Spacer(Modifier.height(PlaylyTheme.spacing.sm))
            Equalizer.BANDS.forEachIndexed { band, freq ->
                val gain = scrub?.takeIf { it.first == band }?.second ?: pending[band] ?: sound.eqGains[band]
                EqBandRow(
                    freq = freq,
                    gain = gain,
                    locale = locale,
                    onScrub = { scrub = band to it },
                    onSet = { value ->
                        scrub = null
                        pending[band] = value
                        actions.onBand(band, value)
                    },
                )
            }
            Spacer(Modifier.height(PlaylyTheme.spacing.sm))
            PlaylyButton(
                stringResource(R.string.eq_reset),
                onClick = actions.onReset,
                style = PlaylyButtonStyle.Secondary,
                enabled = sound.eqGains.any { it != 0f },
                modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page),
            )
            Text(
                stringResource(R.string.eq_hint),
                style = PlaylyTheme.typography.caption,
                color = colors.textMuted,
                modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
            )
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}
