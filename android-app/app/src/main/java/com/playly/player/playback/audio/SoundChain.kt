package com.playly.player.playback.audio

/**
 * Mono, equaliser, normaliser, soft limiter on interleaved float samples (-1..1). Pure Kotlin,
 * so tests run it on the JVM; PlaylyAudioProcessor feeds it from Media3. Single-threaded.
 */
class SoundChain {
    private val eq = EqualizerDsp()
    private val compressor = Compressor()
    private var channels = 2
    private var applied: SoundParams? = null

    /** New stream format: clears all filter memory and starts at the current settings. */
    fun configure(sampleRate: Int, channels: Int, params: SoundParams) {
        this.channels = channels
        apply(params)
        eq.configure(sampleRate, channels)
        compressor.configure(sampleRate, channels)
    }

    /** Seek or new item: no tail of the old position, no fades. */
    fun flush(params: SoundParams) {
        apply(params)
        eq.snap()
        compressor.snap()
    }

    /**
     * Takes [params] for the next buffer. True when nothing would change the sound, so the
     * caller may copy the bytes as they are.
     */
    fun prepare(params: SoundParams): Boolean {
        apply(params)
        return !(params.mono && channels > 1) && eq.isNeutral && compressor.isIdle
    }

    /** Processes [frames] interleaved frames of [buf] in place. Call [prepare] first. */
    fun process(buf: FloatArray, frames: Int) {
        val ch = channels
        if (applied?.mono == true && ch > 1) mixToMono(buf, frames, ch)
        var shaped = false
        if (!eq.isNeutral) {
            eq.process(buf, frames)
            shaped = true
        }
        if (!compressor.isIdle) {
            compressor.process(buf, frames)
            shaped = true
        }
        if (shaped) SoftLimiter.process(buf, frames * ch)
    }

    private fun apply(params: SoundParams) {
        if (params === applied) return
        if (params.eqGains != applied?.eqGains || applied == null) eq.setGains(params.eqGains)
        compressor.setEnabled(params.normalize)
        applied = params
    }

    private fun mixToMono(buf: FloatArray, frames: Int, ch: Int) {
        var k = 0
        for (frame in 0 until frames) {
            var sum = 0f
            for (c in 0 until ch) sum += buf[k + c]
            val mid = sum / ch
            for (c in 0 until ch) buf[k + c] = mid
            k += ch
        }
    }
}
