package com.playly.player.ui.screens.collections

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.playly.player.R
import com.playly.player.data.artwork.artwork
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.data.library.browse.FolderNode
import com.playly.player.data.library.browse.TrackGroup
import com.playly.player.ui.actions.CollectionTarget
import com.playly.player.ui.tracksSummaryLabel

/** Name of a group; "Unknown artist" for tracks without one. */
@Composable
fun groupTitle(group: TrackGroup): String = group.name ?: stringResource(R.string.unknown_artist)

/** Album: "Artist · 2021"; "Various artists" for a compilation. Null when nothing is known. */
@Composable
fun albumSubtitle(group: TrackGroup): String? {
    val artist = group.artist ?: if (group.variousArtists) stringResource(R.string.various_artists) else null
    val year = group.year?.toString()
    return when {
        artist != null && year != null -> stringResource(R.string.summary_separator, artist, year)
        else -> artist ?: year
    }
}

/** Row subtitle: "3 albums · 24 tracks" for an artist, "N tracks · length" otherwise. */
@Composable
fun groupSubtitle(group: TrackGroup): String {
    val tracks = pluralStringResource(R.plurals.tracks_count, group.tracks.size, group.tracks.size)
    return when (group.kind) {
        CollectionKind.Album -> albumSubtitle(group)?.let { stringResource(R.string.summary_separator, it, tracks) } ?: tracks
        CollectionKind.Artist -> if (group.albumKeys.isEmpty()) {
            tracks
        } else {
            stringResource(R.string.summary_separator, pluralStringResource(R.plurals.albums_count, group.albumKeys.size, group.albumKeys.size), tracks)
        }
        else -> tracksSummaryLabel(group.tracks.size, group.totalDurationMs)
    }
}

@Composable
fun folderSubtitle(node: FolderNode): String {
    val tracks = pluralStringResource(R.plurals.tracks_count, node.allTracks.size, node.allTracks.size)
    if (node.subfolders.isEmpty()) return tracks
    val folders = pluralStringResource(R.plurals.folders_count, node.subfolders.size, node.subfolders.size)
    return stringResource(R.string.summary_separator, folders, tracks)
}

val CollectionKind.icon: Int
    get() = when (this) {
        CollectionKind.Album -> R.drawable.ic_album
        CollectionKind.Artist -> R.drawable.ic_artist
        CollectionKind.Genre -> R.drawable.ic_genre
        CollectionKind.Folder -> R.drawable.ic_folder
    }

/** What the "⋮" menu of a group acts on. */
@Composable
fun groupTarget(group: TrackGroup): CollectionTarget = CollectionTarget(
    kind = group.kind,
    title = groupTitle(group),
    subtitle = groupSubtitle(group),
    artwork = if (group.kind == CollectionKind.Album) group.cover?.artwork() else null,
    trackIds = group.tracks.map { it.id },
    placeholderIcon = group.kind.icon,
)

@Composable
fun folderTarget(node: FolderNode): CollectionTarget = CollectionTarget(
    kind = CollectionKind.Folder,
    title = node.name,
    subtitle = folderSubtitle(node),
    artwork = null,
    trackIds = node.allTracks.map { it.id },
    placeholderIcon = R.drawable.ic_folder,
)
