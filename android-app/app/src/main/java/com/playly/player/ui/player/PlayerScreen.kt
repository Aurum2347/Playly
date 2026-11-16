package com.playly.player.ui.player

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.stateDescription
import com.playly.player.designsystem.components.PlaylyButton
import com.playly.player.designsystem.components.PlaylyButtonStyle
import com.playly.player.playback.PlaybackErrorKind
import com.playly.player.playback.PlaybackSource
import com.playly.player.ui.LocalSnackbarHostState
import kotlinx.coroutines.launch
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.playly.player.R
import com.playly.player.core.formatClock
import com.playly.player.designsystem.PlaylyMotion
import com.playly.player.designsystem.PlaylyTheme
import com.playly.player.ui.actions.LocalTrackActions
import com.playly.player.ui.actions.TrackTarget
import com.playly.player.designsystem.components.PlaylyIcon
import com.playly.player.designsystem.components.PlaylyIconButton
import com.playly.player.designsystem.components.PlaylySeekBar
import com.playly.player.playback.NowPlaying
import com.playly.player.playback.PlaybackPosition
import com.playly.player.playback.PlaybackState
import com.playly.player.playback.RepeatMode
import kotlinx.coroutines.delay

/**
 * The full-screen player as a layer above the tabs: the list underneath keeps its scroll
 * position and state, and closing it (arrow, swipe down, Back) never touches playback.
 * It grows out of [PlayerLauncher.origin] and shrinks back into the "Now playing" button.
 */
@Composable
fun PlayerOverlay(launcher: PlayerLauncher, viewModel: PlayerViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val hasTrack = state.nowPlaying != null
    val motion = PlaylyTheme.motion
    var size by remember { mutableStateOf(IntSize.Zero) }

    // The queue ran empty while the player was open: close rather than show an empty player.
    var hadTrack by remember { mutableStateOf(hasTrack) }
    LaunchedEffect(hasTrack) {
        if (hadTrack && !hasTrack && launcher.isOpen) launcher.close()
        hadTrack = hasTrack
    }

    val visible = launcher.isOpen && hasTrack
    BackHandler(enabled = visible) { launcher.close() }

    val origin = launcher.origin
    val transformOrigin = if (origin != null && size.width > 0 && size.height > 0) {
        TransformOrigin((origin.x / size.width).coerceIn(0f, 1f), (origin.y / size.height).coerceIn(0f, 1f))
    } else {
        TransformOrigin(0.5f, 1f)
    }
    Box(modifier.fillMaxSize().onSizeChanged { size = it }) {
        AnimatedVisibility(
            visible = visible,
            enter = scaleIn(motion.expand(), initialScale = 0.15f, transformOrigin = transformOrigin) + fadeIn(motion.enter()),
            exit = scaleOut(motion.exit(), targetScale = 0.15f, transformOrigin = transformOrigin) + fadeOut(motion.exit()),
        ) {
            PlayerSheet(state, viewModel, onCollapse = launcher::close)
        }
    }
}

@Composable
private fun PlayerSheet(state: PlaybackState, viewModel: PlayerViewModel, onCollapse: () -> Unit) {
    // Keep showing the last track while the sheet animates away.
    val last = remember { mutableStateOf(state.nowPlaying) }
    state.nowPlaying?.let { last.value = it }
    val track = last.value ?: return

    val colors = PlaylyTheme.colors
    val motion = PlaylyTheme.motion
    val reduced = motion.reduced
    var drag by remember { mutableFloatStateOf(0f) }
    var height by remember { mutableIntStateOf(0) }
    val pane = stringResource(R.string.playback_now_playing)

    // Queue, speed or sleep timer sheet; the track menu lives in the shared TrackActionsHost (one sheet at a time, spec §12).
    var openSheet by rememberSaveable { mutableStateOf<String?>(null) }
    val actions = LocalTrackActions.current

    // Optional cover tint (spec §10): a faint wash at the top, fading into the plain background.
    val tintEnabled by viewModel.artworkTint.collectAsStateWithLifecycle()
    var tint by remember { mutableStateOf<Color?>(null) }
    val top by animateColorAsState(
        targetValue = tint?.takeIf { tintEnabled }?.let { lerp(colors.background, it, TINT_STRENGTH) } ?: colors.background,
        animationSpec = motion.expand(),
        label = "playerTint",
    )
    val backdrop = Brush.verticalGradient(0f to top, TINT_FADE_END to colors.background)

    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { height = it.height }
            .graphicsLayer {
                translationY = drag
                alpha = 1f - (drag / height.coerceAtLeast(1)).coerceIn(0f, 1f) * 0.4f
            }
            .background(colors.background)
            .background(backdrop)
            .semantics { paneTitle = pane }
            // Taps on empty space must not reach the list underneath.
            .pointerInput(Unit) { detectTapGestures { } }
            .draggable(
                state = rememberDraggableState { delta -> drag = (drag + delta).coerceAtLeast(0f) },
                orientation = Orientation.Vertical,
                onDragStopped = { velocity ->
                    if (drag > height * DISMISS_FRACTION || velocity > DISMISS_VELOCITY) {
                        onCollapse()
                    } else if (reduced) {
                        drag = 0f
                    } else {
                        animate(drag, 0f, animationSpec = SettleSpec) { value, _ -> drag = value }
                    }
                },
            ),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            val boxWidth = maxWidth
            val boxHeight = maxHeight
            val landscape = boxWidth > boxHeight
            val onTint: ((Color?) -> Unit)? = if (tintEnabled) { color -> tint = color } else null
            val openMenu = {
                actions?.open(TrackTarget(track.trackId, track.title, track.artist, track.artwork, queueActions = false))
                Unit
            }
            Column(Modifier.fillMaxSize()) {
                PlayerTopBar(state, onCollapse, onQueue = { openSheet = SHEET_QUEUE })
                if (landscape) {
                    val art = minOf(boxHeight - TOP_BAR - 32.dp, boxWidth * 0.42f)
                    Row(
                        Modifier.fillMaxSize().padding(horizontal = PlaylyTheme.spacing.xl, vertical = PlaylyTheme.spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.xxl),
                    ) {
                        PlayerArtwork(track, art, onTint)
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                            PlayerDetails(track, state, viewModel, openMenu, onSheet = { openSheet = it })
                        }
                    }
                } else {
                    // The cover gives way on short screens, so the controls below always fit.
                    val art = minOf(
                        boxWidth - PlaylyTheme.spacing.xl * 2,
                        (boxHeight - TOP_BAR) * 0.46f,
                        (boxHeight - TOP_BAR - DETAILS_HEIGHT).coerceAtLeast(MIN_ART),
                    )
                    Column(
                        Modifier.fillMaxSize().padding(horizontal = PlaylyTheme.spacing.xl),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Spacer(Modifier.weight(1f))
                        PlayerArtwork(track, art, onTint)
                        Spacer(Modifier.height(PlaylyTheme.spacing.xxl))
                        PlayerDetails(track, state, viewModel, openMenu, onSheet = { openSheet = it })
                        Spacer(Modifier.weight(1.2f))
                    }
                }
            }
        }
    }

    val dismiss = { openSheet = null }
    when (openSheet) {
        SHEET_QUEUE -> PlayerQueue(state.shuffle, viewModel, onDismiss = dismiss)
        SHEET_SPEED -> SpeedSheet(state.speed, onSpeed = viewModel::setSpeed, onDismiss = dismiss)
        SHEET_SLEEP -> SleepTimerSheet(
            timer = state.sleepTimer,
            actions = remember(viewModel) {
                SleepTimerActions(
                    onStart = viewModel::startSleepTimer,
                    onExtend = viewModel::extendSleepTimer,
                    onEndOfTrack = viewModel::sleepAtEndOfTrack,
                    onCancel = viewModel::cancelSleepTimer,
                )
            },
            onDismiss = dismiss,
        )
    }
}

@Composable
private fun PlayerQueue(shuffle: Boolean, viewModel: PlayerViewModel, onDismiss: () -> Unit) {
    val queue by viewModel.queue.collectAsStateWithLifecycle(initialValue = null)
    val edits = remember(viewModel) {
        QueueEdits(
            onPlay = viewModel::playQueueEntry,
            onMove = viewModel::moveQueueItem,
            onRemove = viewModel::removeFromQueue,
            onClear = viewModel::clearUpcoming,
        )
    }
    QueueSheet(queue, shuffle, edits, onDismiss = onDismiss)
}

@Composable
private fun PlayerTopBar(state: PlaybackState, onCollapse: () -> Unit, onQueue: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(TOP_BAR).padding(horizontal = PlaylyTheme.spacing.xxs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlaylyIconButton(R.drawable.ic_expand_more, stringResource(R.string.player_collapse), onCollapse, iconSize = 28.dp)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                sourceLabel(state.source),
                style = PlaylyTheme.typography.caption,
                color = PlaylyTheme.colors.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            // In shuffle the queue index is not the play order, so a "12 of 40" would mislead.
            if (!state.shuffle && state.queueSize > 1) {
                Text(
                    stringResource(R.string.player_queue_position, state.queueIndex + 1, state.queueSize),
                    style = PlaylyTheme.typography.label,
                    color = PlaylyTheme.colors.textSecondary,
                )
            }
        }
        PlaylyIconButton(R.drawable.ic_queue_music, stringResource(R.string.player_open_queue), onQueue)
    }
}

/** "All tracks", "Recently played", "Search: “…”"; plain "Now playing" for a foreign queue. */
@Composable
private fun sourceLabel(source: PlaybackSource?): String = when (source?.kind) {
    PlaybackSource.Kind.AllTracks -> stringResource(R.string.all_tracks)
    PlaybackSource.Kind.Recent -> stringResource(R.string.home_recent)
    PlaybackSource.Kind.Favorites -> stringResource(R.string.favorites_title)
    PlaybackSource.Kind.Search -> source.label?.let { stringResource(R.string.player_source_search, it) }
        ?: stringResource(R.string.playback_now_playing)
    PlaybackSource.Kind.Playlist -> source.label?.let { stringResource(R.string.player_source_playlist, it) }
        ?: stringResource(R.string.nav_playlists)
    PlaybackSource.Kind.Album -> source.label?.let { stringResource(R.string.player_source_album, it) }
        ?: stringResource(R.string.library_tab_albums)
    PlaybackSource.Kind.Artist -> source.label?.let { stringResource(R.string.player_source_artist, it) }
        ?: stringResource(R.string.library_tab_artists)
    PlaybackSource.Kind.Genre -> source.label?.let { stringResource(R.string.player_source_genre, it) }
        ?: stringResource(R.string.library_tab_genres)
    PlaybackSource.Kind.Folder -> source.label?.let { stringResource(R.string.player_source_folder, it) }
        ?: stringResource(R.string.library_tab_folders)
    null -> stringResource(R.string.playback_now_playing)
}

@Composable
private fun PlayerDetails(
    track: NowPlaying,
    state: PlaybackState,
    viewModel: PlayerViewModel,
    onMenu: () -> Unit,
    onSheet: (String) -> Unit,
) {
    val motion = PlaylyTheme.motion
    val favorite by viewModel.isFavorite.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        AnimatedContent(
            targetState = track,
            contentKey = { it.trackId },
            transitionSpec = { fadeIn(motion.standard()) togetherWith fadeOut(motion.exit()) },
            label = "playerTitle",
            modifier = Modifier.weight(1f),
        ) { shown ->
            Column(Modifier.fillMaxWidth()) {
                Text(
                    shown.title,
                    style = PlaylyTheme.typography.pageTitle.copy(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
                    color = PlaylyTheme.colors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(PlaylyTheme.spacing.xxs))
                val subtitle = listOfNotNull(shown.artist, shown.album).filter { it.isNotBlank() }.joinToString(" · ")
                Text(
                    subtitle.ifEmpty { stringResource(R.string.unknown_artist) },
                    style = PlaylyTheme.typography.body,
                    color = PlaylyTheme.colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        PlaylyIconButton(
            if (favorite) R.drawable.ic_favorite else R.drawable.ic_favorite_border,
            stringResource(if (favorite) R.string.favorite_remove else R.string.favorite_add),
            { viewModel.setFavorite(track.trackId, !favorite) },
            tint = if (favorite) PlaylyTheme.colors.textPrimary else PlaylyTheme.colors.textSecondary,
        )
        PlaylyIconButton(R.drawable.ic_more_vert, stringResource(R.string.player_track_menu), onMenu)
    }
    PlayerIssue(state.issue, track.title, onRetry = viewModel::retry)
    Spacer(Modifier.height(PlaylyTheme.spacing.lg))
    PlayerProgress(state.position, onSeek = viewModel::seekTo)
    Spacer(Modifier.height(PlaylyTheme.spacing.sm))
    PlayerControls(state, viewModel)
    Spacer(Modifier.height(PlaylyTheme.spacing.md))
    PlayerExtrasRow(
        speed = state.speed,
        sleepTimer = state.sleepTimer,
        onSpeed = { onSheet(SHEET_SPEED) },
        onSleepTimer = { onSheet(SHEET_SLEEP) },
    )
}

/**
 * The track failed and nothing else could start: say why, in place, with a way out (spec §9).
 * Announced politely by TalkBack; disappears as soon as the player tries again.
 */
@Composable
private fun PlayerIssue(issue: PlaybackErrorKind?, title: String, onRetry: () -> Unit) {
    val motion = PlaylyTheme.motion
    val colors = PlaylyTheme.colors
    val last = remember { mutableStateOf(issue) }
    if (issue != null) last.value = issue
    AnimatedVisibility(
        visible = issue != null,
        enter = fadeIn(motion.enter()) + expandVertically(motion.enter()),
        exit = fadeOut(motion.exit()) + shrinkVertically(motion.exit()),
    ) {
        val kind = last.value ?: return@AnimatedVisibility
        val reason = when (kind) {
            PlaybackErrorKind.Missing -> R.string.playback_error_missing
            PlaybackErrorKind.NoAccess -> R.string.playback_error_no_access
            PlaybackErrorKind.Unsupported -> R.string.playback_error_unsupported
            PlaybackErrorKind.Damaged -> R.string.playback_error_damaged
            PlaybackErrorKind.Other -> R.string.playback_error_other
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = PlaylyTheme.spacing.sm)
                .clip(PlaylyTheme.shapes.medium)
                .background(colors.surfaceRaised)
                .padding(start = PlaylyTheme.spacing.md, end = PlaylyTheme.spacing.xxs, top = PlaylyTheme.spacing.xxs, bottom = PlaylyTheme.spacing.xxs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PlaylyTheme.spacing.sm),
        ) {
            PlaylyIcon(R.drawable.ic_error, contentDescription = null, tint = colors.danger, size = 20.dp)
            Text(
                stringResource(reason, title),
                style = PlaylyTheme.typography.subtitle,
                color = colors.textSecondary,
                modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
            )
            PlaylyButton(stringResource(R.string.player_retry), onClick = onRetry, style = PlaylyButtonStyle.Text)
        }
    }
}

/** Reads the clock only here, so the ticking position recomposes nothing but the progress bar. */
@Composable
private fun PlayerProgress(position: PlaybackPosition, onSeek: (Long) -> Unit) {
    val live = rememberLivePosition(position)
    val duration = position.durationMs
    var scrub by remember { mutableStateOf<Float?>(null) }
    // After a seek, hold the target until the player reports its new position (no jump back).
    var pendingSeek by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(position) { pendingSeek = null }

    val shownMs = (scrub?.let { (it * duration).toLong() } ?: pendingSeek ?: live).coerceIn(0, duration.coerceAtLeast(0))
    val fraction = if (duration > 0) shownMs.toFloat() / duration else 0f
    val shownText = formatClock(shownMs)
    val durationText = if (duration > 0) formatClock(duration) else "--:--"
    Column(Modifier.fillMaxWidth()) {
        PlaylySeekBar(
            fraction = fraction,
            onScrub = { scrub = it },
            onSeek = { f ->
                scrub = null
                val target = (f * duration).toLong()
                pendingSeek = target
                onSeek(target)
            },
            contentDescription = stringResource(R.string.player_seek),
            stateDescription = stringResource(R.string.player_position_of, shownText, durationText),
            enabled = duration > 0,
        )
        Row(Modifier.fillMaxWidth()) {
            Text(shownText, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
            Spacer(Modifier.weight(1f))
            Text(durationText, style = PlaylyTheme.typography.caption, color = PlaylyTheme.colors.textMuted)
        }
    }
}

/**
 * The live position from a snapshot, refreshed a few times a second only while audio advances
 * and the app is visible: a stopped screen or a paused track runs no timer.
 */
@Composable
private fun rememberLivePosition(position: PlaybackPosition): Long {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(position, lifecycle) {
        now = SystemClock.elapsedRealtime()
        if (!position.advancing) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                now = SystemClock.elapsedRealtime()
                delay(TICK_MS)
            }
        }
    }
    return position.at(now)
}

@Composable
private fun PlayerControls(state: PlaybackState, viewModel: PlayerViewModel) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ModeButton(
            icon = R.drawable.ic_shuffle,
            active = state.shuffle,
            description = stringResource(if (state.shuffle) R.string.playback_shuffle_on else R.string.playback_shuffle_off),
            onClick = viewModel::toggleShuffle,
        )
        PlaylyIconButton(
            R.drawable.ic_skip_previous,
            stringResource(R.string.player_previous),
            viewModel::previous,
            enabled = state.hasPrevious,
            iconSize = 36.dp,
            size = 56.dp,
        )
        PlayPauseButton(showPlay = state.showPlayButton, buffering = state.isBuffering && !state.showPlayButton, onClick = viewModel::togglePlayPause)
        PlaylyIconButton(
            R.drawable.ic_skip_next,
            stringResource(R.string.player_next),
            viewModel::next,
            enabled = state.hasNext,
            iconSize = 36.dp,
            size = 56.dp,
        )
        val (repeatIcon, repeatLabel) = when (state.repeat) {
            RepeatMode.Off -> R.drawable.ic_repeat to R.string.playback_repeat_off
            RepeatMode.All -> R.drawable.ic_repeat to R.string.playback_repeat_all
            RepeatMode.One -> R.drawable.ic_repeat_one to R.string.playback_repeat_one
        }
        ModeButton(
            icon = repeatIcon,
            active = state.repeat != RepeatMode.Off,
            description = stringResource(repeatLabel),
            onClick = viewModel::cycleRepeat,
        )
    }
}

/** Shuffle / repeat: the state shows by brightness and a dot, not by colour alone. */
@Composable
private fun ModeButton(icon: Int, active: Boolean, description: String, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    val tint by animateColorAsState(
        targetValue = if (active) colors.textPrimary else colors.textMuted,
        animationSpec = PlaylyTheme.motion.press(),
        label = "modeTint",
    )
    Column(
        Modifier
            .size(PlaylyTheme.spacing.minTouch)
            .clip(PlaylyTheme.shapes.pill)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        PlaylyIcon(icon, contentDescription = null, tint = tint)
        Spacer(Modifier.height(3.dp))
        Box(
            Modifier
                .size(4.dp)
                .clip(PlaylyTheme.shapes.pill)
                .background(if (active) colors.textPrimary else Color.Transparent),
        )
    }
}

@Composable
private fun PlayPauseButton(showPlay: Boolean, buffering: Boolean, onClick: () -> Unit) {
    val colors = PlaylyTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.94f else 1f,
        animationSpec = PlaylyTheme.motion.press(),
        label = "playScale",
    )
    val label = stringResource(if (showPlay) R.string.player_play else R.string.player_pause)
    // Local files are usually ready within a frame or two: show "loading" only when it lasts,
    // so a normal track change never blinks a spinner.
    var showSpinner by remember { mutableStateOf(false) }
    LaunchedEffect(buffering) {
        if (buffering) delay(BUFFERING_SPINNER_DELAY_MS)
        showSpinner = buffering
    }
    val loading = stringResource(R.string.player_buffering)
    Box(Modifier.size(PLAY_BUTTON + 12.dp), contentAlignment = Alignment.Center) {
        if (showSpinner) {
            if (PlaylyTheme.motion.reduced) {
                CircularProgressIndicator(progress = { 0.25f }, modifier = Modifier.fillMaxSize(), color = colors.textSecondary, strokeWidth = 2.dp, trackColor = Color.Transparent)
            } else {
                CircularProgressIndicator(modifier = Modifier.fillMaxSize(), color = colors.textSecondary, strokeWidth = 2.dp, trackColor = Color.Transparent)
            }
        }
        Box(
            Modifier
                .size(PLAY_BUTTON)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clip(PlaylyTheme.shapes.pill)
                .background(colors.accent)
                .clickable(
                    interactionSource = interaction,
                    indication = androidx.compose.foundation.LocalIndication.current,
                    role = Role.Button,
                    onClick = onClick,
                )
                .semantics {
                    contentDescription = label
                    if (showSpinner) stateDescription = loading
                },
            contentAlignment = Alignment.Center,
        ) {
            Crossfade(targetState = showPlay, animationSpec = PlaylyTheme.motion.press(), label = "playIcon") { play ->
                PlaylyIcon(
                    if (play) R.drawable.ic_play else R.drawable.ic_pause,
                    contentDescription = null,
                    tint = colors.onAccent,
                    size = 36.dp,
                )
            }
        }
    }
}

private val TOP_BAR = 64.dp
/** Rough height of title, progress, controls and the speed / timer row under the cover (portrait). */
private val DETAILS_HEIGHT = 380.dp
private val MIN_ART = 120.dp
private const val SHEET_QUEUE = "queue"
private const val SHEET_SPEED = "speed"
private const val SHEET_SLEEP = "sleep"
private val PLAY_BUTTON = 72.dp
private const val BUFFERING_SPINNER_DELAY_MS = 400L
/** How much of the cover tint reaches the top of the player (0 = none). */
private const val TINT_STRENGTH = 0.22f
/** Fraction of the height where the tint has faded into the plain background. */
private const val TINT_FADE_END = 0.7f
private const val TICK_MS = 250L
private const val DISMISS_FRACTION = 0.22f
private const val DISMISS_VELOCITY = 1800f
private val SettleSpec = androidx.compose.animation.core.tween<Float>(
    durationMillis = PlaylyMotion.DURATION_MEDIUM,
    easing = PlaylyMotion.Standard,
)
