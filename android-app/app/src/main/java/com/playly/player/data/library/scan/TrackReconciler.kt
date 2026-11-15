package com.playly.player.data.library.scan

import com.playly.player.data.db.TrackEntity

/** What a scan changes in the database. Nothing is deleted: vanished files are only flagged. */
data class ReconcileResult(
    val inserts: List<TrackEntity>,
    val updates: List<TrackEntity>,
    val missingIds: List<Long>,
    val unchanged: Int,
) {
    val hasChanges: Boolean get() = inserts.isNotEmpty() || updates.isNotEmpty() || missingIds.isNotEmpty()
}

/**
 * Diffs what is on the device against what the database knows, for one origin
 * (MediaStore, or one folder). Pure and allocation-light, so 10k+ tracks diff in milliseconds.
 */
object TrackReconciler {
    private data class NameSize(val fileName: String, val sizeBytes: Long)

    /**
     * @param existing rows that belong to this origin (available or not).
     * @param scanned what the scan found now; ids are ignored.
     * @param identity the origin's stable key: MediaStore id, or document URI for folders.
     */
    fun <K : Any> reconcile(
        existing: List<TrackEntity>,
        scanned: List<TrackEntity>,
        identity: (TrackEntity) -> K?,
    ): ReconcileResult {
        val byIdentity = HashMap<K, TrackEntity>(existing.size * 2)
        existing.forEach { row -> identity(row)?.let { byIdentity[it] = row } }

        val claimed = HashSet<Long>(existing.size * 2)
        val updates = ArrayList<TrackEntity>()
        val unmatched = ArrayList<TrackEntity>()
        var unchanged = 0
        for (found in scanned) {
            val row = identity(found)?.let(byIdentity::get)
            if (row == null || !claimed.add(row.id)) {
                unmatched += found
                continue
            }
            val merged = merge(row, found)
            if (merged == row) unchanged++ else updates += merged
        }

        // A file moved or renamed by another app gets a new identity. Like the desktop's
        // relink, reuse the vanished row with the same name and size so playlists keep it.
        val relinkPool = existing.asSequence()
            .filter { it.id !in claimed && it.sizeBytes > 0 }
            .groupBy { NameSize(it.fileName, it.sizeBytes) }
        val inserts = ArrayList<TrackEntity>()
        for (found in unmatched) {
            val candidates = relinkPool[NameSize(found.fileName, found.sizeBytes)]
                ?.filter { it.id !in claimed }
                .orEmpty()
            val match = candidates.singleOrNull()
            if (match != null && found.sizeBytes > 0) {
                claimed += match.id
                updates += merge(match, found)
            } else {
                inserts += found.copy(id = 0)
            }
        }

        val missing = existing.filter { it.id !in claimed && it.isAvailable }.map { it.id }
        return ReconcileResult(inserts, updates, missing, unchanged)
    }

    /** Scanned facts on top of an existing row: keeps the id and the first-seen date. */
    fun merge(row: TrackEntity, found: TrackEntity): TrackEntity =
        found.copy(id = row.id, dateAdded = row.dateAdded, isAvailable = true, missingSince = null)
}
