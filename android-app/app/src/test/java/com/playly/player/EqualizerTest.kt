package com.playly.player

import com.playly.player.playback.audio.Biquad
import com.playly.player.playback.audio.Equalizer
import com.playly.player.playback.audio.FilterType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stage 8.3: equaliser bands, presets and filter design (desktop src/lib/equalizer.ts). */
class EqualizerTest {
    @Test
    fun legacyPresetsSpreadOverFifteenBandsOnALogAxis() {
        val rock = Equalizer.preset("rock")!!.gains
        assertEquals(15, rock.size)
        assertEquals(5f, rock[0])   // 25 Hz: below the old 32 Hz band
        assertEquals(-1f, rock[8])  // 1 kHz: an old band exactly
        assertEquals(4.5f, rock[13]) // 10 kHz: 4 + (5 - 4) * log(10k/8k) / log(2) = 4.32 -> 4.5
        assertEquals(5f, rock[14])
        val bass = Equalizer.preset("bass")!!.gains
        assertEquals(6.5f, bass[1]) // 40 Hz: 7 - 0.32 -> 6.5
        assertEquals(9, Equalizer.PRESETS.size)
        assertTrue(Equalizer.preset(Equalizer.FLAT)!!.gains.all { it == 0f })
    }

    @Test
    fun normalizeClampsRoundsAndPads() {
        val gains = Equalizer.normalizeGains(listOf(13.2f, 1.26f, Float.NaN, -20f))
        assertEquals(listOf(12f, 1.5f, 0f, -12f), gains.take(4))
        assertEquals(15, gains.size)
        assertTrue(gains.drop(4).all { it == 0f })
        assertEquals(Equalizer.FLAT_GAINS, Equalizer.normalizeGains(null))
    }

    @Test
    fun customBandsSurviveStorage() {
        val gains = Equalizer.normalizeGains(listOf(1.5f, -2f, 0f, 12f, -12f, 0.5f))
        val raw = Equalizer.encode(gains)
        assertTrue(raw.startsWith("1.5,-2,0,12,-12,0.5,0"))
        assertEquals(gains, Equalizer.decode(raw))
        assertEquals(Equalizer.FLAT_GAINS, Equalizer.decode(null))
        assertEquals(Equalizer.FLAT_GAINS, Equalizer.decode("garbage"))
    }

    @Test
    fun bandLabelsAndPreGain() {
        assertEquals(listOf("25", "630", "1k", "1.6k", "6.3k", "16k"), listOf(25, 630, 1000, 1600, 6300, 16000).map(Equalizer::bandLabel))
        assertEquals(1.0, Equalizer.preGain(listOf(-6f, 0f)), 1e-9)
        // +8 dB boost: pre-gain -6 dB.
        assertEquals(-6.0, 20 * Math.log10(Equalizer.preGain(listOf(8f, -3f))), 1e-9)
    }

    @Test
    fun peakingBandHitsItsGainAtTheCentre() {
        for (rate in listOf(44_100.0, 48_000.0)) {
            for ((i, freq) in Equalizer.BANDS.withIndex()) {
                if (Biquad.typeOf(i) != FilterType.Peaking) continue
                for (gain in listOf(-12.0, -3.5, 6.0, 12.0)) {
                    val c = Biquad.design(FilterType.Peaking, freq.toDouble(), gain, Equalizer.Q, rate)
                    assertEquals("$freq Hz $gain dB", gain, c.responseDb(freq.toDouble(), rate), 0.01)
                    // Far away the band does nothing.
                    val far = if (freq >= 1000) freq / 30.0 else freq * 30.0
                    assertEquals(0.0, c.responseDb(far, rate), 0.5)
                }
            }
        }
    }

    @Test
    fun shelvesLiftTheirEndAndHalfAtTheCorner() {
        val rate = 48_000.0
        val low = Biquad.design(FilterType.LowShelf, 25.0, 9.0, Equalizer.Q, rate)
        assertEquals(9.0, low.responseDb(2.0, rate), 0.2)
        assertEquals(4.5, low.responseDb(25.0, rate), 0.05)
        assertEquals(0.0, low.responseDb(2_000.0, rate), 0.05)
        val high = Biquad.design(FilterType.HighShelf, 16_000.0, -6.0, Equalizer.Q, rate)
        assertEquals(-3.0, high.responseDb(16_000.0, rate), 0.05)
        assertEquals(0.0, high.responseDb(500.0, rate), 0.05)
        // Above Nyquist (a 22 kHz stream and a 16 kHz shelf) the band stays neutral.
        assertTrue(Biquad.design(FilterType.HighShelf, 16_000.0, 6.0, 1.0, 22_050.0) === Biquad.IDENTITY)
        assertTrue(Biquad.design(FilterType.Peaking, 1_000.0, 0.0, 1.0, rate) === Biquad.IDENTITY)
    }
}
