package com.playly.player.playback

import android.os.Bundle
import androidx.media3.session.SessionCommand

/** Commands Playly adds on top of the standard player commands. */
object PlaybackCommands {
    /** Controller → session: toggle shuffle (the notification button, too). */
    val TOGGLE_SHUFFLE = SessionCommand("com.playly.player.TOGGLE_SHUFFLE", Bundle.EMPTY)

    /** Controller → session: off → all → one. */
    val CYCLE_REPEAT = SessionCommand("com.playly.player.CYCLE_REPEAT", Bundle.EMPTY)

    /**
     * Controller → session: play [ARG_TRACK_IDS] (LongArray) starting at [ARG_START_INDEX].
     * Only ids cross the binder; the session builds the queue, so controllers never show a
     * half-filled placeholder queue and a rejected request leaves the current one untouched.
     */
    val PLAY_TRACKS = SessionCommand("com.playly.player.PLAY_TRACKS", Bundle.EMPTY)
    const val ARG_TRACK_IDS = "track_ids"
    const val ARG_START_INDEX = "start_index"
    /** Optional Boolean: turn shuffle on for this queue ("Play" / "Shuffle" buttons). */
    const val ARG_SHUFFLE = "shuffle"
    /** Optional: [PlaybackSource] of the new queue, as [PlaybackSource.toBundle]. */
    const val ARG_SOURCE = "source"

    /**
     * Controller → session: put [ARG_TRACK_IDS] into the user's queue, right after the current
     * track when [ARG_NEXT] is true, else after the queue's other user-added tracks. Starts
     * playback when nothing is queued. Result extras: [ARG_ADDED], [ARG_STARTED].
     */
    val QUEUE_ADD = SessionCommand("com.playly.player.QUEUE_ADD", Bundle.EMPTY)
    const val ARG_NEXT = "next"
    const val ARG_ADDED = "added"
    const val ARG_STARTED = "started"

    /** Controller → session: move [ARG_UID] after [ARG_AFTER_UID] (0 = after the current track); [ARG_QUEUED]: dropped in the user's queue. */
    val QUEUE_MOVE = SessionCommand("com.playly.player.QUEUE_MOVE", Bundle.EMPTY)
    const val ARG_UID = "uid"
    const val ARG_AFTER_UID = "after_uid"
    const val ARG_QUEUED = "queued"

    /** Controller → session: remove the rows [ARG_UIDS] (LongArray); the current track stays. */
    val QUEUE_REMOVE = SessionCommand("com.playly.player.QUEUE_REMOVE", Bundle.EMPTY)
    const val ARG_UIDS = "uids"

    /** Controller → session: remove everything after the current track. */
    val QUEUE_CLEAR_UPCOMING = SessionCommand("com.playly.player.QUEUE_CLEAR_UPCOMING", Bundle.EMPTY)

    /** Session extras key: uids of the user's queue (LongArray), next to the [PlaybackSource]. */
    const val EXTRA_QUEUED_UIDS = "playly.queued"

    /** Session → controllers: a track could not be played. Args: [ARG_KIND], [ARG_TITLE], [ARG_TRACK_ID], [ARG_SKIPPED]. */
    const val EVENT_ERROR = "com.playly.player.EVENT_ERROR"

    /** Session → controllers: none of the requested tracks can be played any more. */
    const val EVENT_NOTHING_PLAYABLE = "com.playly.player.EVENT_NOTHING_PLAYABLE"

    const val ARG_KIND = "kind"
    const val ARG_TITLE = "title"
    const val ARG_TRACK_ID = "track_id"
    const val ARG_SKIPPED = "skipped"

    /** Activity action used by the notification; the full-screen player opens on it. */
    const val ACTION_OPEN_PLAYER = "com.playly.player.action.OPEN_PLAYER"
}
