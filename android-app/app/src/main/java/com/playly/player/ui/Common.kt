package com.playly.player.ui

import android.animation.ValueAnimator
import android.content.ActivityNotFoundException
import android.content.res.Resources
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

/**
 * A one-off message for the snackbar, resolved against resources at display time.
 * An argument may itself be a [UiMessage] (e.g. "<reason>. Playing the next track").
 * With [quantity], [text] is a plurals resource. [action] adds a button such as "Undo".
 */
data class UiMessage(
    val text: Int,
    val args: List<Any> = emptyList(),
    val quantity: Int? = null,
    val action: UiAction? = null,
) {
    constructor(@StringRes text: Int, arg: String) : this(text, listOf(arg))

    fun resolve(resources: Resources): String {
        val resolved = args.map { if (it is UiMessage) it.resolve(resources) else it }.toTypedArray()
        return if (quantity != null) resources.getQuantityString(text, quantity, *resolved) else resources.getString(text, *resolved)
    }
}

/**
 * App-wide messages for the shared snackbar, from screens that may close right after the
 * action (a deleted playlist's page). One collector: the root of the UI.
 */
class UiMessageBus {
    private val channel = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = channel.receiveAsFlow()

    suspend fun send(message: UiMessage) = channel.send(message)
}

/** A snackbar button; [run] is called only if the user taps it. */
data class UiAction(@StringRes val label: Int, val run: () -> Unit)

val LocalSnackbarHostState = staticCompositionLocalOf<SnackbarHostState> { error("No SnackbarHostState provided") }

/** Shows every message from [messages] in the shared snackbar while the screen is visible. */
@Composable
fun CollectMessages(messages: Flow<UiMessage>) {
    val snackbar = LocalSnackbarHostState.current
    // LocalResources tracks configuration changes (e.g. a language switch), unlike LocalContext.
    val resources = LocalResources.current
    LaunchedEffect(messages, resources) {
        messages.collect { message -> snackbar.show(message, resources) }
    }
}

/** Shows [message] and runs its action if tapped. Messages with an action stay a little longer. */
suspend fun SnackbarHostState.show(message: UiMessage, resources: Resources) {
    val action = message.action
    val result = showSnackbar(
        message = message.resolve(resources),
        actionLabel = action?.let { resources.getString(it.label) },
        duration = if (action != null) SnackbarDuration.Long else SnackbarDuration.Short,
    )
    if (result == SnackbarResult.ActionPerformed) action?.run?.invoke()
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

/**
 * Stage 9.2: the system "save as" dialog for one [mimeType]; call the result with the suggested
 * file name. [onPicked] gets the new document.
 */
@Composable
fun rememberCreateDocument(mimeType: String, onPicked: (Uri) -> Unit): (String) -> Unit {
    val latestOnPicked by rememberUpdatedState(onPicked)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mimeType)) { uri ->
        if (uri != null) latestOnPicked(uri)
    }
    val guard = rememberPickerGuard()
    return remember(launcher, guard) { { name: String -> guard { launcher.launch(name) } } }
}

/** Stage 9.2: the system "open" dialog limited to [mimeTypes]. */
@Composable
fun rememberOpenDocument(mimeTypes: Array<String>, onPicked: (Uri) -> Unit): () -> Unit {
    val latestOnPicked by rememberUpdatedState(onPicked)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) latestOnPicked(uri)
    }
    val guard = rememberPickerGuard()
    return remember(launcher, guard) { { guard { launcher.launch(mimeTypes) } } }
}

/** Runs a picker launch; a phone without the system file dialog gets a snackbar instead of a crash. */
@Composable
private fun rememberPickerGuard(): (() -> Unit) -> Unit {
    val snackbar = LocalSnackbarHostState.current
    val scope = rememberCoroutineScope()
    val unavailable = stringResource(R.string.message_picker_unavailable)
    return remember(snackbar, scope, unavailable) {
        { launch ->
            try {
                launch()
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
