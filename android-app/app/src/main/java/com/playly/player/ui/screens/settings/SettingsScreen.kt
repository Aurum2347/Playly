package com.playly.player.ui.screens.settings

import android.content.ActivityNotFoundException
import android.content.Intent
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.BuildConfig
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.designsystem.components.RowDivider
import com.playly.player.designsystem.components.SectionHeader
import com.playly.player.designsystem.components.SettingsGroup
import com.playly.player.designsystem.components.SettingsRow
import com.playly.player.designsystem.components.SettingsSwitchRow
import com.playly.player.ui.CollectMessages
import com.playly.player.ui.LocalSnackbarHostState
import com.playly.player.ui.rememberFolderPicker
import kotlinx.coroutines.launch

private const val SOURCE_URL = "https://github.com/Aurum2347/Playly"

/** Only settings that actually work today; each later stage adds its own section. */
@Composable
fun SettingsScreen(onBack: () -> Unit, viewModel: SettingsViewModel = viewModel(factory = SettingsViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val progress by viewModel.scanProgress.collectAsStateWithLifecycle()
    CollectMessages(viewModel.messages)
    val context = LocalContext.current
    val snackbar = LocalSnackbarHostState.current
    val scope = rememberCoroutineScope()
    val noBrowser = stringResource(R.string.message_no_browser)
    val pickFolder = rememberFolderPicker(viewModel::addSource)
    var pendingRemovalId by rememberSaveable { mutableStateOf<Long?>(null) }

    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(title = stringResource(R.string.settings_title), onBack = onBack)
        val current = state
        if (current == null) {
            LoadingState(stringResource(R.string.state_loading_settings))
        } else LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + PlaylyTheme.spacing.xl),
        ) {
            item(key = "library-header") { SectionHeader(stringResource(R.string.settings_section_library)) }
            item(key = "library") {
                SettingsGroup {
                    // One music folder, like the desktop app. Tapping a lost one re-picks it.
                    current.sources.forEach { (source, folderTracks) ->
                        SettingsRow(
                            title = stringResource(R.string.settings_folder_title),
                            subtitle = if (source.isAccessible) {
                                stringResource(
                                    R.string.summary_separator,
                                    source.displayName,
                                    pluralStringResource(R.plurals.tracks_count, folderTracks, folderTracks),
                                )
                            } else {
                                stringResource(R.string.settings_folder_inaccessible, source.displayName)
                            },
                            icon = if (source.isAccessible) R.drawable.ic_folder else R.drawable.ic_error,
                            onClick = if (source.isAccessible) null else pickFolder,
                            trailing = {
                                PlaylyIconButton(
                                    icon = R.drawable.ic_delete,
                                    contentDescription = stringResource(R.string.action_remove_folder, source.displayName),
                                    onClick = { pendingRemovalId = source.id },
                                    tint = PlaylyTheme.colors.textSecondary,
                                )
                            },
                        )
                        RowDivider()
                    }
                    SettingsRow(
                        title = stringResource(if (current.sources.isEmpty()) R.string.action_pick_folder else R.string.action_change_folder),
                        subtitle = stringResource(
                            if (current.sources.isEmpty()) R.string.settings_pick_folder_subtitle else R.string.settings_change_folder_subtitle,
                        ),
                        icon = if (current.sources.isEmpty()) R.drawable.ic_add else R.drawable.ic_folder,
                        onClick = pickFolder,
                    )
                    RowDivider()
                    SettingsRow(
                        title = stringResource(R.string.action_rescan),
                        subtitle = when {
                            progress != null -> stringResource(R.string.state_scanning_found, progress?.found ?: 0)
                            current.lastScanAt != null -> {
                                val now = System.currentTimeMillis()
                                // DateUtils renders anything under a minute as "0 minutes ago".
                                if (now - current.lastScanAt < DateUtils.MINUTE_IN_MILLIS) {
                                    stringResource(R.string.settings_rescan_subtitle_just_now)
                                } else {
                                    stringResource(
                                        R.string.settings_rescan_subtitle_last,
                                        DateUtils.getRelativeTimeSpanString(current.lastScanAt, now, DateUtils.MINUTE_IN_MILLIS).toString(),
                                    )
                                }
                            }
                            else -> stringResource(R.string.settings_rescan_subtitle_never)
                        },
                        icon = R.drawable.ic_refresh,
                        onClick = viewModel::rescan,
                    )
                    RowDivider()
                    val tracksLabel = pluralStringResource(R.plurals.tracks_count, current.trackCount, current.trackCount)
                    SettingsRow(
                        title = stringResource(R.string.settings_stats_title),
                        subtitle = if (current.unavailableCount > 0) {
                            stringResource(R.string.settings_stats_unavailable, tracksLabel, current.unavailableCount)
                        } else {
                            tracksLabel
                        },
                        icon = R.drawable.ic_music_note,
                    )
                }
            }

            item(key = "appearance-header") { SectionHeader(stringResource(R.string.settings_section_appearance)) }
            item(key = "appearance") {
                SettingsGroup {
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_reduce_motion_title),
                        subtitle = stringResource(R.string.settings_reduce_motion_subtitle),
                        checked = current.reduceMotion,
                        onCheckedChange = viewModel::setReduceMotion,
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_open_player_title),
                        subtitle = stringResource(R.string.settings_open_player_subtitle),
                        checked = current.openPlayerOnPlay,
                        onCheckedChange = viewModel::setOpenPlayerOnPlay,
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_player_tint_title),
                        subtitle = stringResource(R.string.settings_player_tint_subtitle),
                        checked = current.playerArtworkTint,
                        onCheckedChange = viewModel::setPlayerArtworkTint,
                    )
                }
            }

            item(key = "about-header") { SectionHeader(stringResource(R.string.settings_section_about)) }
            item(key = "about") {
                SettingsGroup {
                    SettingsRow(
                        title = stringResource(R.string.settings_version_title),
                        subtitle = stringResource(R.string.settings_version_value, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    )
                    RowDivider()
                    SettingsRow(
                        title = stringResource(R.string.settings_offline_title),
                        subtitle = stringResource(R.string.settings_offline_subtitle),
                    )
                    RowDivider()
                    SettingsRow(
                        title = stringResource(R.string.settings_source_title),
                        subtitle = SOURCE_URL.removePrefix("https://"),
                        icon = R.drawable.ic_chevron_right,
                        onClick = {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, SOURCE_URL.toUri()))
                            } catch (_: ActivityNotFoundException) {
                                scope.launch { snackbar.showSnackbar(noBrowser) }
                            }
                        },
                    )
                }
            }
        }

        val pending = current?.sources?.firstOrNull { it.source.id == pendingRemovalId }?.source
        if (pending != null) {
            ConfirmDialog(
                title = stringResource(R.string.dialog_remove_folder_title),
                message = stringResource(R.string.dialog_remove_folder_message, pending.displayName),
                confirmLabel = stringResource(R.string.action_remove),
                dangerous = true,
                onConfirm = {
                    pendingRemovalId = null
                    viewModel.removeSource(pending)
                },
                onDismiss = { pendingRemovalId = null },
            )
        }
    }
}

