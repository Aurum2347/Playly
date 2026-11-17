package com.playly.player.ui.actions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import com.playly.player.R
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.tags.TagEdit
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.designsystem.components.PlaylyTextField

/**
 * "Edit tags" (stage 8.4): title, artist, album and genre, as on the desktop. The text survives
 * rotation; while saving, the fields and buttons wait. A failed save keeps the sheet open with
 * the reason.
 */
@Composable
internal fun EditTagsSheet(sheet: TrackSheet.EditTags, viewModel: TrackActionsViewModel) {
    val track by produceState<TrackEntity?>(null, sheet.trackId) { value = viewModel.track(sheet.trackId) }
    PlaylySheet(onDismiss = { if (!sheet.saving) viewModel.dismiss() }) {
        Text(
            stringResource(R.string.tags_title),
            style = PlaylyTheme.typography.sectionTitle,
            color = PlaylyTheme.colors.textPrimary,
            modifier = Modifier
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm)
                .semantics { heading() },
        )
        val loaded = track
        if (loaded == null) {
            Spacer(Modifier.height(PlaylyTheme.spacing.xxxl))
        } else {
            TagFields(loaded, sheet, viewModel)
        }
        Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
    }
}

@Composable
private fun TagFields(track: TrackEntity, sheet: TrackSheet.EditTags, viewModel: TrackActionsViewModel) {
    val colors = PlaylyTheme.colors
    var title by rememberSaveable(track.id) { mutableStateOf(track.title) }
    var artist by rememberSaveable(track.id) { mutableStateOf(track.artist.orEmpty()) }
    var album by rememberSaveable(track.id) { mutableStateOf(track.album.orEmpty()) }
    var genre by rememberSaveable(track.id) { mutableStateOf(track.genre.orEmpty()) }
    val edit = TagEdit(title, artist, album, genre)
    val save = { viewModel.saveTags(track.id, edit) }
    Column(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PlaylyTheme.spacing.page),
        verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xs),
    ) {
        Text(track.fileName, style = PlaylyTheme.typography.caption, color = colors.textMuted)
        TagField(R.string.details_field_title, title, { title = it }, ImeAction.Next)
        TagField(R.string.details_field_artist, artist, { artist = it }, ImeAction.Next)
        TagField(R.string.details_field_album, album, { album = it }, ImeAction.Next)
        TagField(R.string.details_field_genre, genre, { genre = it }, ImeAction.Done, onDone = save)
        Text(stringResource(R.string.tags_hint), style = PlaylyTheme.typography.caption, color = colors.textMuted)
        val error = sheet.error ?: R.string.tags_title_required.takeIf { !edit.isValid }
        if (error != null) {
            Text(
                stringResource(error),
                style = PlaylyTheme.typography.subtitle,
                color = colors.danger,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Spacer(Modifier.height(PlaylyTheme.spacing.xs))
        Row(horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm)) {
            PlaylyButton(
                stringResource(if (sheet.saving) R.string.tags_saving else R.string.action_save),
                onClick = save,
                enabled = edit.isValid && !sheet.saving,
                modifier = Modifier.weight(1f),
            )
            PlaylyButton(
                stringResource(R.string.action_cancel),
                onClick = viewModel::dismiss,
                style = PlaylyButtonStyle.Secondary,
                enabled = !sheet.saving,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun TagField(label: Int, value: String, onChange: (String) -> Unit, ime: ImeAction, onDone: () -> Unit = {}) {
    Column(verticalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xxs)) {
        val text = stringResource(label)
        // A visible caption: the field's own placeholder disappears once there is text.
        Text(text, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
        PlaylyTextField(
            value = value,
            onValueChange = { onChange(it.take(TagEdit.MAX_LENGTH)) },
            label = text,
            imeAction = ime,
            onImeAction = onDone,
        )
    }
}
