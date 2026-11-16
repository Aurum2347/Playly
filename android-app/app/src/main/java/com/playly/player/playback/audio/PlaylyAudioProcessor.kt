package com.playly.player.playback.audio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * Media3 side of the sound chain: 16-bit or float PCM in, the same format out. Always active,
 * so turning an effect on or off never reconfigures the audio sink; with everything off the
 * bytes are copied untouched. [params] may be set from any thread.
 */
@OptIn(UnstableApi::class)
class PlaylyAudioProcessor : BaseAudioProcessor() {
    @Volatile
    var params: SoundParams = SoundParams.OFF

    private val chain = SoundChain()
    private var work = FloatArray(0)
    private var configured: AudioProcessor.AudioFormat? = null

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val encoding = inputAudioFormat.encoding
        if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        val format = inputAudioFormat
        if (format != configured) {
            configured = format
            chain.configure(format.sampleRate, format.channelCount, params)
        } else {
            chain.flush(params)
        }
    }

    override fun onReset() {
        configured = null
        work = FloatArray(0)
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val format = inputAudioFormat
        val out = replaceOutputBuffer(size)
        if (chain.prepare(params)) {
            out.put(inputBuffer)
            out.flip()
            return
        }
        val samples = size / format.bytesPerFrame * format.channelCount
        if (work.size < samples) work = FloatArray(samples)
        val buf = work
        val pcm16 = format.encoding == C.ENCODING_PCM_16BIT
        for (i in 0 until samples) {
            buf[i] = if (pcm16) inputBuffer.getShort() / 32768f else inputBuffer.getFloat()
        }
        chain.process(buf, samples / format.channelCount)
        for (i in 0 until samples) {
            if (pcm16) {
                out.putShort((buf[i] * 32768f).roundToInt().coerceIn(-32768, 32767).toShort())
            } else {
                out.putFloat(buf[i])
            }
        }
        // A partial frame (never sent by Media3) is dropped rather than left to stall the input.
        inputBuffer.position(inputBuffer.limit())
        out.flip()
    }
}
