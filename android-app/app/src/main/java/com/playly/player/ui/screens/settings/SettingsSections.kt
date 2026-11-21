package com.playly.player.ui.screens.settings

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.playly.player.BuildConfig
import com.playly.player.R
import com.playly.player.data.settings.AccentChoice
import com.playly.player.data.settings.ListDensity
import com.playly.player.designsystem.components.RowDivider
import com.playly.player.designsystem.components.SettingsChoiceRow
import com.playly.player.designsystem.components.SettingsGroup
import com.playly.player.designsystem.components.SettingsRow
import com.playly.player.designsystem.components.SettingsSwitchRow

/** Stage 9.3: accent, list density and covers in lists, under the existing appearance rows. */
@Composable
fun AppearanceRows(appearance: AppearanceSettingsUi, viewModel: SettingsViewModel) {
    RowDivider()
    SettingsChoiceRow(
        title = stringResource(R.string.settings_accent_title),
        options = AccentChoice.entries,
        selected = appearance.accent,
        label = { stringResource(it.label) },
        onSelect = viewModel::setAccent,
    )
    RowDivider()
    SettingsChoiceRow(
        title = stringResource(R.string.settings_density_title),
        options = ListDensity.entries,
        selected = appearance.listDensity,
        label = { stringResource(if (it == ListDensity.Compact) R.string.density_compact else R.string.density_comfortable) },
        onSelect = viewModel::setListDensity,
    )
    RowDivider()
    SettingsSwitchRow(
        title = stringResource(R.string.settings_list_artwork_title),
        subtitle = stringResource(R.string.settings_list_artwork_subtitle),
        checked = appearance.listArtwork,
        onCheckedChange = viewModel::setListArtwork,
    )
}

private val AccentChoice.label: Int
    get() = when (this) {
        AccentChoice.Neutral -> R.string.accent_neutral
        AccentChoice.Blue -> R.string.accent_blue
        AccentChoice.Green -> R.string.accent_green
        AccentChoice.Violet -> R.string.accent_violet
        AccentChoice.Orange -> R.string.accent_orange
        AccentChoice.Pink -> R.string.accent_pink
    }

/** Stage 9.3: what happens in the background, with hints instead of system prompts. */
@Composable
fun BackgroundGroup(keepPlayingOnSwipe: Boolean, status: BackgroundStatus, viewModel: SettingsViewModel) {
    val context = LocalContext.current
    SettingsGroup {
        SettingsSwitchRow(
            title = stringResource(R.string.settings_keep_playing_title),
            subtitle = stringResource(R.string.settings_keep_playing_subtitle),
            checked = keepPlayingOnSwipe,
            onCheckedChange = viewModel::setKeepPlayingOnSwipe,
        )
        RowDivider()
        SettingsRow(
            title = stringResource(R.string.settings_battery_title),
            subtitle = stringResource(
                when (status.battery) {
                    BatteryMode.Unrestricted -> R.string.settings_battery_unrestricted
                    BatteryMode.Optimized -> R.string.settings_battery_optimized
                    BatteryMode.Restricted -> R.string.settings_battery_restricted
                },
            ),
            icon = R.drawable.ic_battery,
            onClick = { openAppDetails(context) },
        )
        if (!status.notificationsEnabled) {
            RowDivider()
            SettingsRow(
                title = stringResource(R.string.settings_notifications_off_title),
                subtitle = stringResource(R.string.settings_notifications_off_subtitle),
                icon = R.drawable.ic_notifications_off,
                onClick = { openNotificationSettings(context) },
            )
        }
    }
}

/** Build type, Android version and device: what a bug report needs. */
@Composable
fun BuildRow() {
    SettingsRow(
        title = stringResource(R.string.settings_build_title),
        subtitle = stringResource(
            R.string.settings_build_value,
            BuildConfig.BUILD_TYPE,
            Build.VERSION.RELEASE,
            Build.VERSION.SDK_INT,
            "${Build.MANUFACTURER} ${Build.MODEL}",
        ),
    )
}

/** Stage 9.3: licenses and the local error log, at the end of "About". */
@Composable
fun AboutRows(errorCount: Int, onOpenErrorLog: () -> Unit, onOpenLicenses: () -> Unit) {
    RowDivider()
    SettingsRow(
        title = stringResource(R.string.settings_licenses_title),
        subtitle = stringResource(R.string.settings_licenses_subtitle),
        icon = R.drawable.ic_description,
        onClick = onOpenLicenses,
    )
    RowDivider()
    SettingsRow(
        title = stringResource(R.string.settings_error_log_title),
        subtitle = if (errorCount == 0) {
            stringResource(R.string.settings_error_log_empty)
        } else {
            pluralStringResource(R.plurals.settings_error_log_count, errorCount, errorCount)
        },
        icon = R.drawable.ic_bug_report,
        onClick = onOpenErrorLog,
    )
}
