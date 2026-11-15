package com.playly.player.data.library

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.core.net.toUri
import androidx.room.withTransaction
import com.playly.player.core.SearchText
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.PlaylistSummary
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SourceSummary
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.db.TrackListItem
import com.playly.player.data.library.scan.LibraryScanner
import com.playly.player.data.library.scan.ScanPlan
import com.playly.player.data.library.scan.ScanProgress
import com.playly.player.data.library.scan.ScanReport
import com.playly.player.data.settings.SettingsRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

sealed interface AddSourceResult {
    data class Added(val id: Long, val name: String) : AddSourceResult
    data class AlreadyAdded(val name: String) : AddSourceResult
    /** The provider refused a persistable grant (e.g. a removed SD card or a non-SAF URI). */
    data object AccessRefused : AddSourceResult
}

/**
 * Single entry point for library data. UI and (later) the player go through it,
 * never through DAOs directly.
 */
class LibraryRepository(
    private val resolver: ContentResolver,
    private val database: PlaylyDatabase,
    settings: SettingsRepository,
    private val scanner: LibraryScanner,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val tracks = database.trackDao()
    private val sourcesDao = database.librarySourceDao()
    private val playlists = database.playlistDao()

    val sources: Flow<List<LibrarySourceEntity>> = sourcesDao.observeAll()

    /** Folders with how many available tracks each one contributes. */
    val sourceSummaries: Flow<List<SourceSummary>> = sourcesDao.observeSummaries()

    /** Every available track, sorted for display. */
    val trackList: Flow<List<TrackListItem>> = tracks.observeList()

    /** Tracks whose files vanished or became unreadable; kept for playlists. */
    val unavailableCount: Flow<Int> = tracks.observeUnavailableCount()

    val scanProgress: StateFlow<ScanProgress?> = scanner.progress

    val playlistSummaries: Flow<List<PlaylistSummary>> = playlists.observeSummaries()

    /** Distinct available tracks, most recently started first (Home, "Recently played"). */
    fun recentlyPlayed(limit: Int): Flow<List<TrackListItem>> = database.playHistoryDao().observeRecent(limit)

    val snapshot: Flow<LibrarySnapshot> = combine(
        sources,
        tracks.observeSummary(),
        settings.settings.map { it.lastScanAt }.distinctUntilChanged(),
        combine(scanner.progress.map { it != null }.distinctUntilChanged(), scanner.lastFailed, ::Pair),
    ) { sourceList, summary, lastScanAt, (isScanning, failed) ->
        LibrarySnapshot(
            sources = sourceList,
            trackCount = summary.trackCount,
            totalDurationMs = summary.totalDurationMs,
            scan = when {
                isScanning -> ScanStatus.Scanning
                failed -> ScanStatus.Failed(lastScanAt)
                lastScanAt == null -> ScanStatus.NeverScanned
                else -> ScanStatus.Idle(lastScanAt)
            },
        )
    }

    suspend fun searchTracks(query: String, limit: Int = 200): List<TrackEntity> {
        val key = SearchText.normalize(query)
        if (key.isEmpty()) return emptyList()
        return tracks.search(SearchText.escapeLike(key), limit)
    }

    /** One track with all its tags, for "File details". Null once it left the library. */
    suspend fun track(id: Long): TrackEntity? = tracks.byIds(listOf(id)).firstOrNull()

    /**
     * Makes the folder picked with ACTION_OPEN_DOCUMENT_TREE the music folder: its access is
     * persisted and the previous folder is forgotten (one folder, like the desktop app).
     */
    suspend fun addSource(treeUri: Uri): AddSourceResult = withContext(io) {
        try {
            resolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            return@withContext AddSourceResult.AccessRefused
        }
        val uriString = treeUri.toString()
        sourcesDao.findByUri(uriString)?.let { existing ->
            // Picking a known folder again renews its grant: rescan so lost access recovers.
            scanner.request(ScanPlan.folder(existing.id))
            return@withContext AddSourceResult.AlreadyAdded(existing.displayName)
        }
        val name = displayName(treeUri)
        val id = sourcesDao.insert(
            LibrarySourceEntity(treeUri = uriString, displayName = name, addedAt = System.currentTimeMillis()),
        )
        if (id == -1L) return@withContext AddSourceResult.AlreadyAdded(name)
        sourcesDao.all().filter { it.id != id }.forEach { removeSource(it.id) }
        scanner.request(ScanPlan.folder(id))
        AddSourceResult.Added(id, name)
    }

    /** Full incremental rescan; completes with what changed. */
    suspend fun rescan(): ScanReport = scanner.request(ScanPlan.FULL).await()

    /** Forgets a folder and gives its URI grant back. Files on the device are never touched. */
    suspend fun removeSource(id: Long) = withContext(io) {
        val source = sourcesDao.get(id) ?: return@withContext
        database.withTransaction {
            // Tracks only this folder provided disappear; those in playlists stay as unavailable.
            tracks.deleteUnreferencedFromSource(id)
            tracks.markSourceMissing(id, clock())
            sourcesDao.delete(id)
        }
        try {
            resolver.releasePersistableUriPermission(source.treeUri.toUri(), Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) {
            // Already revoked by the system; the row is gone either way.
        }
    }

    private fun displayName(treeUri: Uri): String {
        val documentId = runCatching { DocumentsContract.getTreeDocumentId(treeUri) }.getOrNull()
        val documentUri = documentId?.let { DocumentsContract.buildDocumentUriUsingTree(treeUri, it) }
        val queried = documentUri?.let { uri ->
            runCatching {
                resolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getString(0) else null
                }
            }.getOrNull()
        }
        return queried?.takeIf { it.isNotBlank() }
            ?: documentId?.substringAfter(':')?.takeIf { it.isNotBlank() }
            ?: treeUri.lastPathSegment
            ?: treeUri.toString()
    }
}
