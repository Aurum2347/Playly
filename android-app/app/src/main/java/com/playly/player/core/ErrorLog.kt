package com.playly.player.core

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

/**
 * Stage 9.3: a small local error log (spec §14 "About"). Crashes, playback errors and failed
 * operations are kept in the app's private folder, without full paths; nothing is sent
 * anywhere. The user can read, share by hand or clear it in Settings → About.
 */
object ErrorLog {
    private const val TAG = "PlaylyErrorLog"
    /** The file stays under this size; the oldest entries go first. */
    const val MAX_CHARS = 200_000

    private val lock = Any()
    @Volatile private var file: File? = null
    private val _version = MutableStateFlow(0)
    /** Changes whenever an entry is added or the log is cleared. */
    val version: StateFlow<Int> = _version.asStateFlow()

    fun init(context: Context) {
        file = File(context.filesDir, "logs/errors.log")
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            record("Crash", "App crashed (thread ${thread.name})", error)
            previous?.uncaughtException(thread, error)
        }
    }

    /** Logcat plus the local log: use instead of Log.e. */
    fun e(tag: String, message: String, error: Throwable? = null) {
        Log.e(tag, message, error)
        record(tag, message, error)
    }

    /** Never throws: a broken log must not break the app. */
    fun record(tag: String, message: String, error: Throwable? = null) {
        val target = file ?: return
        try {
            val text = ErrorLogFormat.entry(System.currentTimeMillis(), tag, message, error)
            synchronized(lock) {
                target.parentFile?.mkdirs()
                target.appendText(text)
                if (target.length() > MAX_CHARS * 2L) target.writeText(ErrorLogFormat.trim(target.readText(), MAX_CHARS))
            }
            _version.value++
        } catch (e: Exception) {
            Log.w(TAG, "Cannot write the error log", e)
        }
    }

    fun entries(): List<ErrorLogEntry> = try {
        synchronized(lock) { file?.takeIf { it.isFile }?.readText()?.let(ErrorLogFormat::parse).orEmpty() }
    } catch (e: Exception) {
        Log.w(TAG, "Cannot read the error log", e)
        emptyList()
    }

    fun clear() {
        synchronized(lock) { file?.delete() }
        _version.value++
    }
}
