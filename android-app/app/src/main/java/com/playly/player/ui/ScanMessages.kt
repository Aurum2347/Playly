package com.playly.player.ui

import com.playly.player.R
import com.playly.player.data.library.scan.ScanReport

/** What the user is told after a rescan they asked for. Automatic scans stay silent. */
fun ScanReport.toMessages(): List<UiMessage> {
    if (failed) return listOf(UiMessage(R.string.message_scan_failed))
    val messages = ArrayList<UiMessage>(3)
    messages += if (hasChanges) {
        UiMessage(R.string.message_scan_changes, listOf(added, updated, missing))
    } else {
        UiMessage(R.string.message_scan_no_changes)
    }
    if (unreadable > 0) messages += UiMessage(R.string.message_scan_unreadable, listOf(unreadable))
    if (inaccessibleFolders > 0) messages += UiMessage(R.string.message_scan_folders_inaccessible, listOf(inaccessibleFolders))
    return messages
}
