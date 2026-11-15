package com.playly.player.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme

val LibraryTab.label: Int
    get() = when (this) {
        LibraryTab.Tracks -> R.string.library_tab_tracks
        LibraryTab.Albums -> R.string.library_tab_albums
        LibraryTab.Artists -> R.string.library_tab_artists
        LibraryTab.Folders -> R.string.library_tab_folders
        LibraryTab.Genres -> R.string.library_tab_genres
    }

val LibraryTab.filterHint: Int
    get() = when (this) {
        LibraryTab.Tracks -> R.string.library_filter_tracks
        LibraryTab.Albums -> R.string.library_filter_albums
        LibraryTab.Artists -> R.string.library_filter_artists
        LibraryTab.Folders -> R.string.library_filter_folders
        LibraryTab.Genres -> R.string.library_filter_genres
    }

/** Section chips under the title; scrolls sideways on narrow screens. TalkBack reads them as tabs. */
@Composable
fun LibraryTabRow(tabs: List<LibraryTab>, current: LibraryTab, onSelect: (LibraryTab) -> Unit) {
    val colors = PlaylyTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = PlaylyTheme.spacing.page)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
    ) {
        tabs.forEach { tab ->
            val selected = tab == current
            Text(
                stringResource(tab.label),
                style = PlaylyTheme.typography.label,
                color = if (selected) colors.onAccent else colors.textSecondary,
                modifier = Modifier
                    .heightIn(min = 36.dp)
                    .clip(PlaylyTheme.shapes.pill)
                    .background(if (selected) colors.accent else colors.surfaceRaised)
                    .selectable(selected = selected, role = Role.Tab, onClick = { onSelect(tab) })
                    .padding(horizontal = PlaylyTheme.spacing.md, vertical = PlaylyTheme.spacing.xs),
            )
        }
    }
}

/** Tab header: "12 albums" (or "Found: 3 of 12") and the tab's sort. */
@Composable
fun TabHeader(title: String, sort: (@Composable () -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = PlaylyTheme.typography.subtitle,
                color = PlaylyTheme.colors.textMuted,
                modifier = Modifier.semantics { heading() },
            )
        }
        sort?.invoke()
    }
    Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
}
