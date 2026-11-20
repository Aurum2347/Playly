package com.playly.player.core

import java.io.ByteArrayOutputStream
import java.io.InputStream

/** InputStream.readNBytes needs API 33; this reads at most [limit] bytes on any version. */
fun InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8 * 1024)
    var total = 0
    while (total < limit) {
        val n = read(buffer, 0, minOf(buffer.size, limit - total))
        if (n < 0) break
        out.write(buffer, 0, n)
        total += n
    }
    return out.toByteArray()
}
