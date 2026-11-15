package com.playly.player.data.library.browse

import com.playly.player.data.db.BrowseTrack
import com.playly.player.data.db.TrackListItem

/**
 * The folder tree of the library. Paths are what the scanner stored ("Music/Rock/Album"); the
 * root is the deepest folder every track lives under, so the tab opens on the music folder
 * itself rather than on "Music" with one child. Tracks without a path sit in the root.
 */
internal object FolderTree {
    fun build(rows: List<BrowseTrack>): FolderNode? {
        if (rows.isEmpty()) return null
        val byFolder = LinkedHashMap<String, MutableList<TrackListItem>>()
        val unplaced = ArrayList<TrackListItem>()
        for (row in rows) {
            val path = row.folderPath?.trim('/')?.takeIf { it.isNotEmpty() }
            if (path == null) unplaced += row.track else byFolder.getOrPut(path, ::ArrayList) += row.track
        }
        val root = commonRoot(byFolder.keys)
        val children = HashMap<String, MutableSet<String>>()
        for (path in byFolder.keys) {
            var current = path
            while (current != root) {
                val parent = parentOf(current, root)
                children.getOrPut(parent, ::LinkedHashSet) += current
                current = parent
            }
        }
        fun node(path: String): FolderNode = FolderNode(
            path = path,
            name = path.substringAfterLast('/'),
            subfolders = children[path].orEmpty().map(::node).sortedFoldersFor(GroupSort.Name),
            tracks = if (path == root) unplaced + byFolder[path].orEmpty() else byFolder[path].orEmpty(),
        )
        return node(root)
    }

    /** Deepest common folder of [paths]; "" when they share none (or there are none). */
    fun commonRoot(paths: Collection<String>): String {
        if (paths.isEmpty()) return ""
        var common = paths.first().split('/')
        for (path in paths) {
            val parts = path.split('/')
            val same = common.zip(parts).takeWhile { (a, b) -> a == b }.size
            if (same < common.size) common = common.take(same)
        }
        return common.joinToString("/")
    }

    private fun parentOf(path: String, root: String): String {
        val cut = path.lastIndexOf('/')
        return if (cut <= 0 || cut < root.length) root else path.substring(0, cut)
    }
}
