package com.playly.player.ui

import android.animation.ValueAnimator
import android.content.ActivityNotFoundException
import android.content.res.Resources
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.playly.player.R
import com.playly.player.core.splitDuration
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/**
 * A one-off message for the snackbar, resolved against resources at display time.
 * An argument may itself be a [UiMessage] (e.g. "<reason>. Playing the next track").
 */
data class UiMessage(@StringRes val text: Int, val args: List<Any> = emptyList()) {
    constructor(@StringRes text: Int, arg: String) : this(text, listOf(arg))

    fun resolve(resources: Resources): String =
        resources.getString(text, *args.map { if (it is UiMessage) it.resolve(resources) else it }.toTypedArray())
}

val LocalSnackbarHostState = staticCompositionLocalOf<SnackbarHostState> { error("No SnackbarHostState provided") }

/** Shows every message from [messages] in the shared snackbar while the screen is visible. */
@Composable
fun CollectMessages(messages: Flow<UiMessage>) {
    val snackbar = LocalSnackbarHostState.current
    // LocalResources tracks configuration changes (e.g. a language switch), unlike LocalContext.
    val resources = LocalResources.current
    LaunchedEffect(messages, resources) {
        messages.collect { message ->
            snackbar.showSnackbar(message.resolve(resources))
        }
    }
}

/** Returns a launcher for the system folder picker (SAF). Reports devices without a picker. */
@Composable
fun rememberFolderPicker(onPicked: (Uri) -> Unit): () -> Unit {
    val snackbar = LocalSnackbarHostState.current
    val scope = rememberCoroutineScope()
    val unavailable = stringResource(R.string.message_picker_unavailable)
    val latestOnPicked by rememberUpdatedState(onPicked)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) latestOnPicked(uri)
    }
    return remember(launcher) {
        {
            try {
                launcher.launch(null)
            } catch (_: ActivityNotFoundException) {
                scope.launch { snackbar.showSnackbar(unavailable) }
            }
        }
    }
}

/** True when the system "remove animations" option is on. Re-read on every resume. */
@Composable
fun rememberSystemAnimationsDisabled(): Boolean {
    var disabled by remember { mutableStateOf(!ValueAnimator.areAnimatorsEnabled()) }
    LifecycleResumeEffect(Unit) {
        disabled = !ValueAnimator.areAnimatorsEnabled()
        onPauseOrDispose { }
    }
    return disabled
}

/** "12 треков · 3 ч 20 мин". */
@Composable
fun tracksSummaryLabel(count: Int, totalDurationMs: Long): String {
    val tracks = pluralStringResource(R.plurals.tracks_count, count, count)
    if (count == 0) return tracks
    return stringResource(R.string.summary_separator, tracks, durationLabel(totalDurationMs))
}

@Composable
fun durationLabel(totalMs: Long): String {
    val (hours, minutes) = splitDuration(totalMs)
    return if (hours > 0) stringResource(R.string.duration_hours_minutes, hours, minutes)
    else stringResource(R.string.duration_minutes, minutes)
}
