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
import com.playly.player.data.favorites.FavoriteSort
import com.playly.player.data.library.TrackSort
import com.playly.player.data.library.browse.AlbumSort
import com.playly.player.data.library.browse.GroupSort
import com.playly.player.playback.audio.Equalizer
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
    /** Stage 7: order of the Albums, Artists, Genres and Folders tabs. */
    val albumSort: AlbumSort = AlbumSort.Title,
    val artistSort: GroupSort = GroupSort.Name,
    val genreSort: GroupSort = GroupSort.Name,
    val folderSort: GroupSort = GroupSort.Name,
    /** Stage 8.1: order of the Favourites page (newest first by default). */
    val favoriteSort: FavoriteSort = FavoriteSort.Added,
    /** Spec §9: starting a track from a list also opens the full-screen player. Off by default. */
    val openPlayerOnPlay: Boolean = false,
    /** Spec §10: a very faint colour from the cover behind the full-screen player. Off by default. */
    val playerArtworkTint: Boolean = false,
    /** Stage 8.3: the 15-band equaliser, its preset (or Equalizer.CUSTOM) and the user's own bands. */
    val eqEnabled: Boolean = false,
    val eqPreset: String = Equalizer.FLAT,
    val eqCustomGains: List<Float> = Equalizer.FLAT_GAINS,
    val monoAudio: Boolean = false,
    val normalizeVolume: Boolean = false,
    val skipSilence: Boolean = false,
) {
    /** The bands the equaliser plays with (and the sliders show), whether it is on or not. */
    val eqGains: List<Float>
        get() = if (eqPreset == Equalizer.CUSTOM) eqCustomGains else Equalizer.preset(eqPreset)?.gains ?: Equalizer.FLAT_GAINS
}

/** Small, typed settings store. DataStore writes are atomic, so a crash never leaves half a file. */
class SettingsRepository(private val store: DataStore<Preferences>) {
    private object Keys {
        val onboardingCompleted = booleanPreferencesKey("onboarding_completed")
        val reduceMotion = booleanPreferencesKey("reduce_motion")
        val lastScanAt = longPreferencesKey("last_scan_at")
        val trackSort = stringPreferencesKey("track_sort")
        val albumSort = stringPreferencesKey("album_sort")
        val artistSort = stringPreferencesKey("artist_sort")
        val genreSort = stringPreferencesKey("genre_sort")
        val folderSort = stringPreferencesKey("folder_sort")
        val favoriteSort = stringPreferencesKey("favorite_sort")
        val openPlayerOnPlay = booleanPreferencesKey("open_player_on_play")
        val playerArtworkTint = booleanPreferencesKey("player_artwork_tint")
        val eqEnabled = booleanPreferencesKey("eq_enabled")
        val eqPreset = stringPreferencesKey("eq_preset")
        val eqCustomGains = stringPreferencesKey("eq_custom_gains")
        val monoAudio = booleanPreferencesKey("mono_audio")
        val normalizeVolume = booleanPreferencesKey("normalize_volume")
        val skipSilence = booleanPreferencesKey("skip_silence")
    }

    val settings: Flow<AppSettings> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map { prefs ->
            AppSettings(
                onboardingCompleted = prefs[Keys.onboardingCompleted] ?: false,
                reduceMotion = prefs[Keys.reduceMotion] ?: false,
                lastScanAt = prefs[Keys.lastScanAt],
                trackSort = TrackSort.fromName(prefs[Keys.trackSort]),
                albumSort = AlbumSort.fromName(prefs[Keys.albumSort]),
                artistSort = GroupSort.fromName(prefs[Keys.artistSort]),
                genreSort = GroupSort.fromName(prefs[Keys.genreSort]),
                folderSort = GroupSort.fromName(prefs[Keys.folderSort]),
                favoriteSort = FavoriteSort.fromName(prefs[Keys.favoriteSort]),
                openPlayerOnPlay = prefs[Keys.openPlayerOnPlay] ?: false,
                playerArtworkTint = prefs[Keys.playerArtworkTint] ?: false,
                eqEnabled = prefs[Keys.eqEnabled] ?: false,
                eqPreset = eqPresetOf(prefs[Keys.eqPreset]),
                eqCustomGains = Equalizer.decode(prefs[Keys.eqCustomGains]),
                monoAudio = prefs[Keys.monoAudio] ?: false,
                normalizeVolume = prefs[Keys.normalizeVolume] ?: false,
                skipSilence = prefs[Keys.skipSilence] ?: false,
            )
        }

    suspend fun setOnboardingCompleted() = store.edit { it[Keys.onboardingCompleted] = true }

    suspend fun setReduceMotion(enabled: Boolean) = store.edit { it[Keys.reduceMotion] = enabled }

    suspend fun setTrackSort(sort: TrackSort) = store.edit { it[Keys.trackSort] = sort.name }

    suspend fun setAlbumSort(sort: AlbumSort) = store.edit { it[Keys.albumSort] = sort.name }

    suspend fun setArtistSort(sort: GroupSort) = store.edit { it[Keys.artistSort] = sort.name }

    suspend fun setGenreSort(sort: GroupSort) = store.edit { it[Keys.genreSort] = sort.name }

    suspend fun setFolderSort(sort: GroupSort) = store.edit { it[Keys.folderSort] = sort.name }

    suspend fun setFavoriteSort(sort: FavoriteSort) = store.edit { it[Keys.favoriteSort] = sort.name }

    suspend fun setOpenPlayerOnPlay(enabled: Boolean) = store.edit { it[Keys.openPlayerOnPlay] = enabled }

    suspend fun setPlayerArtworkTint(enabled: Boolean) = store.edit { it[Keys.playerArtworkTint] = enabled }

    suspend fun setLastScanAt(time: Long) = store.edit { it[Keys.lastScanAt] = time }

    suspend fun setEqEnabled(enabled: Boolean) = store.edit { it[Keys.eqEnabled] = enabled }

    /** A built-in preset, or Equalizer.CUSTOM to go back to the user's own bands. */
    suspend fun setEqPreset(id: String) = store.edit { it[Keys.eqPreset] = eqPresetOf(id) }

    /**
     * Moving a slider makes the shown bands the user's own: they start from what was playing
     * (a preset too), and the preset becomes Equalizer.CUSTOM.
     */
    suspend fun setEqBand(band: Int, gainDb: Float) = store.edit { prefs ->
        val shown = AppSettings(
            eqPreset = eqPresetOf(prefs[Keys.eqPreset]),
            eqCustomGains = Equalizer.decode(prefs[Keys.eqCustomGains]),
        ).eqGains.toMutableList()
        if (band in shown.indices) shown[band] = Equalizer.clampDb(gainDb)
        prefs[Keys.eqCustomGains] = Equalizer.encode(shown)
        prefs[Keys.eqPreset] = Equalizer.CUSTOM
    }

    suspend fun setMonoAudio(enabled: Boolean) = store.edit { it[Keys.monoAudio] = enabled }

    suspend fun setNormalizeVolume(enabled: Boolean) = store.edit { it[Keys.normalizeVolume] = enabled }

    suspend fun setSkipSilence(enabled: Boolean) = store.edit { it[Keys.skipSilence] = enabled }
}

/** Unknown or removed preset ids fall back to Flat. */
private fun eqPresetOf(raw: String?): String =
    if (raw != null && (raw == Equalizer.CUSTOM || Equalizer.preset(raw) != null)) raw else Equalizer.FLAT
