package com.playly.player.ui.actions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.artwork.Artwork
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.playlists.PlaylistCard
import com.playly.player.data.playlists.PlaylistRepository
import com.playly.player.data.library.browse.CollectionKind
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackSource
import kotlin.random.Random
import androidx.annotation.DrawableRes
import com.playly.player.playback.QueueAddResult
import com.playly.player.ui.UiAction
import com.playly.player.ui.UiMessage
import com.playly.player.ui.container
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The track a "⋮" menu was opened for, and where from. */
data class TrackTarget(
    val trackId: Long,
    val title: String,
    val subtitle: String?,
    val artwork: Artwork?,
    /** Set when opened on a playlist page: offers "Remove from playlist". */
    val playlistEntry: PlaylistEntryRef? = null,
    /** False in the full-screen player: the current track cannot be queued after itself. */
    val queueActions: Boolean = true,
    /** Set when opened on a row of the queue: "Play next" moves it, "Remove from queue" drops it. */
    val queueUid: Long? = null,
)

data class PlaylistEntryRef(val playlistId: Long, val playlistName: String, val entryId: Long)

/** An album, artist, genre or folder whose "⋮" menu is open (stage 7). [trackIds] in play order. */
data class CollectionTarget(
    val kind: CollectionKind,
    val title: String,
    val subtitle: String?,
    val artwork: Artwork?,
    val trackIds: List<Long>,
    @DrawableRes val placeholderIcon: Int,
)

/** The one sheet that may be open (spec §12: reopening never stacks duplicates). */
sealed interface TrackSheet {
    data class Menu(val target: TrackTarget) : TrackSheet
    data class Details(val trackId: Long) : TrackSheet
    /** [single]: the one track being added, to mark playlists that already hold it. */
    data class AddToPlaylist(val trackIds: List<Long>, val single: TrackTarget?) : TrackSheet
    data class Collection(val target: CollectionTarget) : TrackSheet
}

/**
 * Track actions shared by every list and the player: queue, playlists, details, share.
 * Activity-scoped, so the open sheet survives rotation and a confirmation reaches the snackbar
 * whichever screen is visible.
 */
class TrackActionsViewModel(
    private val playback: PlaybackController,
    private val library: LibraryRepository,
    private val playlists: PlaylistRepository,
) : ViewModel() {
    private val _sheet = MutableStateFlow<TrackSheet?>(null)
    val sheet: StateFlow<TrackSheet?> = _sheet.asStateFlow()

    private val _messages = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = _messages.receiveAsFlow()

    /** For "Add to playlist"; only queried while that sheet is open. */
    val playlistCards: StateFlow<List<PlaylistCard>?> = playlists.cards
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun open(target: TrackTarget) {
        _sheet.value = TrackSheet.Menu(target)
    }

    fun openCollection(target: CollectionTarget) {
        if (target.trackIds.isNotEmpty()) _sheet.value = TrackSheet.Collection(target)
    }

    /** "Play" / "Shuffle" of a collection: its tracks become the queue. */
    fun playCollection(target: CollectionTarget, shuffle: Boolean) {
        val ids = target.trackIds
        if (ids.isEmpty()) return
        val start = if (shuffle) Random.nextInt(ids.size) else 0
        playback.playTracks(ids, start, shuffle = shuffle, source = PlaybackSource(target.kind.playbackKind, target.title))
    }

    fun openDetails(trackId: Long) {
        _sheet.value = TrackSheet.Details(trackId)
    }

    fun openAddToPlaylist(trackIds: List<Long>, single: TrackTarget? = null) {
        if (trackIds.isEmpty()) return
        _sheet.value = TrackSheet.AddToPlaylist(trackIds, single)
    }

    fun dismiss() {
        _sheet.value = null
    }

    suspend fun track(id: Long): TrackEntity? = library.track(id)

    fun containing(trackId: Long): Flow<Set<Long>> = playlists.containing(trackId)

    /** "Play next" ([next]) or "Add to queue". Never interrupts what plays. */
    fun queue(trackIds: List<Long>, next: Boolean) {
        viewModelScope.launch {
            val message = when (val result = playback.addToQueue(trackIds, next)) {
                is QueueAddResult.Added -> when {
                    result.started -> UiMessage(R.string.queue_message_started)
                    result.count == 1 -> UiMessage(if (next) R.string.queue_message_next else R.string.queue_message_added)
                    else -> UiMessage(
                        if (next) R.plurals.queue_message_next_many else R.plurals.queue_message_added_many,
                        listOf(result.count),
                        quantity = result.count,
                    )
                }
                QueueAddResult.Unavailable -> UiMessage(R.string.queue_message_unavailable)
                QueueAddResult.Failed -> UiMessage(R.string.queue_message_failed)
            }
            _messages.send(message)
        }
    }

    /** A queue row goes right after the current track, into the user's queue. */
    fun playNextInQueue(uid: Long) {
        playback.moveQueueItem(uid, afterUid = 0L, toQueue = true)
        _messages.trySend(UiMessage(R.string.queue_message_next))
    }

    fun removeFromQueue(uid: Long) {
        playback.removeFromQueue(listOf(uid))
        _messages.trySend(UiMessage(R.string.queue_message_removed))
    }

    /**
     * Adds to a playlist. Tracks already there are left out unless [allowDuplicates] (the user
     * confirmed "add again"); the message says so and offers "Undo".
     */
    fun addToPlaylist(playlistId: Long, playlistName: String, trackIds: List<Long>, allowDuplicates: Boolean = false) {
        viewModelScope.launch {
            val result = playlists.add(playlistId, trackIds, allowDuplicates)
            val added = result.addedEntryIds.size
            val undo = UiAction(R.string.action_undo) { viewModelScope.launch { playlists.undoAdd(result) } }
            val message = when {
                added == 0 -> UiMessage(R.string.playlist_message_already, listOf(playlistName))
                result.skippedDuplicates > 0 -> UiMessage(
                    R.plurals.playlist_message_added_skipped,
                    listOf(added, playlistName, result.skippedDuplicates),
                    quantity = added,
                    action = undo,
                )
                added == 1 -> UiMessage(R.string.playlist_message_added_one, listOf(playlistName), action = undo)
                else -> UiMessage(R.plurals.playlist_message_added_many, listOf(added, playlistName), quantity = added, action = undo)
            }
            _messages.send(message)
        }
    }

    /** "New playlist" from the add sheet: creates it and puts the tracks in. */
    fun createPlaylistAndAdd(name: String, trackIds: List<Long>) {
        viewModelScope.launch {
            val id = playlists.create(name) ?: return@launch
            val result = playlists.add(id, trackIds)
            _messages.send(
                UiMessage(R.plurals.playlist_message_created_with, listOf(name.trim(), result.addedEntryIds.size), quantity = result.addedEntryIds.size),
            )
        }
    }

    /** Takes the entry out of its playlist (the file stays), with "Undo". */
    fun removeFromPlaylist(ref: PlaylistEntryRef) {
        viewModelScope.launch {
            val removed = playlists.remove(ref.playlistId, listOf(ref.entryId))
            if (removed.count == 0) return@launch
            _messages.send(
                UiMessage(
                    R.string.playlist_message_removed,
                    listOf(ref.playlistName),
                    action = UiAction(R.string.action_undo) { viewModelScope.launch { playlists.restore(removed) } },
                ),
            )
        }
    }

    fun notify(message: UiMessage) {
        _messages.trySend(message)
    }

    companion object {
        val Factory = viewModelFactory {
            initializer { TrackActionsViewModel(container.playback, container.library, container.playlists) }
        }
    }
}

/** How a collection's queue is labelled in the player ("Album “…”"). */
val CollectionKind.playbackKind: PlaybackSource.Kind
    get() = when (this) {
        CollectionKind.Album -> PlaybackSource.Kind.Album
        CollectionKind.Artist -> PlaybackSource.Kind.Artist
        CollectionKind.Genre -> PlaybackSource.Kind.Genre
        CollectionKind.Folder -> PlaybackSource.Kind.Folder
    }
