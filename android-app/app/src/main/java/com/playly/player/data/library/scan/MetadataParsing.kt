package com.playly.player.data.library.scan

import java.util.Locale

/** Pure helpers shared by the MediaStore and folder scanners. No Android types, so JVM-testable. */
object MetadataParsing {
    /** Same list as the desktop (src/lib/trackLoader.ts AUDIO_EXT); used when a provider reports no audio MIME type. */
    val AUDIO_EXTENSIONS = setOf("mp3", "wav", "m4a", "flac", "ogg", "oga", "aac", "opus", "wma", "aif", "aiff", "weba")

    /** Playlist and cue files carry "audio/..." MIME types but are not playable tracks. */
    private val NON_TRACK_MIME = setOf("audio/x-mpegurl", "audio/mpegurl", "audio/x-scpls", "audio/x-cue")

    /** MediaStore writes this for tags it could not read. */
    private const val UNKNOWN = "<unknown>"

    private val leadingNumber = Regex("""^\s*(\d+)""")
    private val leadingYear = Regex("""^(\d{4})""")
    private val year = Regex("""(?<!\d)(1\d{3}|2\d{3})(?!\d)""")
    private val storageRoot = Regex("""^/(?:storage/emulated/\d+|storage/[^/]+|sdcard|mnt/sdcard)/""")

    fun cleanTag(value: String?): String? {
        val trimmed = value?.trim() ?: return null
        return trimmed.takeIf { it.isNotEmpty() && !it.equals(UNKNOWN, ignoreCase = true) }
    }

    /** "3/12" → 3, "07" → 7; null when there is no positive number. */
    fun parseNumber(value: String?): Int? =
        value?.let { leadingNumber.find(it)?.groupValues?.get(1)?.toIntOrNull() }?.takeIf { it > 0 }

    /** Any plausible four-digit year inside "2019", "2019-05-01" or "20190501T000000". */
    fun parseYear(value: String?): Int? =
        value?.trim()?.let { (leadingYear.find(it) ?: year.find(it))?.groupValues?.get(1)?.toIntOrNull() }
            ?.takeIf { it in 1000..2999 }

    /** MediaStore's legacy TRACK column packs the disc into the thousands: 2005 → disc 2, track 5. */
    fun splitLegacyTrack(value: Int): Pair<Int?, Int?> {
        if (value <= 0) return null to null
        val disc = value / 1000
        val track = value % 1000
        return disc.takeIf { it > 0 } to track.takeIf { it > 0 }
    }

    fun titleFromFileName(fileName: String): String {
        val base = fileName.substringBeforeLast('.', fileName).trim()
        return base.ifEmpty { fileName }
    }

    fun extension(fileName: String): String =
        fileName.substringAfterLast('.', "").lowercase(Locale.ROOT)

    fun isAudioFile(fileName: String, mimeType: String?): Boolean {
        val mime = mimeType?.lowercase(Locale.ROOT)
        if (mime != null && mime in NON_TRACK_MIME) return false
        return mime?.startsWith("audio/") == true || extension(fileName) in AUDIO_EXTENSIONS
    }

    /** "Music/Album/" → "Music/Album"; the volume root is "". */
    fun folderFromRelativePath(relativePath: String?): String =
        relativePath.orEmpty().replace('\\', '/').trim('/')

    /** "/storage/emulated/0/Music/Album/x.mp3" → "Music/Album" (Android 9 has no RELATIVE_PATH). */
    fun folderFromAbsolutePath(path: String?): String? {
        if (path.isNullOrBlank()) return null
        val parent = path.replace('\\', '/').substringBeforeLast('/', "")
        val relative = storageRoot.find("$parent/")?.let { "$parent/".substring(it.range.last + 1) } ?: return parent.trim('/')
        return relative.trim('/')
    }

    /**
     * External-storage document ids look like "primary:Music/Album/x.mp3" or "1A2B-3C4D:Music/x.mp3".
     * Returns the volume-relative folder, matching MediaStore's RELATIVE_PATH for the same file.
     */
    fun folderFromExternalDocumentId(documentId: String): String? {
        if (':' !in documentId) return null
        val path = documentId.substringAfter(':')
        return path.substringBeforeLast('/', "").trim('/')
    }
}
