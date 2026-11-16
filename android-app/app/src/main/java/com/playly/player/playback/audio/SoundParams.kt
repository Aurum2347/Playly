package com.playly.player.playback.audio

/**
 * What the sound chain applies. Immutable: the service swaps a whole new value from the main
 * thread and the audio thread picks it up at the next buffer.
 *
 * @param eqGains 15 band gains in dB, or null when the equaliser is off
 */
data class SoundParams(
    val eqGains: List<Float>? = null,
    val mono: Boolean = false,
    val normalize: Boolean = false,
) {
    companion object {
        val OFF = SoundParams()
    }
}
