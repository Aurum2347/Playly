package com.playly.player.ui.screens.settings

import android.content.ActivityNotFoundException
import android.content.Intent
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.navigationBarsPadding
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
import com.playly.player.data.library.scan.LibraryFilter
import com.playly.player.data.settings.QueueEndAction
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.designsystem.components.RowDivider
import com.playly.player.designsystem.components.SectionHeader
import com.playly.player.designsystem.components.SettingsChoiceRow
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
    var equalizerOpen by rememberSaveable { mutableStateOf(false) }
    var confirmForget by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(title = stringResource(R.string.settings_title), onBack = onBack)
        val current = state
        if (current == null) {
            LoadingState(stringResource(R.string.state_loading_settings))
        } else LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = PlaylyTheme.spacing.xl),
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
                    RowDivider()
                    SettingsChoiceRow(
                        title = stringResource(R.string.settings_min_duration_title),
                        options = LibraryFilter.MIN_DURATION_CHOICES,
                        selected = current.minTrackSeconds,
                        label = { minDurationLabel(it) },
                        onSelect = viewModel::setMinTrackSeconds,
                    )
                    current.excludedFolders.forEach { path ->
                        RowDivider()
                        HiddenFolderRow(path, onShow = { viewModel.includeFolder(path) })
                    }
                    if (current.unavailableCount > 0) {
                        RowDivider()
                        SettingsRow(
                            title = stringResource(R.string.settings_forget_unavailable_title),
                            subtitle = pluralStringResource(
                                R.plurals.settings_forget_unavailable_subtitle,
                                current.unavailableCount,
                                current.unavailableCount,
                            ),
                            icon = R.drawable.ic_delete,
                            onClick = { confirmForget = true },
                        )
                    }
                }
            }

            item(key = "playback-header") { SectionHeader(stringResource(R.string.settings_section_playback)) }
            item(key = "playback") {
                val playback = current.playback
                SettingsGroup {
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_resume_title),
                        subtitle = stringResource(R.string.settings_resume_subtitle),
                        checked = playback.resumePosition,
                        onCheckedChange = viewModel::setResumePosition,
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_noisy_title),
                        subtitle = stringResource(R.string.settings_noisy_subtitle),
                        checked = playback.pauseOnNoisy,
                        onCheckedChange = viewModel::setPauseOnNoisy,
                    )
                    RowDivider()
                    SettingsChoiceRow(
                        title = stringResource(R.string.settings_queue_end_title),
                        options = QueueEndAction.entries,
                        selected = playback.queueEnd,
                        label = { stringResource(it.label) },
                        onSelect = viewModel::setQueueEnd,
                    )
                }
            }

            item(key = "sound-header") { SectionHeader(stringResource(R.string.settings_section_sound)) }
            item(key = "sound") {
                val sound = current.sound
                SettingsGroup {
                    SettingsRow(
                        title = stringResource(R.string.settings_eq_title),
                        subtitle = if (sound.eqEnabled) {
                            stringResource(R.string.settings_eq_on, stringResource(eqPresetLabel(sound.eqPreset)))
                        } else {
                            stringResource(R.string.settings_eq_off)
                        },
                        icon = R.drawable.ic_equalizer,
                        onClick = { equalizerOpen = true },
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_mono_title),
                        subtitle = stringResource(R.string.settings_mono_subtitle),
                        checked = sound.mono,
                        onCheckedChange = viewModel::setMonoAudio,
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_normalize_title),
                        subtitle = stringResource(R.string.settings_normalize_subtitle),
                        checked = sound.normalize,
                        onCheckedChange = viewModel::setNormalizeVolume,
                    )
                    RowDivider()
                    SettingsSwitchRow(
                        title = stringResource(R.string.settings_skip_silence_title),
                        subtitle = stringResource(R.string.settings_skip_silence_subtitle),
                        checked = sound.skipSilence,
                        onCheckedChange = viewModel::setSkipSilence,
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
            // Respects the inset consumed by the scaffold when the mini-player is under the page.
            item(key = "nav-inset") { Spacer(Modifier.navigationBarsPadding()) }
        }

        if (equalizerOpen && current != null) {
            EqualizerSheet(
                sound = current.sound,
                actions = EqualizerActions(
                    onEnabled = viewModel::setEqEnabled,
                    onPreset = viewModel::chooseEqPreset,
                    onBand = viewModel::setEqBand,
                    onReset = viewModel::resetEq,
                ),
                onDismiss = { equalizerOpen = false },
            )
        }

        val pending = current?.sources?.firstOrNull { it.source.id == pendingRemovalId }?.source
        if (confirmForget && current != null) {
            ConfirmDialog(
                title = stringResource(R.string.dialog_forget_unavailable_title),
                message = pluralStringResource(
                    R.plurals.dialog_forget_unavailable_message,
                    current.unavailableCount,
                    current.unavailableCount,
                ),
                confirmLabel = stringResource(R.string.action_forget),
                dangerous = true,
                onConfirm = {
                    confirmForget = false
                    viewModel.forgetUnavailable()
                },
                onDismiss = { confirmForget = false },
            )
        }
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

/** A folder hidden from the library (stage 9.1); the button puts it back. */
@Composable
private fun HiddenFolderRow(path: String, onShow: () -> Unit) {
    val name = path.substringAfterLast('/')
    SettingsRow(
        title = stringResource(R.string.settings_hidden_folder_title, name),
        subtitle = path,
        icon = R.drawable.ic_folder,
        trailing = {
            PlaylyButton(
                text = stringResource(R.string.action_show_folder),
                onClick = onShow,
                style = PlaylyButtonStyle.Text,
            )
        },
    )
}

@Composable
private fun minDurationLabel(seconds: Int): String =
    if (seconds <= 0) stringResource(R.string.settings_min_duration_off) else stringResource(R.string.settings_min_duration_value, seconds)

private val QueueEndAction.label: Int
    get() = when (this) {
        QueueEndAction.Stop -> R.string.settings_queue_end_stop
        QueueEndAction.Rewind -> R.string.settings_queue_end_rewind
    }
