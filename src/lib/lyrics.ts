import { invoke } from '@tauri-apps/api/core'

export interface LyricLine {
  time: number
  text: string
}

export type Lyrics =
  | { synced: true; lines: LyricLine[] }
  | { synced: false; lines: string[] }

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
/* Пословные метки расширенного LRC: <00:12.34> */
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g
const META_TAG = /^\[[a-z]+:.*\]$/i

/**
 * Разбирает LRC ([мм:сс.xx]строка, несколько меток на строку, [offset:±мс]).
 * Текст без меток времени возвращается как обычный (несинхронизированный).
 */
export function parseLyrics(raw: string): Lyrics | null {
  const src = raw.replace(/^\uFEFF/, '').trim()
  if (!src) return null

  let offset = 0
  const synced: LyricLine[] = []
  const plain: string[] = []

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim()
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i)
    if (off) {
      offset = Number(off[1]) / 1000
      continue
    }

    const times: number[] = []
    TIME_TAG.lastIndex = 0
    let m: RegExpExecArray | null
    let rest = line
    while ((m = TIME_TAG.exec(line)) !== null) {
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac)
      rest = rest.replace(m[0], '')
    }
    const text = rest.replace(WORD_TAG, '').trim()

    if (times.length > 0) {
      for (const time of times) synced.push({ time, text })
    } else if (!META_TAG.test(line)) {
      plain.push(text)
    }
  }

  if (synced.length >= 2) {
    const lines = synced
      .map((l) => ({ time: Math.max(0, l.time - offset), text: l.text }))
      .sort((a, b) => a.time - b.time)
    return { synced: true, lines }
  }

  /* Убираем пустые строки по краям, внутри оставляем — это разбивка на куплеты */
  while (plain.length && !plain[0]) plain.shift()
  while (plain.length && !plain[plain.length - 1]) plain.pop()
  return plain.length ? { synced: false, lines: plain } : null
}

const cache = new Map<string, Promise<Lyrics | null>>()

export function loadLyrics(filePath: string): Promise<Lyrics | null> {
  const hit = cache.get(filePath)
  if (hit) return hit
  const job = invoke<string | null>('get_track_lyrics', { path: filePath })
    .then((raw) => (raw ? parseLyrics(raw) : null))
    .catch((e) => {
      console.warn('Не удалось прочитать текст песни:', e)
      return null
    })
  cache.set(filePath, job)
  if (cache.size > 64) cache.delete(cache.keys().next().value as string)
  return job
}

/** Индекс строки, которая звучит в момент time (-1 — до первой строки) */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
