package com.playly.player.ui.player

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.playly.player.R
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.MediaRow
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.playback.QueueEntry
import com.playly.player.playback.QueueSnapshot
import com.playly.player.playback.RepeatMode

/**
 * The queue as it will play (shuffle applied): "Now playing", then "Up next". A tap plays that
 * track; the sheet stays open and follows along. Reordering, removing and "play next" are
 * stage 6; this sheet already shows the same single queue the notification plays.
 */
@Composable
internal fun QueueSheet(queue: QueueSnapshot?, shuffle: Boolean, onPlay: (QueueEntry) -> Unit, onDismiss: () -> Unit) {
    PlaylySheet(onDismiss = onDismiss) {
        Text(
            stringResource(R.string.queue_title),
            style = PlaylyTheme.typography.sectionTitle,
            color = PlaylyTheme.colors.textPrimary,
            modifier = Modifier
                .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.sm)
                .semantics { heading() },
        )
        if (queue == null) {
            Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.xxxl))
            return@PlaylySheet
        }
        LazyColumn(Modifier.fillMaxWidth()) {
            queue.current?.let { current ->
                item(key = "now-header") { QueueHeader(stringResource(R.string.playback_now_playing), null) }
                item(key = "now-${current.index}") {
                    MediaRow(
                        title = current.title,
                        subtitle = current.artist ?: stringResource(R.string.unknown_artist),
                        artwork = current.artwork,
                        isActive = true,
                        modifier = Modifier.animateItem(),
                    )
                }
            }
            item(key = "next-header") {
                val count = pluralStringResource(R.plurals.tracks_count, queue.upNext.size, queue.upNext.size)
                val detail = if (shuffle && queue.upNext.size > 1) stringResource(R.string.summary_separator, count, stringResource(R.string.queue_shuffled)) else count
                QueueHeader(stringResource(R.string.queue_up_next), detail.takeIf { queue.upNext.isNotEmpty() })
            }
            items(queue.upNext, key = { "next-${it.index}" }) { entry ->
                MediaRow(
                    title = entry.title,
                    subtitle = entry.artist ?: stringResource(R.string.unknown_artist),
                    artwork = entry.artwork,
                    onClick = { onPlay(entry) },
                    modifier = Modifier.animateItem(),
                )
            }
            item(key = "footer") {
                val note = when {
                    queue.repeat == RepeatMode.One -> R.string.queue_then_repeat_one
                    queue.repeat == RepeatMode.All -> R.string.queue_then_repeat_all
                    queue.upNext.isEmpty() -> R.string.queue_nothing_next
                    else -> null
                }
                if (note != null) {
                    Text(
                        stringResource(note),
                        style = PlaylyTheme.typography.subtitle,
                        color = PlaylyTheme.colors.textMuted,
                        modifier = Modifier.padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.md),
                    )
                }
                Spacer(Modifier.navigationBarsPadding().height(PlaylyTheme.spacing.md))
            }
        }
    }
}

@Composable
private fun QueueHeader(title: String, detail: String?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = PlaylyTheme.spacing.page, end = PlaylyTheme.spacing.page, top = PlaylyTheme.spacing.md, bottom = PlaylyTheme.spacing.xxs)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = PlaylyTheme.typography.label, color = PlaylyTheme.colors.textSecondary, modifier = Modifier.weight(1f))
        if (detail != null) Text(detail, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
    }
}
