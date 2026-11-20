package com.playly.player.designsystem.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

/**
 * Stage 9.1: a settings row with a few fixed choices. The subtitle shows the current one; a tap
 * opens a menu that marks it with a check (and as selected for TalkBack).
 */
@Composable
fun <T> SettingsChoiceRow(
    title: String,
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
) {
    val colors = PlaylyTheme.colors
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        SettingsRow(title = title, subtitle = label(selected), icon = icon, onClick = { open = true })
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = colors.surfaceOverlay,
            shape = PlaylyTheme.shapes.medium,
        ) {
            options.forEach { option ->
                val chosen = option == selected
                DropdownMenuItem(
                    text = { Text(label(option), style = PlaylyTheme.typography.body, color = colors.textPrimary) },
                    onClick = {
                        open = false
                        if (!chosen) onSelect(option)
                    },
                    trailingIcon = if (chosen) {
                        { PlaylyIcon(R.drawable.ic_check, contentDescription = null, size = 20.dp) }
                    } else {
                        null
                    },
                    modifier = Modifier.semantics { this.selected = chosen },
                )
            }
        }
    }
}
