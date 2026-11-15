package com.playly.player.ui.player

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.text.format.Formatter
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.core.net.toUri
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.data.db.TrackEntity
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.SheetAction
import com.playly.player.designsystem.components.SheetTrackHeader
import com.playly.player.playback.NowPlaying

private sealed interface Details {
    data object Loading : Details
    data object Gone : Details
    data class Loaded(val track: TrackEntity) : Details
}

/** Every tag and file fact Playly knows, selectable for copying. The full title lives here too. */
@Composable
internal fun TrackDetailsSheet(trackId: Long, load: suspend (Long) -> TrackEntity?, onDismiss: () -> Unit) {
    val details by produceState<Details>(Details.Loading, trackId) {
        value = load(trackId)?.let { Details.Loaded(it) } ?: Details.Gone
    }
    PlaylySheet(onDismiss = onDismiss) {
        Text(
            stringResource(R.string.track_menu_details),
            style = PlaylyTheme.typography.sectionTitle,
            color = PlaylyTheme.colors.textPrimary,
            modifier = Modifier
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm)
                .semantics { heading() },
        )
        when (val current = details) {
            Details.Loading -> Spacer(Modifier.height(PlaylyTheme.spacing.xxxl))
            Details.Gone -> DetailsNote(stringResource(R.string.details_not_found))
            is Details.Loaded -> DetailsFields(current.track)
        }
        Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
    }
}

@Composable
private fun DetailsFields(track: TrackEntity) {
    val context = LocalContext.current
    val fields = buildList {
        add(R.string.details_field_title to track.title)
        track.artist?.let { add(R.string.details_field_artist to it) }
        track.album?.let { add(R.string.details_field_album to it) }
        track.albumArtist?.takeIf { it != track.artist }?.let { add(R.string.details_field_album_artist to it) }
        track.genre?.let { add(R.string.details_field_genre to it) }
        track.year?.let { add(R.string.details_field_year to it.toString()) }
        track.trackNumber?.let { add(R.string.details_field_track to it.toString()) }
        track.discNumber?.let { add(R.string.details_field_disc to it.toString()) }
        if (track.durationMs > 0) add(R.string.details_field_duration to formatClock(track.durationMs))
        formatLabel(track)?.let { add(R.string.details_field_format to it) }
        if (track.sizeBytes > 0) add(R.string.details_field_size to Formatter.formatShortFileSize(context, track.sizeBytes))
        add(R.string.details_field_file to track.fileName)
        track.folderPath?.takeIf { it.isNotBlank() }?.let { add(R.string.details_field_folder to it) }
    }.filter { it.second.isNotBlank() }
    if (!track.isAvailable) DetailsNote(stringResource(R.string.details_unavailable))
    SelectionContainer {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = PlaylyTheme.spacing.page),
        ) {
            fields.forEach { (label, value) ->
                Column(Modifier.fillMaxWidth().padding(vertical = PlaylyTheme.spacing.xs).semantics(mergeDescendants = true) { }) {
                    Text(stringResource(label), style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
                    Text(value, style = PlaylyTheme.typography.body, color = PlaylyTheme.colors.textPrimary)
                }
            }
        }
    }
}

@Composable
private fun DetailsNote(text: String) {
    Text(
        text,
        style = PlaylyTheme.typography.subtitle,
        color = PlaylyTheme.colors.textSecondary,
        modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs),
    )
}

/** "FLAC", "MP3"…: the file extension, else the MIME subtype. */
private fun formatLabel(track: TrackEntity): String? {
    val extension = track.fileName.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= 5 }
    return (extension ?: track.mimeType?.substringAfter('/'))?.uppercase()
}

/**
 * Hands the file to another app through the system share sheet, with a one-off read grant for
 * the receiver. False when the file is gone or nothing can receive it.
 */
internal fun shareTrack(context: Context, track: TrackEntity?): Boolean {
    if (track == null || !track.isAvailable) return false
    val uri = track.uri.toUri()
    val send = Intent(Intent.ACTION_SEND)
        .setType(track.mimeType ?: "audio/*")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    // ClipData carries the grant into the chooser's preview as well.
    send.clipData = ClipData.newRawUri(track.title, uri)
    return try {
        context.startActivity(Intent.createChooser(send, context.getString(R.string.share_chooser_title)))
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
}
