package com.playly.player.ui.player

import android.os.SystemClock
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.playly.player.R
import com.playly.player.data.lyrics.LrcParser
import com.playly.player.data.lyrics.LyricLine
import com.playly.player.data.lyrics.Lyrics
import com.playly.player.data.lyrics.LyricsOrigin
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.designsystem.components.EmptyState
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.designsystem.components.PlaylySheet
import com.playly.player.playback.NowPlaying
import com.playly.player.playback.PlaybackPosition
import kotlinx.coroutines.delay

/**
 * The playing track's text (stage 8.2, spec §13). Synced LRC lines light up in time and the
 * page follows them; a tap on a line plays from it. Scrolling by hand stops the following until
 * "Back to current line". Plain text just scrolls. No text is a calm empty state.
 */
@Composable
internal fun LyricsSheet(
    track: NowPlaying,
    lyrics: LyricsUiState,
    position: PlaybackPosition,
    onSeek: (Long) -> Unit,
    onDismiss: () -> Unit,
) {
    // A result for the previous track is still "loading" for this one.
    val ready = (lyrics as? LyricsUiState.Ready)?.takeIf { it.trackId == track.trackId }
    val found = ready?.found
    PlaylySheet(onDismiss = onDismiss) { _ ->
        Column(Modifier.fillMaxWidth().fillMaxHeight(SHEET_HEIGHT)) {
            LyricsHeader(track, found?.origin, synced = found?.lyrics is Lyrics.Synced)
            // A new track starts at the top of its own text.
            key(track.trackId) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when (val text = found?.lyrics) {
                        is Lyrics.Synced -> SyncedLyrics(text.lines, position, onSeek)
                        is Lyrics.Plain -> PlainLyrics(text.lines)
                        null -> if (ready != null) {
                            EmptyState(
                                icon = R.drawable.ic_lyrics,
                                title = stringResource(R.string.lyrics_empty_title),
                                message = stringResource(R.string.lyrics_empty_message),
                                modifier = Modifier.fillMaxSize().navigationBarsPadding(),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LyricsHeader(track: NowPlaying, origin: LyricsOrigin?, synced: Boolean) {
    val colors = PlaylyTheme.colors
    val spacing = PlaylyTheme.spacing
    Column(Modifier.fillMaxWidth().padding(horizontal = spacing.page, vertical = spacing.sm)) {
        Text(
            stringResource(R.string.lyrics_title),
            style = PlaylyTheme.typography.sectionTitle,
            color = colors.textPrimary,
            modifier = Modifier.semantics { heading() },
        )
        val subtitle = listOfNotNull(track.title, track.artist).filter { it.isNotBlank() }.joinToString(" · ")
        Text(subtitle, style = PlaylyTheme.typography.subtitle, color = colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (origin != null) {
            val where = stringResource(if (origin == LyricsOrigin.File) R.string.lyrics_origin_file else R.string.lyrics_origin_tag)
            val hint = if (synced) where else stringResource(R.string.lyrics_unsynced, where)
            Text(hint, style = PlaylyTheme.typography.caption, color = colors.textFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * The line playing now, -1 before the first. Wakes up only when the next line is due (track
 * time runs at the playback speed), not on a timer, and only while the screen is visible.
 */
@Composable
private fun rememberActiveLine(lines: List<LyricLine>, position: PlaybackPosition): Int {
    fun current(): Int = LrcParser.activeLine(lines, position.at(SystemClock.elapsedRealtime()) + LrcParser.LEAD_MS)
    var active by remember(lines) { mutableIntStateOf(current()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lines, position, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                val now = position.at(SystemClock.elapsedRealtime()) + LrcParser.LEAD_MS
                active = LrcParser.activeLine(lines, now)
                if (!position.advancing) break
                val wait = LrcParser.msUntilNext(lines, now) ?: break
                delay((wait / position.speed.coerceAtLeast(MIN_SPEED)).toLong() + 1)
            }
        }
    }
    return active
}

@Composable
private fun SyncedLyrics(lines: List<LyricLine>, position: PlaybackPosition, onSeek: (Long) -> Unit) {
    val reduced = PlaylyTheme.motion.reduced
    val active = rememberActiveLine(lines, position)
    val listState = rememberLazyListState()
    var following by remember { mutableStateOf(true) }
    // A finger on the text means the reader looks around: stop following until asked.
    LaunchedEffect(listState) {
        listState.interactionSource.interactions.collect { if (it is DragInteraction.Start) following = false }
    }
    // The top padding puts a scrolled-to line at the reading height, not at the very top.
    LaunchedEffect(active, following) {
        if (!following) return@LaunchedEffect
        val index = active.coerceAtLeast(0)
        if (reduced) listState.scrollToItem(index) else listState.animateScrollToItem(index)
    }
    val seekLabel = stringResource(R.string.lyrics_seek_line)
    val nowLabel = stringResource(R.string.lyrics_line_now)
    val gapLabel = stringResource(R.string.lyrics_instrumental)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val nav = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(top = maxHeight * FOCUS_FRACTION, bottom = maxHeight * (1 - FOCUS_FRACTION) + nav),
            modifier = Modifier.fillMaxSize(),
        ) {
            itemsIndexed(lines, key = { i, _ -> i }) { i, line ->
                SyncedLine(
                    text = line.text,
                    phase = when {
                        i == active -> LinePhase.Now
                        i < active -> LinePhase.Past
                        else -> LinePhase.Next
                    },
                    labels = LineLabels(seekLabel, nowLabel, gapLabel),
                    onClick = {
                        following = true
                        onSeek(line.timeMs)
                    },
                )
            }
        }
        AnimatedVisibility(
            visible = !following,
            enter = fadeIn(PlaylyTheme.motion.standard()),
            exit = fadeOut(PlaylyTheme.motion.exit()),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = PlaylyTheme.spacing.md),
        ) {
            PlaylyButton(
                stringResource(R.string.lyrics_follow),
                onClick = { following = true },
                style = PlaylyButtonStyle.Primary,
            )
        }
    }
}

private enum class LinePhase { Past, Now, Next }

private class LineLabels(val seek: String, val now: String, val gap: String)

@Composable
private fun SyncedLine(text: String, phase: LinePhase, labels: LineLabels, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    // Only the colour changes, so lines never reflow while the song plays.
    val color by animateColorAsState(
        targetValue = when (phase) {
            LinePhase.Now -> colors.textPrimary
            LinePhase.Past -> colors.textMuted
            LinePhase.Next -> colors.textSecondary.copy(alpha = NEXT_ALPHA)
        },
        animationSpec = PlaylyTheme.motion.standard(),
        label = "lyricLine",
    )
    Text(
        text.ifEmpty { GAP_MARK },
        style = SyncedStyle,
        color = color,
        modifier = Modifier
            .fillMaxWidth()
            .clip(PlaylyTheme.shapes.medium)
            .clickable(onClickLabel = labels.seek, onClick = onClick)
            .semantics {
                if (text.isEmpty()) contentDescription = labels.gap
                if (phase == LinePhase.Now) stateDescription = labels.now
            }
            .padding(horizontal = PlaylyTheme.spacing.page, vertical = PlaylyTheme.spacing.xs),
    )
}

@Composable
private fun PlainLyrics(lines: List<String>) {
    val nav = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    LazyColumn(
        contentPadding = PaddingValues(
            start = PlaylyTheme.spacing.page,
            end = PlaylyTheme.spacing.page,
            top = PlaylyTheme.spacing.sm,
            bottom = PlaylyTheme.spacing.xl + nav,
        ),
        modifier = Modifier.fillMaxSize(),
    ) {
        itemsIndexed(lines, key = { i, _ -> i }) { _, line ->
            // Blank lines split verses.
            if (line.isEmpty()) {
                Spacer(Modifier.height(PlaylyTheme.spacing.md))
            } else {
                Text(line, style = PlainStyle, color = PlaylyTheme.colors.textSecondary)
            }
        }
    }
}

private val SyncedStyle = androidx.compose.ui.text.TextStyle(fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold)
private val PlainStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium)

private const val SHEET_HEIGHT = 0.9f
/** How far down the page the current line sits. */
private const val FOCUS_FRACTION = 0.3f
private const val NEXT_ALPHA = 0.75f
private const val MIN_SPEED = 0.1f
private const val GAP_MARK = "♪"
