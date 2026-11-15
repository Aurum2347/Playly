package com.playly.player.data.library.browse

import com.playly.player.data.db.TrackDao
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.shareIn

/**
 * One shared [LibraryIndex] for the library tabs, collection pages, search and track menus.
 * It is rebuilt off the main thread when the library changes, and only while someone looks.
 */
class LibraryBrowser(tracks: TrackDao, scope: CoroutineScope) {
    val index: Flow<LibraryIndex> = tracks.observeBrowse()
        .map { LibraryIndex.build(it) }
        .flowOn(Dispatchers.Default)
        .shareIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), replay = 1)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
