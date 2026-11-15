package com.playly.player.data.library

import com.playly.player.data.db.LibrarySourceEntity

/** Progress of discovering music on the device. Stage 2 (scanner) drives the transitions. */
sealed interface ScanStatus {
    data object NeverScanned : ScanStatus
    data object Scanning : ScanStatus
    data class Idle(val lastScanAt: Long) : ScanStatus
    /** The last scan threw; [lastScanAt] is the last one that succeeded, if any. */
    data class Failed(val lastScanAt: Long?) : ScanStatus
}

/** Raw library facts combined from the database and settings. */
data class LibrarySnapshot(
    val sources: List<LibrarySourceEntity>,
    val trackCount: Int,
    val totalDurationMs: Long,
    val scan: ScanStatus,
)

/** What a library-backed screen should show. */
sealed interface LibraryContent {
    /** No music folder picked yet: nothing can be read. */
    data object NoFolder : LibraryContent
    /** A folder is picked, but no scan has run, so "no music" would be a false claim. */
    data object NotScanned : LibraryContent
    data object Scanning : LibraryContent
    /** A scan finished and found nothing playable. */
    data object Empty : LibraryContent
    /** Nothing to show and the scan failed: offer a retry, never claim "no music". */
    data object ScanFailed : LibraryContent
    data class Tracks(val count: Int, val totalDurationMs: Long) : LibraryContent

    companion object {
        fun from(snapshot: LibrarySnapshot): LibraryContent = when {
            snapshot.trackCount > 0 -> Tracks(snapshot.trackCount, snapshot.totalDurationMs)
            snapshot.scan is ScanStatus.Scanning -> Scanning
            snapshot.sources.isEmpty() -> NoFolder
            snapshot.scan is ScanStatus.Failed -> ScanFailed
            snapshot.scan is ScanStatus.NeverScanned -> NotScanned
            else -> Empty
        }
    }
}
