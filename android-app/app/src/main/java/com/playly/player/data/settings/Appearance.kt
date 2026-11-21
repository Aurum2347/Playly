package com.playly.player.data.settings

/**
 * Stage 9.3: the accent colour. Neutral (the desktop's monochrome) by default; the others are
 * light enough that dark text on them stays readable, so the theme keeps one "on accent" colour.
 */
enum class AccentChoice(val argb: Long) {
    Neutral(0xFFF0F0F0),
    Blue(0xFF8AB8FF),
    Green(0xFF84DDB0),
    Violet(0xFFBBA6FF),
    Orange(0xFFFFB57A),
    Pink(0xFFFF9EC4);

    companion object {
        fun fromName(name: String?): AccentChoice = entries.firstOrNull { it.name == name } ?: Neutral
    }
}

/** Stage 9.3: height of list rows. */
enum class ListDensity {
    Comfortable,
    Compact;

    companion object {
        fun fromName(name: String?): ListDensity = entries.firstOrNull { it.name == name } ?: Comfortable
    }
}
