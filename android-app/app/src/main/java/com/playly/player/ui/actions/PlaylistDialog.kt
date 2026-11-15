package com.playly.player.ui.actions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import com.playly.player.R
import com.playly.player.data.playlists.PlaylistRules
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyTextField

/**
 * Name (required) and, when [withDescription], description of a playlist. "Save" stays
 * disabled while the name is blank; text survives rotation. The name field takes focus.
 */
@Composable
fun PlaylistDialog(
    title: String,
    confirmLabel: String,
    onConfirm: (name: String, description: String?) -> Unit,
    onDismiss: () -> Unit,
    initialName: String = "",
    initialDescription: String? = null,
    withDescription: Boolean = false,
) {
    val colors = PlaylyTheme.colors
    var name by rememberSaveable { mutableStateOf(initialName) }
    var description by rememberSaveable { mutableStateOf(initialDescription.orEmpty()) }
    val valid = PlaylistRules.cleanName(name) != null
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val confirm = { if (valid) onConfirm(name, description.takeIf { withDescription }) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surfaceOverlay,
        titleContentColor = colors.textPrimary,
        shape = PlaylyTheme.shapes.large,
        title = { Text(title, style = PlaylyTheme.typography.sectionTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm)) {
                PlaylyTextField(
                    value = name,
                    onValueChange = { name = it.take(PlaylistRules.MAX_NAME_LENGTH) },
                    label = stringResource(R.string.playlist_field_name),
                    focusRequester = focus,
                    imeAction = if (withDescription) ImeAction.Next else ImeAction.Done,
                    onImeAction = { if (!withDescription) confirm() },
                )
                if (withDescription) {
                    PlaylyTextField(
                        value = description,
                        onValueChange = { description = it.take(PlaylistRules.MAX_DESCRIPTION_LENGTH) },
                        label = stringResource(R.string.playlist_field_description),
                        singleLine = false,
                        imeAction = ImeAction.Default,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = confirm, enabled = valid) {
                Text(
                    confirmLabel,
                    style = PlaylyTheme.typography.button,
                    color = if (valid) colors.textPrimary else colors.textFaint,
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_cancel), style = PlaylyTheme.typography.button, color = colors.textSecondary)
            }
        },
    )
}

