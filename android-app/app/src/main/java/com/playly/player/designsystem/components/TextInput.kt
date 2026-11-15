package com.playly.player.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

/**
 * Playly's text field: raised surface, placeholder [label] (also read by TalkBack), optional
 * leading icon. Multi-line when [singleLine] is false.
 */
@Composable
fun PlaylyTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    leadingIcon: Int? = null,
    singleLine: Boolean = true,
    imeAction: ImeAction = ImeAction.Done,
    onImeAction: () -> Unit = {},
    focusRequester: FocusRequester? = null,
    /** Adds a "Clear" button while there is text (filters). */
    onClear: (() -> Unit)? = null,
) {
    val colors = PlaylyTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.small)
            .background(colors.surfaceRaised)
            .padding(horizontal = PlaylyTheme.spacing.sm, vertical = PlaylyTheme.spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            PlaylyIcon(leadingIcon, contentDescription = null, tint = colors.textMuted, size = 20.dp)
            Box(Modifier.padding(start = PlaylyTheme.spacing.xs))
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text(label, style = PlaylyTheme.typography.body, color = colors.textMuted, maxLines = 1)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = singleLine,
                maxLines = if (singleLine) 1 else 5,
                textStyle = PlaylyTheme.typography.body.copy(color = colors.textPrimary),
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = imeAction),
                keyboardActions = KeyboardActions(onAny = { onImeAction() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                    .semantics { contentDescription = label },
            )
        }
        if (onClear != null && value.isNotEmpty()) {
            PlaylyIconButton(
                R.drawable.ic_close,
                androidx.compose.ui.res.stringResource(R.string.action_clear),
                onClear,
                tint = colors.textSecondary,
                size = 32.dp,
                iconSize = 20.dp,
            )
        }
    }
}
