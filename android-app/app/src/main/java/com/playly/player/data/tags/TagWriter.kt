package com.playly.player.data.tags

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * Rewrites a copy of an audio file with new tags. Pure JVM (no Android), so it is unit-tested
 * on synthetic files and, in instrumented tests, checked against Android's own tag reader.
 * Like the desktop, the original is never edited in place: [input] is a copy, [output] the result.
 */
object TagWriter {
    fun rewrite(input: File, output: File, format: TagFormat, edit: TagEdit) {
        val clean = edit.cleaned()
        if (!clean.isValid) throw IllegalArgumentException("Title must not be blank")
        RandomAccessFile(input, "r").use { file ->
            BufferedOutputStream(FileOutputStream(output), 64 * 1024).use { out ->
                when (format) {
                    TagFormat.Mp3 -> Id3.rewrite(file, out, clean)
                    TagFormat.Flac -> Flac.rewrite(file, out, clean)
                    TagFormat.Ogg -> Ogg.rewrite(file, out, clean)
                    TagFormat.Mp4 -> Mp4.rewrite(file, out, clean)
                }
            }
        }
    }
}

/** Reads back the four edited fields (null where absent). Used to verify a rewrite before it replaces the file. */
object TagReader {
    fun read(file: File, format: TagFormat): Map<TagField, String?> = RandomAccessFile(file, "r").use { f ->
        when (format) {
            TagFormat.Mp3 -> {
                val frames = Id3.read(f)?.frames.orEmpty()
                Id3.FRAME_IDS.mapValues { (_, id) -> frames.firstOrNull { it.id == id }?.let { Id3.text(it.body) } }
            }
            TagFormat.Flac -> {
                val comments = Flac.comments(f, Flac.layout(f))
                Bytes.VorbisComments.VORBIS_KEYS.mapValues { (_, key) -> comments?.value(key) }
            }
            TagFormat.Ogg -> {
                val comments = Ogg.comments(Ogg.headers(f))
                Bytes.VorbisComments.VORBIS_KEYS.mapValues { (_, key) -> comments.value(key) }
            }
            TagFormat.Mp4 -> {
                val items = Mp4.items(f)
                Mp4.ITEMS.mapValues { (_, type) -> items[type] }
            }
        }
    }

    /** True when [file] holds exactly the values of [edit] (blank = absent). */
    fun matches(file: File, format: TagFormat, edit: TagEdit): Boolean {
        val expected = edit.cleaned().values()
        val actual = read(file, format)
        return TagField.entries.all { expected[it] == actual[it] }
    }
}
