package com.playly.player.ui.screens.settings

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.playly.player.R
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.SourceSummary
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.data.library.AddSourceResult
import com.playly.player.data.library.LibraryRepository
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.ui.UiMessage
import com.playly.player.ui.container
import com.playly.player.ui.toMessages
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
)

class SettingsViewModel(
    private val settings: SettingsRepository,
    private val library: LibraryRepository,
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
        SettingsUiState(app.reduceMotion, app.openPlayerOnPlay, app.playerArtworkTint, sources, snapshot.trackCount, unavailable, app.lastScanAt)
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
        val Factory = viewModelFactory { initializer { SettingsViewModel(container.settings, container.library) } }
    }
}
