package com.playly.player.ui.screens.collections

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.data.artwork.artwork
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.browse.FolderNode
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.ui.actions.LocalTrackActions

/**
 * Row of an album, artist or genre: opens its page; "⋮" and a long press open its menu.
 * Albums show their artists and genres an icon (no artist photos offline).
 */
@Composable
fun GroupRow(group: TrackGroup, onOpen: (CollectionKind, String) -> Unit, modifier: Modifier = Modifier) {
    val actions = LocalTrackActions.current
    val target = groupTarget(group)
    val title = groupTitle(group)
    MediaRow(
        title = title,
        subtitle = groupSubtitle(group),
        artwork = if (group.kind == CollectionKind.Album) group.cover?.artwork() else null,
        placeholderIcon = group.kind.icon,
        onClick = { onOpen(group.kind, group.key) },
        onMore = actions?.let { a -> { a.openCollection(target) } },
        moreDescription = stringResource(R.string.collection_row_menu, title),
        modifier = modifier,
    )
}

/** Row of a folder; [subtitle] replaces "N folders · M tracks" (e.g. the path in a filter). */
@Composable
fun FolderRow(node: FolderNode, onOpen: (CollectionKind, String) -> Unit, subtitle: String? = null) {
    val actions = LocalTrackActions.current
    val target = folderTarget(node)
    MediaRow(
        title = node.name,
        subtitle = subtitle ?: folderSubtitle(node),
        placeholderIcon = CollectionKind.Folder.icon,
        onClick = { onOpen(CollectionKind.Folder, node.path) },
        onMore = actions?.let { a -> { a.openCollection(target) } },
        moreDescription = stringResource(R.string.collection_row_menu, node.name),
    )
}
