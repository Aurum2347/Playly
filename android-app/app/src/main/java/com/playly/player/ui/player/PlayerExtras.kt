package com.playly.player.ui.player

import android.os.SystemClock
import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylySeekBar
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.SheetAction
import com.playly.player.playback.PlaybackSpeed
import com.playly.player.playback.SleepTimer
import com.playly.player.playback.SleepTimerRules
import kotlinx.coroutines.delay

/**
 * The player's bottom panel (spec §10): playback speed and sleep timer, each a labelled pill that
 * shows its current value ("1,25×", "12:34"). Lyrics join it in stage 8.2.
 */
@Composable
internal fun PlayerExtrasRow(speed: Float, sleepTimer: SleepTimer?, onSpeed: () -> Unit, onSleepTimer: () -> Unit) {
    val locale = LocalConfiguration.current.locales[0]
    val speedLabel = PlaybackSpeed.label(speed, locale)
    val remaining = rememberSleepRemaining(sleepTimer)
    val timerLabel = when (sleepTimer) {
        null -> stringResource(R.string.sleep_timer)
        SleepTimer.EndOfTrack -> stringResource(R.string.sleep_timer_end_of_track)
        is SleepTimer.At -> formatRemaining(remaining)
    }
    val timerDescription = when (sleepTimer) {
        null -> stringResource(R.string.sleep_timer)
        SleepTimer.EndOfTrack -> stringResource(R.string.sleep_timer_active_end)
        is SleepTimer.At -> stringResource(R.string.sleep_timer_remaining, formatRemaining(remaining))
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ExtraPill(
            icon = R.drawable.ic_speed,
            label = if (PlaybackSpeed.isNormal(speed)) stringResource(R.string.player_speed) else speedLabel,
            active = !PlaybackSpeed.isNormal(speed),
            description = stringResource(R.string.player_speed_value, speedLabel),
            onClick = onSpeed,
        )
        ExtraPill(
            icon = R.drawable.ic_bedtime,
            label = timerLabel,
            active = sleepTimer != null,
            description = timerDescription,
            onClick = onSleepTimer,
        )
    }
}

/** Quiet when at its default, bright with a raised background when set. */
@Composable
private fun ExtraPill(@DrawableRes icon: Int, label: String, active: Boolean, description: String, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    val tint = if (active) colors.textPrimary else colors.textMuted
    Row(
        Modifier
            .heightIn(min = PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .background(if (active) colors.surfaceRaised else androidx.compose.ui.graphics.Color.Transparent)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = description }
            .padding(horizontal = PlaylyTheme.spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlaylyIcon(icon, contentDescription = null, tint = tint, size = 20.dp)
        Spacer(Modifier.width(PlaylyTheme.spacing.xs))
        Text(label, style = PlaylyTheme.typography.label, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Time left on a running timer, ticking once a second only while the screen is visible. The
 * service owns the timer; this only reads the shared elapsed-time clock.
 */
@Composable
internal fun rememberSleepRemaining(timer: SleepTimer?): Long {
    val at = timer as? SleepTimer.At ?: return 0L
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(at, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                now = SystemClock.elapsedRealtime()
                val left = at.remainingMs(now)
                if (left <= 0) break
                // Wake up right as the shown second changes.
                delay(left % 1000 + 1)
            }
        }
    }
    return at.remainingMs(now)
}

/** Rounded up, so the label never reads 0:00 while a second is still left. */
private fun formatRemaining(ms: Long): String = formatClock(((ms + 999) / 1000) * 1000)

/** What the sleep timer sheet can do; all of it goes to the playback service. */
internal class SleepTimerActions(
    val onStart: (minutes: Int) -> Unit,
    val onExtend: () -> Unit,
    val onEndOfTrack: () -> Unit,
    val onCancel: () -> Unit,
)

@Composable
private fun SheetHeading(text: String) {
    Text(
        text,
        style = PlaylyTheme.typography.sectionTitle,
        color = PlaylyTheme.colors.textPrimary,
        modifier = Modifier
            .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm)
            .semantics { heading() },
    )
}

@Composable
private fun SheetHint(text: String) {
    Text(
        text,
        style = PlaylyTheme.typography.caption,
        color = PlaylyTheme.colors.textMuted,
        modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm),
    )
}

/**
 * Playback speed (stage 8.1): a slider from 0.5× to 2× in 0.05 steps, the PC version's presets
 * and "Normal speed". The slider applies on release, so a drag sends one change, not dozens.
 */
@Composable
internal fun SpeedSheet(speed: Float, onSpeed: (Float) -> Unit, onDismiss: () -> Unit) {
    val colors = PlaylyTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    var scrub by remember { mutableStateOf<Float?>(null) }
    // Holds the chosen value until the player reports it, so the label never jumps back.
    var pending by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(speed) { pending = null }
    val shown = scrub?.let(PlaybackSpeed::fromFraction) ?: pending ?: PlaybackSpeed.snap(speed)
    val label = PlaybackSpeed.label(shown, locale)
    val choose: (Float) -> Unit = { value ->
        val snapped = PlaybackSpeed.snap(value)
        pending = snapped
        onSpeed(snapped)
    }
    PlaylySheet(onDismiss = onDismiss) { _ ->
        Column(Modifier.verticalScroll(rememberScrollState())) {
            SheetHeading(stringResource(R.string.speed_sheet_title))
            Text(
                label,
                style = PlaylyTheme.typography.pageTitle.copy(fontSize = 32.sp, lineHeight = 38.sp),
                color = colors.textPrimary,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Spacer(Modifier.height(PlaylyTheme.spacing.xs))
            PlaylySeekBar(
                fraction = PlaybackSpeed.fraction(shown),
                onScrub = { scrub = it },
                onSeek = { fraction ->
                    scrub = null
                    choose(PlaybackSpeed.fromFraction(fraction))
                },
                contentDescription = stringResource(R.string.speed_sheet_title),
                stateDescription = label,
                modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page),
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = PlaylyTheme.spacing.page - PlaylyTheme.spacing.xxs),
                horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xxs),
            ) {
                PlaybackSpeed.PRESETS.forEach { preset ->
                    val chosen = PlaybackSpeed.snap(preset) == shown
                    SpeedPreset(PlaybackSpeed.label(preset, locale), chosen, Modifier.weight(1f)) { choose(preset) }
                }
            }
            Spacer(Modifier.height(PlaylyTheme.spacing.sm))
            PlaylyButton(
                stringResource(R.string.speed_reset),
                onClick = { choose(PlaybackSpeed.NORMAL) },
                style = PlaylyButtonStyle.Secondary,
                enabled = !PlaybackSpeed.isNormal(shown),
                modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page),
            )
            SheetHint(stringResource(R.string.speed_hint))
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}

@Composable
private fun SpeedPreset(label: String, chosen: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    Box(
        modifier
            .heightIn(min = PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .background(if (chosen) colors.accent else colors.surfaceRaised)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { selected = chosen },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = PlaylyTheme.typography.label, color = if (chosen) colors.onAccent else colors.textSecondary, maxLines = 1)
    }
}

/**
 * Sleep timer (stage 8.1): the running timer with "+10 min" and "Turn off", then the lengths
 * and "End of track". Choosing one closes the sheet; the pill in the player shows the countdown.
 */
@Composable
internal fun SleepTimerSheet(timer: SleepTimer?, actions: SleepTimerActions, onDismiss: () -> Unit) {
    PlaylySheet(onDismiss = onDismiss) { close ->
        Column(Modifier.verticalScroll(rememberScrollState())) {
            SheetHeading(stringResource(R.string.sleep_timer))
            if (timer != null) {
                val remaining = rememberSleepRemaining(timer)
                val status = when (timer) {
                    SleepTimer.EndOfTrack -> stringResource(R.string.sleep_timer_active_end)
                    is SleepTimer.At -> stringResource(R.string.sleep_timer_active, formatRemaining(remaining))
                }
                Text(
                    status,
                    style = PlaylyTheme.typography.title,
                    color = PlaylyTheme.colors.textPrimary,
                    modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page),
                )
                Spacer(Modifier.height(PlaylyTheme.spacing.sm))
                Row(
                    Modifier.padding(horizontal = PlaylyTheme.spacing.page),
                    horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
                ) {
                    if (timer is SleepTimer.At) {
                        PlaylyButton(
                            stringResource(R.string.sleep_timer_extend, SleepTimerRules.EXTEND_MINUTES),
                            onClick = actions.onExtend,
                            style = PlaylyButtonStyle.Secondary,
                            icon = R.drawable.ic_add,
                        )
                    }
                    PlaylyButton(
                        stringResource(R.string.sleep_timer_cancel),
                        onClick = { close(actions.onCancel) },
                        style = PlaylyButtonStyle.Secondary,
                        icon = R.drawable.ic_close,
                    )
                }
                Spacer(Modifier.height(PlaylyTheme.spacing.xs))
            }
            SleepTimerRules.PRESET_MINUTES.forEach { minutes ->
                SheetAction(R.drawable.ic_bedtime, pluralStringResource(R.plurals.sleep_timer_minutes, minutes, minutes), onClick = {
                    close { actions.onStart(minutes) }
                })
            }
            SheetAction(R.drawable.ic_music_note, stringResource(R.string.sleep_timer_end_of_track), onClick = {
                close(actions.onEndOfTrack)
            })
            SheetHint(stringResource(R.string.sleep_timer_hint))
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
        }
    }
}
