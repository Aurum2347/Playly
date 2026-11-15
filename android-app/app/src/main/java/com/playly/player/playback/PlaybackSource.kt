package com.playly.player.playback

import android.os.Bundle

/**
 * Where the current queue came from, for the player's top bar ("Playing from: All tracks").
 * Travels as session extras, so every controller shows the same, and is saved with the queue.
 * [label] carries user text (the search query); the kind's name is resolved by the UI.
 */
data class PlaybackSource(val kind: Kind, val label: String? = null) {
    enum class Kind { AllTracks, Recent, Search }

    fun toBundle(): Bundle = Bundle().apply {
        putString(KEY_KIND, kind.name)
        label?.let { putString(KEY_LABEL, it) }
    }

    companion object {
        private const val KEY_KIND = "playly.source.kind"
        private const val KEY_LABEL = "playly.source.label"

        fun from(bundle: Bundle?): PlaybackSource? = parse(bundle?.getString(KEY_KIND), bundle?.getString(KEY_LABEL))

        /** Lenient: an unknown kind (from an older or newer build) means "no source", never a crash. */
        fun parse(kind: String?, label: String?): PlaybackSource? {
            val parsed = Kind.entries.firstOrNull { it.name == kind } ?: return null
            return PlaybackSource(parsed, label?.takeIf { it.isNotBlank() })
        }
    }
}
