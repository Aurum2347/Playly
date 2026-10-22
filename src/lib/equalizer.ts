/* ===== 10-полосный эквалайзер: полосы, пресеты, кривая ===== */

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_MIN_DB = -12
export const EQ_MAX_DB = 12
export const FLAT_GAINS = EQ_BANDS.map(() => 0)

export interface EqPreset {
  id: string
  name: string
  gains: number[]
}

/* Встроенные пресеты: подпись берётся из переводов по id */
export const BUILTIN_EQ_PRESETS: Array<{ id: string; gains: number[] }> = [
  { id: 'flat', gains: FLAT_GAINS },
  { id: 'bass', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  { id: 'rock', gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  { id: 'pop', gains: [-1, 1, 3, 4, 3, 1, -1, -1, 0, 1] },
  { id: 'electronic', gains: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { id: 'vocal', gains: [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1] },
  { id: 'jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: 'classic', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
]

export const isBuiltinPreset = (id: string) => BUILTIN_EQ_PRESETS.some((p) => p.id === id)

export function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : String(freq)
}

const clampDb = (v: number) => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Math.round(v * 2) / 2))

export function normalizeGains(value: unknown): number[] {
  const arr = Array.isArray(value) ? value : []
  return EQ_BANDS.map((_, i) => {
    const v = arr[i]
    return typeof v === 'number' && isFinite(v) ? clampDb(v) : 0
  })
}

export function normalizeCustomPresets(value: unknown): EqPreset[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .filter((p) => typeof p.id === 'string' && p.id.startsWith('custom-'))
    .map((p) => ({
      id: p.id as string,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : 'Preset',
      gains: normalizeGains(p.gains),
    }))
}

export function presetGains(id: string, custom: EqPreset[]): number[] {
  return (
    custom.find((p) => p.id === id)?.gains ??
    BUILTIN_EQ_PRESETS.find((p) => p.id === id)?.gains ??
    FLAT_GAINS
  )
}

/**
 * Плавная кривая АЧХ для отрисовки: точки полос по логарифмической оси частот,
 * между ними — кривая Катмулла–Рома. Возвращает путь линии и путь залитой области.
 */
export function eqCurvePaths(gains: number[], width: number, height: number, pad = 0, yInset = 4) {
  const n = gains.length
  const xs = gains.map((_, i) => pad + (i / (n - 1)) * (width - pad * 2))
  const y = (db: number) => height / 2 - (db / EQ_MAX_DB) * (height / 2 - yInset)
  const pts = gains.map((g, i) => [xs[i], y(g)] as const)

  let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(n - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  const mid = height / 2
  const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${mid} L ${pts[0][0].toFixed(1)} ${mid} Z`
  return { line, area, points: pts }
}
