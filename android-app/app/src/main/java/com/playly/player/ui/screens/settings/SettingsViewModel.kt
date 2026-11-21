package com.playly.player.ui.screens.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.artwork.CoverCache
import com.playly.player.data.backup.BackupRepository
import com.playly.player.data.backup.RestoreReport
import com.playly.player.data.backup.RestoreResult
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.SourceSummary
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.data.library.AddSourceResult
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.QueueEndAction
import com.playly.player.data.settings.AccentChoice
import com.playly.player.data.settings.ListDensity
import com.playly.player.core.ErrorLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.PlaybackController
import com.playly.player.playback.audio.Equalizer
import com.playly.player.ui.UiMessage
import com.playly.player.ui.container
import com.playly.player.ui.toMessages
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val reduceMotion: Boolean,
    val openPlayerOnPlay: Boolean,
    val playerArtworkTint: Boolean,
    val sources: List<SourceSummary>,
    val trackCount: Int,
    val unavailableCount: Int,
    val lastScanAt: Long?,
    val sound: SoundSettingsUi,
    /** Stage 9.1. */
    val minTrackSeconds: Int,
    val excludedFolders: List<String>,
    val playback: PlaybackSettingsUi,
    /** Stage 9.3. */
    val appearance: AppearanceSettingsUi,
)

/** Stage 9.3: accent, list rows. */
data class AppearanceSettingsUi(
    val accent: AccentChoice,
    val listDensity: ListDensity,
    val listArtwork: Boolean,
)

/** Stage 9.1: the "Playback" section. */
data class PlaybackSettingsUi(
    val resumePosition: Boolean,
    val pauseOnNoisy: Boolean,
    val queueEnd: QueueEndAction,
    /** Stage 9.3: the "Background" section. */
    val keepPlayingOnSwipe: Boolean,
)

/** Stage 8.3: the "Sound" section and the equaliser sheet. */
data class SoundSettingsUi(
    val eqEnabled: Boolean,
    val eqPreset: String,
    val eqGains: List<Float>,
    val mono: Boolean,
    val normalize: Boolean,
    val skipSilence: Boolean,
) {
    companion object {
        fun of(app: AppSettings) = SoundSettingsUi(
            app.eqEnabled, app.eqPreset, app.eqGains, app.monoAudio, app.normalizeVolume, app.skipSilence,
        )
    }
}

class SettingsViewModel(
    private val settings: SettingsRepository,
    private val library: LibraryRepository,
    private val playback: PlaybackController,
    private val backup: BackupRepository,
    private val covers: CoverCache,
) : ViewModel() {
    private val _messages = Channel<UiMessage>(Channel.BUFFERED)
    val messages: Flow<UiMessage> = _messages.receiveAsFlow()

    /** Null until the first values arrive, so the screen never shows wrong defaults. */
    val state: StateFlow<SettingsUiState?> = combine(
        settings.settings,
        library.snapshot,
        library.sourceSummaries,
        library.unavailableCount,
    ) { app, snapshot, sources, unavailable ->
        SettingsUiState(
            reduceMotion = app.reduceMotion,
            openPlayerOnPlay = app.openPlayerOnPlay,
            playerArtworkTint = app.playerArtworkTint,
            sources = sources,
            trackCount = snapshot.trackCount,
            unavailableCount = unavailable,
            lastScanAt = app.lastScanAt,
            sound = SoundSettingsUi.of(app),
            minTrackSeconds = app.minTrackSeconds,
            excludedFolders = app.excludedFolders.sortedWith(String.CASE_INSENSITIVE_ORDER),
            playback = PlaybackSettingsUi(app.resumePosition, app.pauseOnNoisy, app.queueEnd, app.keepPlayingOnSwipe),
            appearance = AppearanceSettingsUi(app.accent, app.listDensity, app.listArtwork),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val scanProgress: StateFlow<ScanProgress?> = library.scanProgress

    fun rescan() {
        viewModelScope.launch { library.rescan().toMessages().forEach { _messages.send(it) } }
    }

    fun setReduceMotion(enabled: Boolean) {
        viewModelScope.launch { settings.setReduceMotion(enabled) }
    }

    fun setOpenPlayerOnPlay(enabled: Boolean) {
        viewModelScope.launch { settings.setOpenPlayerOnPlay(enabled) }
    }

    fun setPlayerArtworkTint(enabled: Boolean) {
        viewModelScope.launch { settings.setPlayerArtworkTint(enabled) }
    }

    fun setEqEnabled(enabled: Boolean) = update { settings.setEqEnabled(enabled) }

    /** Choosing a preset (or a band below) also turns the equaliser on: that is what the user wants to hear. */
    fun chooseEqPreset(id: String) = update {
        settings.setEqPreset(id)
        settings.setEqEnabled(true)
    }

    fun setEqBand(band: Int, gainDb: Float) = update {
        settings.setEqBand(band, gainDb)
        settings.setEqEnabled(true)
    }

    fun resetEq() = update { settings.setEqPreset(Equalizer.FLAT) }

    fun setMonoAudio(enabled: Boolean) = update { settings.setMonoAudio(enabled) }

    fun setNormalizeVolume(enabled: Boolean) = update { settings.setNormalizeVolume(enabled) }

    fun setSkipSilence(enabled: Boolean) = update { settings.setSkipSilence(enabled) }

    /** The library rescans by itself when the filter changes (LibraryScanner.start). */
    fun setMinTrackSeconds(seconds: Int) = update { settings.setMinTrackSeconds(seconds) }

    fun includeFolder(path: String) = update {
        settings.includeFolder(path)
        _messages.send(UiMessage(R.string.message_folder_shown, path.substringAfterLast('/')))
    }

    fun setResumePosition(enabled: Boolean) = update { settings.setResumePosition(enabled) }

    fun setPauseOnNoisy(enabled: Boolean) = update { settings.setPauseOnNoisy(enabled) }

    fun setQueueEnd(action: QueueEndAction) = update { settings.setQueueEnd(action) }

    // --- Stage 9.3: appearance, background, error log ---

    fun setAccent(accent: AccentChoice) = update { settings.setAccent(accent) }

    fun setListDensity(density: ListDensity) = update { settings.setListDensity(density) }

    fun setListArtwork(enabled: Boolean) = update { settings.setListArtwork(enabled) }

    fun setKeepPlayingOnSwipe(enabled: Boolean) = update { settings.setKeepPlayingOnSwipe(enabled) }

    /** Entries in the local error log, for the row in "About". */
    val errorCount: StateFlow<Int> = ErrorLog.version
        .map { withContext(Dispatchers.IO) { ErrorLog.entries().size } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Unavailable rows go from the library, playlists, favourites and the player's queue. */
    fun forgetUnavailable() = update {
        val ids = library.forgetUnavailable()
        playback.forgetTracks(ids)
        _messages.send(UiMessage(R.plurals.message_forgot_unavailable, listOf(ids.size), quantity = ids.size))
    }

    // --- Stage 9.2: data and storage ------------------------------------------------------

    private val _busy = MutableStateFlow(false)
    /** True while a backup is written or read: the rows wait instead of starting a second one. */
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _coverCacheBytes = MutableStateFlow<Long?>(null)
    val coverCacheBytes: StateFlow<Long?> = _coverCacheBytes.asStateFlow()

    fun refreshCoverCache() = update { _coverCacheBytes.value = covers.sizeBytes() }

    /** Only resized copies of covers go; music files and the covers inside them stay. */
    fun clearCoverCache() = update {
        covers.clear()
        _coverCacheBytes.value = covers.sizeBytes()
        _messages.send(UiMessage(R.string.message_cover_cache_cleared))
    }

    fun exportBackup(uri: Uri) = busyWork {
        val playlists = backup.exportBackup(uri)
        _messages.send(
            if (playlists == null) UiMessage(R.string.message_backup_failed)
            else UiMessage(R.plurals.message_backup_saved, listOf(playlists), quantity = playlists),
        )
    }

    fun restoreBackup(uri: Uri) = busyWork {
        _messages.send(
            when (val result = backup.restoreBackup(uri)) {
                RestoreResult.NotABackup -> UiMessage(R.string.message_restore_not_backup)
                RestoreResult.Failed -> UiMessage(R.string.message_restore_failed)
                is RestoreResult.Restored -> restoredMessage(result.report)
            },
        )
    }

    private fun busyWork(block: suspend () -> Unit) {
        if (!_busy.compareAndSet(expect = false, update = true)) return
        viewModelScope.launch {
            try {
                block()
            } finally {
                _busy.value = false
            }
        }
    }

    private fun update(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    fun addSource(uri: Uri) {
        viewModelScope.launch {
            _messages.send(
                when (val result = library.addSource(uri)) {
                    is AddSourceResult.Added -> UiMessage(R.string.message_folder_added, result.name)
                    is AddSourceResult.AlreadyAdded -> UiMessage(R.string.message_folder_already_added, result.name)
                    AddSourceResult.AccessRefused -> UiMessage(R.string.message_folder_refused)
                },
            )
        }
    }

    fun removeSource(source: LibrarySourceEntity) {
        viewModelScope.launch {
            library.removeSource(source.id)
            _messages.send(UiMessage(R.string.message_folder_removed, source.displayName))
        }
    }

    companion object {
        /** "Playlists: 2 new, 1 merged · tracks found: 40, not found: 3 · favourites: 12". */
        fun restoredMessage(report: RestoreReport): UiMessage = UiMessage(
            R.string.message_restore_done,
            listOf(report.playlistsCreated, report.playlistsMerged, report.tracksFound, report.tracksMissing, report.favoritesAdded),
        )

        val Factory = viewModelFactory {
            initializer {
                SettingsViewModel(container.settings, container.library, container.playback, container.backup, container.coverCache)
            }
        }
    }
}
