package com.playly.player

import android.content.Context
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.library.scan.LibraryScanner
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.data.settings.settingsDataStore
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.PlaybackStateStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Manual dependency wiring. Everything is lazy so cold start only opens what the first screen needs. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** Work that outlives any screen (scans). Never cancelled: it lives as long as the process. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val database: PlaylyDatabase by lazy { PlaylyDatabase.build(appContext) }
    val settings: SettingsRepository by lazy { SettingsRepository(appContext.settingsDataStore) }
    val scanner: LibraryScanner by lazy { LibraryScanner(appContext, database, settings, appScope) }
    val library: LibraryRepository by lazy {
        LibraryRepository(appContext.contentResolver, database, settings, scanner)
    }

    /** Saved queue and position; written by the playback service, outside of Room on purpose (one atomic file). */
    val playbackStore: PlaybackStateStore by lazy { PlaybackStateStore(appContext.filesDir) }

    /** The UI's view of the playback session (main thread). */
    val playback: PlaybackController by lazy { PlaybackController(appContext) }
}
