package com.playly.player.core

import java.text.Normalizer
import java.util.Locale

/**
 * Text normalisation for local search. SQLite's LIKE/NOCASE only fold ASCII, so the
 * library stores a pre-normalised key and queries are normalised the same way.
 */
object SearchText {
    private val combiningMarks = Regex("""\p{Mn}+""")
    private val spaces = Regex("""\s+""")

    /** Lower-case, strip accents (é→e, й→и is avoided below), fold ё→е, collapse spaces. */
    fun normalize(text: String): String {
        if (text.isBlank()) return ""
        val lower = text.lowercase(Locale.ROOT)
            .replace('ё', 'е')
            // Keep "й": decomposing it would turn it into "и" and merge distinct words.
            .replace('й', '\u0000')
        val stripped = combiningMarks.replace(Normalizer.normalize(lower, Normalizer.Form.NFKD), "")
        return Normalizer.normalize(stripped, Normalizer.Form.NFC)
            .replace('\u0000', 'й')
            .replace(spaces, " ")
            .trim()
    }

    /** Key stored with a track: every searchable field joined by a space. */
    fun key(vararg fields: String?): String =
        normalize(fields.filterNotNull().filter { it.isNotBlank() }.joinToString(" "))

    /** Escapes LIKE wildcards; pair with `ESCAPE '\'` in the query. */
    fun escapeLike(text: String): String =
        text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
}
