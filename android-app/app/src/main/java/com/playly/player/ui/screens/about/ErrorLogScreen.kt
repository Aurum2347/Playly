package com.playly.player.ui.screens.about

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playly.player.BuildConfig
import com.playly.player.R
import com.playly.player.core.ErrorLog
import com.playly.player.core.ErrorLogEntry
import com.playly.player.core.ErrorLogFormat
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.ConfirmDialog
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.LoadingState
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylyTopBar
import com.playly.player.ui.LocalSnackbarHostState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** A share intent carries the text through a Binder transaction: stay well under its limit. */
private const val SHARE_MAX_CHARS = 60_000

class ErrorLogViewModel : ViewModel() {
    /** Newest first; null while the file is read. */
    val entries: StateFlow<List<ErrorLogEntry>?> = ErrorLog.version
        .map { withContext(Dispatchers.IO) { ErrorLog.entries() } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun clear() {
        viewModelScope.launch(Dispatchers.IO) { ErrorLog.clear() }
    }
}

/** "Playly 0.9.0 (9) debug · Android 16 (API 36) · Google Pixel 8": what a bug report needs. */
fun buildSummary(): String =
    "Playly ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) ${BuildConfig.BUILD_TYPE}\n" +
        "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL}"

private fun timeLabel(ms: Long): String = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(Date(ms))

private fun share(context: Context, entries: List<ErrorLogEntry>) {
    val text = ErrorLogFormat.report(buildSummary(), entries, SHARE_MAX_CHARS, ::timeLabel)
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.error_log_share_subject))
        .putExtra(Intent.EXTRA_TEXT, text)
    try {
        context.startActivity(Intent.createChooser(send, context.getString(R.string.action_share)))
    } catch (_: ActivityNotFoundException) {
        // Nothing can receive text: the log stays readable on screen.
    }
}

/** Stage 9.3: the local error log (Settings → About). */
@Composable
fun ErrorLogScreen(onBack: () -> Unit, viewModel: ErrorLogViewModel = viewModel()) {
    val entries by viewModel.entries.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var confirmClear by rememberSaveable { mutableStateOf(false) }
    val snackbar = LocalSnackbarHostState.current
    val scope = rememberCoroutineScope()
    val clearedMessage = stringResource(R.string.message_log_cleared)
    val current = entries

    Column(Modifier.fillMaxSize()) {
        PlaylyTopBar(
            title = stringResource(R.string.settings_error_log_title),
            onBack = onBack,
            actions = {
                if (!current.isNullOrEmpty()) {
                    PlaylyIconButton(R.drawable.ic_share, stringResource(R.string.action_share), { share(context, current) })
                    PlaylyIconButton(R.drawable.ic_delete, stringResource(R.string.action_clear), { confirmClear = true })
                }
            },
        )
        when {
            current == null -> LoadingState(stringResource(R.string.state_loading_short))
            current.isEmpty() -> EmptyState(
                icon = R.drawable.ic_bug_report,
                title = stringResource(R.string.error_log_empty),
                message = stringResource(R.string.error_log_empty_subtitle),
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(PlaylyTheme.spacing.md),
                verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
            ) {
                item(key = "privacy") {
                    Text(
                        stringResource(R.string.error_log_privacy),
                        style = PlaylyTheme.typography.subtitle,
                        color = PlaylyTheme.colors.textMuted,
                    )
                }
                items(current, key = { "${it.timeMs}-${it.tag}-${it.text.hashCode()}" }) { EntryCard(it) }
                item(key = "nav-inset") { Column(Modifier.navigationBarsPadding()) {} }
            }
        }
    }
    if (confirmClear) {
        ConfirmDialog(
            title = stringResource(R.string.dialog_clear_log_title),
            message = stringResource(R.string.dialog_clear_log_message),
            confirmLabel = stringResource(R.string.action_clear),
            dangerous = true,
            onConfirm = {
                confirmClear = false
                viewModel.clear()
                scope.launch { snackbar.showSnackbar(clearedMessage) }
            },
            onDismiss = { confirmClear = false },
        )
    }
}

/** One entry; a tap shows the whole stack trace. */
@Composable
private fun EntryCard(entry: ErrorLogEntry) {
    var expanded by rememberSaveable(entry.timeMs, entry.tag) { mutableStateOf(false) }
    val colors = PlaylyTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(PlaylyTheme.shapes.medium)
            .background(colors.surface)
            .clickable { expanded = !expanded }
            .padding(PlaylyTheme.spacing.md),
        verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xxs),
    ) {
        Text(timeLabel(entry.timeMs) + " · " + entry.tag, style = PlaylyTheme.typography.caption, color = colors.textMuted)
        Text(
            entry.text,
            style = PlaylyTheme.typography.caption.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp),
            color = colors.textSecondary,
            maxLines = if (expanded) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
