package com.playly.player.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.playly.player.data.library.TrackSort
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

data class AppSettings(
    val onboardingCompleted: Boolean = false,
    /** User override; the system "remove animations" setting is honoured independently. */
    val reduceMotion: Boolean = false,
    /** Completion time of the last full library scan, or null if none ever finished. */
    val lastScanAt: Long? = null,
    /** Order of the "All tracks" lists (Home and Library). */
    val trackSort: TrackSort = TrackSort.Title,
    /** Spec §9: starting a track from a list also opens the full-screen player. Off by default. */
    val openPlayerOnPlay: Boolean = false,
    /** Spec §10: a very faint colour from the cover behind the full-screen player. Off by default. */
    val playerArtworkTint: Boolean = false,
)

/** Small, typed settings store. DataStore writes are atomic, so a crash never leaves half a file. */
class SettingsRepository(private val store: DataStore<Preferences>) {
    private object Keys {
        val onboardingCompleted = booleanPreferencesKey("onboarding_completed")
        val reduceMotion = booleanPreferencesKey("reduce_motion")
        val lastScanAt = longPreferencesKey("last_scan_at")
        val trackSort = stringPreferencesKey("track_sort")
        val openPlayerOnPlay = booleanPreferencesKey("open_player_on_play")
        val playerArtworkTint = booleanPreferencesKey("player_artwork_tint")
    }

    val settings: Flow<AppSettings> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map { prefs ->
            AppSettings(
                onboardingCompleted = prefs[Keys.onboardingCompleted] ?: false,
                reduceMotion = prefs[Keys.reduceMotion] ?: false,
                lastScanAt = prefs[Keys.lastScanAt],
                trackSort = TrackSort.fromName(prefs[Keys.trackSort]),
                openPlayerOnPlay = prefs[Keys.openPlayerOnPlay] ?: false,
                playerArtworkTint = prefs[Keys.playerArtworkTint] ?: false,
            )
        }

    suspend fun setOnboardingCompleted() = store.edit { it[Keys.onboardingCompleted] = true }

    suspend fun setReduceMotion(enabled: Boolean) = store.edit { it[Keys.reduceMotion] = enabled }

    suspend fun setTrackSort(sort: TrackSort) = store.edit { it[Keys.trackSort] = sort.name }

    suspend fun setOpenPlayerOnPlay(enabled: Boolean) = store.edit { it[Keys.openPlayerOnPlay] = enabled }

    suspend fun setPlayerArtworkTint(enabled: Boolean) = store.edit { it[Keys.playerArtworkTint] = enabled }

    suspend fun setLastScanAt(time: Long) = store.edit { it[Keys.lastScanAt] = time }
}
