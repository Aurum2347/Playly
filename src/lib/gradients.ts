/*
 * Генератор градиентов. Цвета подбираются в OKLCH — пространстве, где «светлота» и «насыщенность»
 * совпадают с тем, как их видит глаз. Поэтому легко держать цвета в приятном коридоре:
 * не слишком тёмные, не блёклые и не кислотные, а второй цвет — в гармонии с первым.
 */

export interface Gradient {
  from: string
  to: string
  angle: number
}

/* ===== Генератор случайных чисел: детерминированный для «зерна», иначе обычный ===== */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ===== OKLCH → sRGB ===== */

function oklchToLinearRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005)

/** Цвет OKLCH в #rrggbb; если он не помещается в sRGB, насыщенность плавно уменьшается */
export function oklchToHex(L: number, C: number, h: number): string {
  let c = C
  let rgb = oklchToLinearRgb(L, c, h)
  while (!inGamut(rgb) && c > 0) {
    c = Math.max(0, c - 0.005)
    rgb = oklchToLinearRgb(L, c, h)
  }
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v))))) * 255))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

/* ===== Подбор цветов ===== */

/* Схемы сочетаний: насколько второй оттенок отстоит от первого */
const SCHEMES: Array<[number, number]> = [
  [25, 55], // соседние — мягко и спокойно
  [25, 55],
  [100, 140], // триада — ярче, но гармонично
  [160, 200], // почти противоположные — контрастно
]

/**
 * Светлота с поправкой на оттенок: жёлтые и зелёные при той же L выглядят «грязнее»,
 * синие и фиолетовые — темнее, чем есть. Компенсируем, чтобы все цвета смотрелись одинаково бодро.
 */
function lightnessFor(h: number, base: number): number {
  const hue = ((h % 360) + 360) % 360
  if (hue > 70 && hue < 135) return base + 0.1
  if (hue > 240 && hue < 300) return base - 0.03
  return base
}

function makeGradient(rand: () => number): Gradient {
  const h1 = rand() * 360
  const [lo, hi] = SCHEMES[Math.floor(rand() * SCHEMES.length)]
  const h2 = h1 + (rand() < 0.5 ? -1 : 1) * (lo + rand() * (hi - lo))
  /* Коридор: L 0.56–0.70 и C 0.09–0.15 — не тёмные, не серые и не кислотные */
  const L1 = lightnessFor(h1, 0.56 + rand() * 0.14)
  /* Второй цвет немного светлее или темнее — у градиента появляется глубина */
  const L2 = Math.min(0.82, Math.max(0.48, lightnessFor(h2, L1 + (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.07))))
  const C1 = 0.09 + rand() * 0.06
  const C2 = Math.min(0.16, Math.max(0.08, C1 + (rand() - 0.5) * 0.04))
  const angles = [100, 120, 135, 150, 160, 200, 225]
  return {
    from: oklchToHex(L1, C1, h1),
    to: oklchToHex(L2, C2, h2),
    angle: angles[Math.floor(rand() * angles.length)],
  }
}

/** Случайный приятный градиент */
export function randomGradient(): Gradient {
  return makeGradient(Math.random)
}

/** Всегда один и тот же градиент для одной строки (например, ника) — для аватарки и баннера по умолчанию */
export function gradientFromSeed(seed: string): Gradient {
  return makeGradient(mulberry32(hashString(seed || 'Playly')))
}
