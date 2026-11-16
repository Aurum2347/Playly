package com.playly.player

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import com.playly.player.data.settings.AppSettings
import com.playly.player.data.settings.SettingsRepository
import com.playly.player.playback.soundParamsOf
import com.playly.player.playback.audio.Equalizer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.3: sound settings in the DataStore and what the player gets from them. */
class SoundSettingsTest {
    /** In memory: a file DataStore cannot rename its temp file on Windows test machines. */
    private class MemoryStore : DataStore<Preferences> {
        private val state = MutableStateFlow(emptyPreferences())
        override val data: Flow<Preferences> = state

        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
            transform(state.value).also { state.value = it }
    }

    private fun <T> withRepo(block: suspend (SettingsRepository) -> T): T = runBlocking { block(SettingsRepository(MemoryStore())) }

    @Test
    fun defaultsAreAllOff() = withRepo { repo ->
        val s = repo.settings.first()
        assertFalse(s.eqEnabled || s.monoAudio || s.normalizeVolume || s.skipSilence)
        assertEquals(Equalizer.FLAT, s.eqPreset)
        assertNull(soundParamsOf(s).eqGains)
    }

    @Test
    fun movingABandStartsFromThePresetAndMakesItCustom() = withRepo { repo ->
        repo.setEqPreset("rock")
        repo.setEqEnabled(true)
        repo.setEqBand(0, 3.3f)
        val s = repo.settings.first()
        assertEquals(Equalizer.CUSTOM, s.eqPreset)
        val rock = Equalizer.preset("rock")!!.gains
        assertEquals(listOf(3.5f) + rock.drop(1), s.eqGains)
        assertEquals(s.eqGains, soundParamsOf(s).eqGains)
        // A built-in preset again, then back to the user's own bands.
        repo.setEqPreset("bass")
        assertEquals(Equalizer.preset("bass")!!.gains, repo.settings.first().eqGains)
        repo.setEqPreset(Equalizer.CUSTOM)
        assertEquals(listOf(3.5f) + rock.drop(1), repo.settings.first().eqGains)
    }

    @Test
    fun unknownPresetFallsBackToFlatAndSwitchesPersist() = withRepo { repo ->
        repo.setEqPreset("removed-preset")
        repo.setMonoAudio(true)
        repo.setNormalizeVolume(true)
        repo.setSkipSilence(true)
        val s = repo.settings.first()
        assertEquals(Equalizer.FLAT, s.eqPreset)
        assertTrue(s.monoAudio && s.normalizeVolume && s.skipSilence)
        val params = soundParamsOf(s)
        assertTrue(params.mono && params.normalize)
        assertNull(params.eqGains)
        assertEquals(Equalizer.FLAT_GAINS, AppSettings(eqPreset = Equalizer.CUSTOM).eqGains)
    }
}
