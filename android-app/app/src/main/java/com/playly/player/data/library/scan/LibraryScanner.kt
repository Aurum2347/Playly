package com.playly.player.data.library.scan

import com.playly.player.core.ErrorLog
import android.content.Context
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.room.withTransaction
import com.playly.player.data.db.LibrarySourceEntity
import com.playly.player.data.db.PlaylyDatabase
import com.playly.player.data.db.SQLITE_MAX_ARGS
import com.playly.player.data.db.TrackEntity
import com.playly.player.data.db.TrackLocation
import com.playly.player.data.settings.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** What to scan. Requests that arrive while a scan runs are merged and run once afterwards. */
data class ScanPlan(
    val allFolders: Boolean = false,
    val folderIds: Set<Long> = emptySet(),
) {
    fun merge(other: ScanPlan) = ScanPlan(
        allFolders = allFolders || other.allFolders,
        folderIds = folderIds + other.folderIds,
    )

    companion object {
        val FULL = ScanPlan(allFolders = true)
        fun folder(id: Long) = ScanPlan(folderIds = setOf(id))
    }
}

data class ScanReport(
    val added: Int = 0,
    val updated: Int = 0,
    val missing: Int = 0,
    val unreadable: Int = 0,
    val inaccessibleFolders: Int = 0,
    val failed: Boolean = false,
) {
    val hasChanges: Boolean get() = added > 0 || updated > 0 || missing > 0

    operator fun plus(other: ScanReport) = ScanReport(
        added + other.added,
        updated + other.updated,
        missing + other.missing,
        unreadable + other.unreadable,
        inaccessibleFolders + other.inaccessibleFolders,
        failed || other.failed,
    )
}

/** Files found so far in the running scan. */
data class ScanProgress(val found: Int)

/**
 * Owns library discovery: one scan at a time, off the main thread, writing each origin's
 * changes in a single transaction so a crash never leaves a half-applied diff.
 *
 * The library is the music folder the user picked (SAF), nothing else on the device.
 * Triggers: app comes to the foreground, the folder is picked, or the user asks for a rescan.
 */
class LibraryScanner(
    context: Context,
    private val database: PlaylyDatabase,
    private val settings: SettingsRepository,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val tracks = database.trackDao()
    private val sources = database.librarySourceDao()
    private val folderScanner = FolderScanner(context.applicationContext)

    private val _progress = MutableStateFlow<ScanProgress?>(null)
    /** Non-null while a scan runs. */
    val progress: StateFlow<ScanProgress?> = _progress.asStateFlow()

    private val _lastFailed = MutableStateFlow(false)
    /** True when the most recent scan threw; cleared by the next successful one. */
    val lastFailed: StateFlow<Boolean> = _lastFailed.asStateFlow()

    private val lock = Any()
    private var pending: ScanPlan? = null
    private val waiters = ArrayList<CompletableDeferred<ScanReport>>()
    private var worker: Job? = null
    @Volatile private var lastFolderScanAt = 0L

    /** Queues [plan]; the result completes when a scan covering it has finished. */
    fun request(plan: ScanPlan): Deferred<ScanReport> {
        val done = CompletableDeferred<ScanReport>()
        synchronized(lock) {
            pending = pending?.merge(plan) ?: plan
            waiters += done
            if (worker?.isActive != true) worker = scope.launch { drain() }
        }
        return done
    }

    private suspend fun drain() {
        while (true) {
            val plan: ScanPlan
            val listeners: List<CompletableDeferred<ScanReport>>
            synchronized(lock) {
                val next = pending
                if (next == null) {
                    worker = null
                    return
                }
                plan = next
                pending = null
                listeners = waiters.toList()
                waiters.clear()
            }
            val report = execute(plan)
            listeners.forEach { it.complete(report) }
        }
    }

    private suspend fun execute(plan: ScanPlan): ScanReport {
        _progress.value = ScanProgress(0)
        return try {
            val now = clock()
            var report = ScanReport()
            var foundBefore = 0
            // Read once: a filter changed during the scan queues another one (see start()).
            val filter = settings.settings.first().libraryFilter
            if (plan.allFolders) report += retireMediaStoreTracks(now)
            if (plan.allFolders || plan.folderIds.isNotEmpty()) {
                val all = sources.all()
                val chosen = if (plan.allFolders) all else all.filter { it.id in plan.folderIds }
                for (source in chosen) {
                    val (result, found) = scanFolder(source, filter, now, foundBefore)
                    report += result
                    foundBefore += found
                }
                if (plan.allFolders) lastFolderScanAt = now
            }
            settings.setLastScanAt(clock())
            _lastFailed.value = false
            Log.i(TAG, "Scan $plan → $report in ${clock() - now} ms")
            report
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            ErrorLog.e(TAG, "Scan failed", e)
            _lastFailed.value = true
            ScanReport(failed = true)
        } finally {
            _progress.value = null
        }
    }

    /**
     * Installs from before the "one folder" library listed every audio file on the device via
     * MediaStore. Those rows go (or stay flagged for playlists) so only the chosen folder shows.
     */
    private suspend fun retireMediaStoreTracks(now: Long): ScanReport {
        var gone = 0
        database.withTransaction {
            gone = tracks.deleteUnreferencedMediaStore() + tracks.markMediaStoreMissing(now)
        }
        return ScanReport(missing = gone)
    }

    private suspend fun scanFolder(
        source: LibrarySourceEntity,
        filter: LibraryFilter,
        now: Long,
        foundBefore: Int,
    ): Pair<ScanReport, Int> {
        val existing = tracks.folderTracks(source.id)
        val known = existing.associateBy { it.uri }
        val scan = folderScanner.scan(source, known, now) { _progress.value = ScanProgress(foundBefore + it) }
        return when (scan) {
            FolderScanResult.Inaccessible -> {
                val lost = existing.count { it.sourceId == source.id && it.isAvailable }
                database.withTransaction {
                    if (sources.get(source.id) != null) {
                        sources.updateScanState(source.id, accessible = false, scannedAt = null)
                        tracks.markSourceMissing(source.id, now)
                    }
                }
                ScanReport(missing = lost, inaccessibleFolders = 1) to 0
            }
            is FolderScanResult.Found -> {
                // A file reachable through another folder is listed once.
                val own = existing.mapTo(HashSet()) { it.id }
                val elsewhere = tracks.availableLocations().asSequence()
                    .filter { it.id !in own }
                    .mapNotNull { it.key() }
                    .toHashSet()
                val kept = scan.tracks.filter { it.key() == null || it.key() !in elsewhere }
                // Stage 9.1: hidden files count as absent from the folder.
                val visible = if (filter.isEmpty) kept else kept.filterNot(filter::hides)
                val result = TrackReconciler.reconcile(existing, visible) { it.uri }
                val hiddenIds = if (visible.size == kept.size) emptyList() else hiddenRowIds(existing, kept, visible, result)
                var applied = false
                database.withTransaction {
                    // The user may have removed the folder while it was being read.
                    if (sources.get(source.id) == null) return@withTransaction
                    apply(result, now)
                    // Hidden rows nothing needs are forgotten; the rest stay flagged unavailable.
                    hiddenIds.chunked(SQLITE_MAX_ARGS).forEach { tracks.deleteUnreferenced(it) }
                    sources.updateScanState(source.id, accessible = true, scannedAt = now)
                    applied = true
                }
                if (!applied) return ScanReport() to 0
                val missing = result.missingIds.size - hiddenIds.size
                ScanReport(result.inserts.size, result.updates.size, missing, scan.unreadable) to visible.size
            }
        }
    }

    /** Must run inside a transaction. */
    private suspend fun apply(result: ReconcileResult, now: Long) {
        result.inserts.chunked(WRITE_CHUNK).forEach { tracks.insertAll(it) }
        result.updates.chunked(WRITE_CHUNK).forEach { tracks.updateAll(it) }
        result.missingIds.chunked(SQLITE_MAX_ARGS).forEach { tracks.markMissing(it, now) }
    }

    // --- Automatic triggers -------------------------------------------------------------

    /** Wires the foreground trigger. Call once from Application.onCreate. */
    fun start() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // SAF has no reliable change feed: catch up with files copied in meanwhile.
                // Unchanged files are not reopened, so a rescan is mostly a directory listing.
                if (clock() - lastFolderScanAt >= FOLDER_RESCAN_INTERVAL_MS) request(ScanPlan.FULL)
            }
        })
        // Stage 9.1: a changed filter (short tracks, hidden folders) applies at once.
        scope.launch {
            settings.settings.map { it.libraryFilter }.distinctUntilChanged().drop(1).collect { request(ScanPlan.FULL) }
        }
    }

    private data class LocationKey(val folder: String, val fileName: String, val size: Long)

    private fun TrackLocation.key(): LocationKey? =
        folderPath?.takeIf { sizeBytes > 0 }?.let { LocationKey(it, fileName, sizeBytes) }

    private fun TrackEntity.key(): LocationKey? =
        folderPath?.takeIf { sizeBytes > 0 }?.let { LocationKey(it, fileName, sizeBytes) }

    private companion object {
        const val TAG = "PlaylyScanner"
        const val WRITE_CHUNK = 500
        /** Returning to the app within this window does not walk the folder again. */
        const val FOLDER_RESCAN_INTERVAL_MS = 60_000L
    }
}
