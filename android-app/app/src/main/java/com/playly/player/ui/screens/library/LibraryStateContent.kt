package com.playly.player.ui.screens.library

import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.data.library.LibraryContent
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.ErrorState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.StateAction
import com.playly.player.ui.rememberFolderPicker

/** Loading / no folder / not scanned / scanning / empty / error / content, with one shared look. */
@Composable
fun LibraryStateContent(
    state: LibraryUiState,
    onRetry: () -> Unit,
    onRescan: () -> Unit,
    onFolderPicked: (Uri) -> Unit,
    modifier: Modifier = Modifier,
    tracks: @Composable (LibraryContent.Tracks) -> Unit,
) {
    val pickFolder = rememberFolderPicker(onFolderPicked)
    val folderAction = StateAction(stringResource(R.string.action_pick_folder), pickFolder, R.drawable.ic_folder)
    val changeFolderAction = StateAction(stringResource(R.string.action_change_folder), pickFolder, R.drawable.ic_folder)
    val rescanAction = StateAction(stringResource(R.string.action_rescan), onRescan, R.drawable.ic_refresh)
    val motion = PlaylyTheme.motion
    AnimatedContent(
        targetState = state,
        contentKey = { if (it is LibraryUiState.Ready) it.content::class else it::class },
        transitionSpec = { fadeIn(motion.standard()) togetherWith fadeOut(motion.exit()) },
        modifier = modifier.fillMaxSize(),
        label = "libraryState",
    ) { current ->
        when (current) {
            LibraryUiState.Loading -> LoadingState(stringResource(R.string.state_loading_library))
            LibraryUiState.Error -> ErrorState(
                title = stringResource(R.string.state_error_title),
                message = stringResource(R.string.state_error_library),
                onRetry = onRetry,
            )
            is LibraryUiState.Ready -> when (val content = current.content) {
                LibraryContent.NoFolder -> EmptyState(
                    icon = R.drawable.ic_folder,
                    title = stringResource(R.string.state_no_folder_title),
                    message = stringResource(R.string.state_no_folder_message),
                    primaryAction = folderAction,
                )
                LibraryContent.NotScanned -> EmptyState(
                    icon = R.drawable.ic_music_note,
                    title = stringResource(R.string.state_not_scanned_title),
                    message = stringResource(R.string.state_not_scanned_message),
                    primaryAction = rescanAction,
                    secondaryAction = changeFolderAction,
                )
                LibraryContent.Scanning -> LoadingState(stringResource(R.string.state_scanning))
                LibraryContent.Empty -> EmptyState(
                    icon = R.drawable.ic_music_note,
                    title = stringResource(R.string.state_empty_title),
                    message = stringResource(R.string.state_empty_message),
                    primaryAction = changeFolderAction,
                    secondaryAction = rescanAction,
                )
                LibraryContent.ScanFailed -> ErrorState(
                    title = stringResource(R.string.state_error_title),
                    message = stringResource(R.string.state_scan_failed),
                    onRetry = onRescan,
                )
                is LibraryContent.Tracks -> tracks(content)
            }
        }
    }
}
