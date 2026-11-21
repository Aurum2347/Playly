package com.playly.player.core

import java.net.URLDecoder

/** One recorded error: when, where (a short tag) and what (already stripped of private paths). */
data class ErrorLogEntry(val timeMs: Long, val tag: String, val text: String)

/**
 * Stage 9.3: the text format of the error log, kept free of Android so it is unit-tested.
 * Each entry starts with a header line "=== <epoch ms> <tag>"; the lines after it are the text.
 */
object ErrorLogFormat {
    private const val HEADER = "=== "
    /** Stack traces are cut to this many lines: enough to find the place, small enough to share. */
    const val MAX_TRACE_LINES = 40

    private val contentUri = Regex("""content://[^\s"'()<>,;]+""")
    private val filePath = Regex("""(?<![\w/])/(?:storage|sdcard|mnt|data/user|data/media)/[^\s"'()<>,;:]*""")

    /**
     * Folder names can be private (a user's name, a project), file names are what helps to
     * find a broken track: URIs and absolute paths shrink to ".../<file name>".
     */
    fun sanitize(text: String): String {
        val noUris = contentUri.replace(text) { ".../" + lastSegment(decode(it.value)) }
        return filePath.replace(noUris) { ".../" + lastSegment(it.value) }
    }

    private fun decode(value: String): String = runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)

    private fun lastSegment(value: String): String =
        value.trimEnd('/').substringAfterLast('/').substringAfterLast(':').ifEmpty { "..." }

    fun entry(timeMs: Long, tag: String, message: String, error: Throwable?): String {
        val body = buildString {
            append(message.trim())
            if (error != null) {
                append('\n')
                append(error.stackTraceToString().lineSequence().filter { it.isNotBlank() }.take(MAX_TRACE_LINES).joinToString("\n"))
            }
        }
        val safeTag = tag.replace(Regex("\\s+"), "_").ifEmpty { "Playly" }
        return HEADER + timeMs + " " + safeTag + "\n" + sanitize(body).lines().joinToString("\n") { line ->
            // A message line that looks like a header must not start a new entry.
            if (line.startsWith(HEADER)) " $line" else line
        } + "\n"
    }

    /** Newest first. Lines before the first header (a damaged file) are ignored. */
    fun parse(content: String): List<ErrorLogEntry> {
        val entries = ArrayList<ErrorLogEntry>()
        var header: Pair<Long, String>? = null
        val text = StringBuilder()
        fun flush() {
            header?.let { (time, tag) -> entries += ErrorLogEntry(time, tag, text.toString().trimEnd()) }
            text.clear()
        }
        for (line in content.lineSequence()) {
            val parsed = if (line.startsWith(HEADER)) parseHeader(line) else null
            if (parsed != null) {
                flush()
                header = parsed
            } else if (header != null) {
                if (text.isNotEmpty()) text.append('\n')
                text.append(line)
            }
        }
        flush()
        return entries.asReversed()
    }

    private fun parseHeader(line: String): Pair<Long, String>? {
        val parts = line.removePrefix(HEADER).split(' ', limit = 2)
        val time = parts.firstOrNull()?.toLongOrNull() ?: return null
        return time to parts.getOrElse(1) { "" }
    }

    /**
     * The text the user shares by hand: [header] (app and Android version), then entries newest
     * first, as many whole ones as fit in [maxChars] (a share intent cannot carry megabytes).
     */
    fun report(header: String, entries: List<ErrorLogEntry>, maxChars: Int, time: (Long) -> String): String {
        val out = StringBuilder(header.trimEnd()).append('\n')
        for (entry in entries) {
            val block = "\n" + time(entry.timeMs) + " · " + entry.tag + "\n" + entry.text + "\n"
            if (out.length + block.length > maxChars) break
            out.append(block)
        }
        return out.toString()
    }

    /** Keeps the newest whole entries that fit in [maxChars]. */
    fun trim(content: String, maxChars: Int): String {
        if (content.length <= maxChars) return content
        var start = content.length - maxChars
        val next = content.indexOf("\n$HEADER", start - 1)
        start = if (next < 0) content.length else next + 1
        return content.substring(start)
    }
}
