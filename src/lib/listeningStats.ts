import { useEffect, useRef, useSyncExternalStore } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

/* Момент запуска приложения — от него считается время текущей сессии */
export const SESSION_START = Date.now()

/* Сколько секунд трека нужно дослушать, чтобы засчитать прослушивание (или половину, если трек короче минуты) */
const PLAY_THRESHOLD = 30
/* Дни старше этого срока удаляются: для переключателя «за год» их хватает с запасом */
const KEEP_DAYS = 400
const SAVE_DELAY = 10_000
/* Раньше этой даты Playly не существовал — такие отметки времени считаем мусором */
const MIN_VALID_TS = Date.UTC(2024, 0, 1)

export interface TrackDayStat {
  /* Прослушано секунд */
  s: number
  /* Засчитанных прослушиваний */
  p: number
}

export interface ListeningStats {
  version: 1
  /* Дата первого входа */
  firstSeen: number
  /* true — дата восстановлена по старым данным Playly, false — профиль создан с нуля */
  restored: boolean
  totalSeconds: number
  totalPlays: number
  /* "YYYY-MM-DD" → id трека → статистика за день */
  days: Record<string, Record<string, TrackDayStat>>
}

export type StatsPeriod = 'week' | 'month' | 'year'

export const STATS_PERIODS: StatsPeriod[] = ['week', 'month', 'year']

const PERIOD_DAYS: Record<StatsPeriod, number> = { week: 7, month: 30, year: 365 }

/* ===== Хранилище в памяти ===== */
let data: ListeningStats | null = null
let revision = 0
let initPromise: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

/* Текущий непрерывный «заход» на трек: по нему решается, засчитано ли прослушивание */
let run: { trackId: number; listened: number; counted: boolean } | null = null

function emit() {
  revision += 1
  listeners.forEach((l) => l())
}

export function dayKey(ts = Date.now()): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function daysAgoKey(n: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return dayKey(d.getTime())
}

async function getPlaylyDir(): Promise<string> {
  return join(await appDataDir(), 'playly')
}

async function getStatsPath(): Promise<string> {
  const dir = await getPlaylyDir()
  await mkdir(dir, { recursive: true }).catch(() => {})
  return join(dir, 'stats.json')
}

/* ===== Дата первого входа ===== */

async function createdAt(path: string): Promise<number | null> {
  try {
    if (!(await exists(path))) return null
    const ts = await invoke<number | null>('get_path_created', { path })
    return typeof ts === 'number' && ts >= MIN_VALID_TS ? ts : null
  } catch {
    return null
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    if (!(await exists(path))) return null
    return JSON.parse(await readTextFile(path))
  } catch {
    return null
  }
}

/**
 * Ищем следы прошлых запусков: сначала «аккаунт» (user.json появляется после первого входа),
 * затем любые данные библиотеки. Берём самую раннюю дату. Ничего не нашлось — профиль новый (null).
 */
async function detectFirstSeen(): Promise<number | null> {
  const dir = await getPlaylyDir()
  if (!(await exists(dir))) return null

  const userFile = await join(dir, 'user.json')
  const tracksFile = await join(dir, 'tracks.json')
  const historyFile = await join(dir, 'history.json')
  const playlistsFile = await join(dir, 'playlists.json')

  const tracks = await readJson(tracksFile)
  const history = await readJson(historyFile)
  const hasAccount = await exists(userFile)
  const hasLibrary =
    (Array.isArray(tracks) && tracks.length > 0) ||
    (!!history && typeof history === 'object' && Object.keys(history).length > 0) ||
    (await exists(playlistsFile))
  if (!hasAccount && !hasLibrary) return null

  const found: number[] = []
  const push = (v: unknown) => {
    if (typeof v === 'number' && isFinite(v) && v >= MIN_VALID_TS && v <= Date.now()) found.push(v)
  }

  for (const name of ['user.json', 'profile', 'tracks.json', 'playlists.json', 'history.json', 'covers']) {
    push(await createdAt(await join(dir, name)))
  }
  if (Array.isArray(tracks)) tracks.forEach((t) => push((t as { addedAt?: unknown })?.addedAt))
  if (history && typeof history === 'object') Object.values(history).forEach(push)

  return found.length > 0 ? Math.min(...found) : Date.now()
}

/* ===== Загрузка и сохранение ===== */

function normalize(raw: unknown): ListeningStats | null {
  const r = raw as Partial<ListeningStats> | null
  if (!r || typeof r !== 'object' || typeof r.firstSeen !== 'number') return null
  const days: ListeningStats['days'] = {}
  const oldest = daysAgoKey(KEEP_DAYS)
  if (r.days && typeof r.days === 'object') {
    for (const [key, tracks] of Object.entries(r.days)) {
      if (key < oldest || !tracks || typeof tracks !== 'object') continue
      const day: Record<string, TrackDayStat> = {}
      for (const [id, v] of Object.entries(tracks)) {
        const s = Number((v as TrackDayStat)?.s) || 0
        const p = Number((v as TrackDayStat)?.p) || 0
        if (s > 0 || p > 0) day[id] = { s, p }
      }
      days[key] = day
    }
  }
  return {
    version: 1,
    firstSeen: r.firstSeen,
    restored: r.restored === true,
    totalSeconds: Math.max(0, Number(r.totalSeconds) || 0),
    totalPlays: Math.max(0, Number(r.totalPlays) || 0),
    days,
  }
}

/** Загружает stats.json или создаёт его. Вызывать до онбординга, иначе новый профиль примет себя за старый */
export function initListeningStats(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const path = await getStatsPath()
        const loaded = normalize(await readJson(path))
        /* Файл есть, но испорчен: сохраняем копию, прежде чем начать статистику заново */
        if (!loaded && (await exists(path))) {
          const raw = await readTextFile(path).catch(() => '')
          if (raw.trim()) await writeTextFile(`${path}.${Date.now()}.bak`, raw).catch(() => {})
        }
        if (loaded) {
          data = loaded
        } else {
          const firstSeen = await detectFirstSeen()
          data = {
            version: 1,
            firstSeen: firstSeen ?? Date.now(),
            restored: firstSeen !== null,
            totalSeconds: 0,
            totalPlays: 0,
            days: {},
          }
          await flushListeningStats()
        }
      } catch (e) {
        console.error('Не удалось загрузить статистику:', e)
        data = { version: 1, firstSeen: Date.now(), restored: false, totalSeconds: 0, totalPlays: 0, days: {} }
      }
      emit()
    })()
  }
  return initPromise
}

export async function flushListeningStats(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!data) return
  try {
    /* Дробные секунды копятся в памяти, на диск хватает десятых */
    const json = JSON.stringify(data, (_k, v) =>
      typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10) / 10 : v
    )
    await writeTextFile(await getStatsPath(), json)
  } catch (e) {
    console.error('Не удалось сохранить статистику:', e)
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushListeningStats()
  }, SAVE_DELAY)
}

/** Добавить прослушанное время. duration — длина трека, от неё зависит порог «засчитанного» прослушивания */
function addListening(trackId: number, seconds: number, duration: number) {
  if (!data || seconds <= 0) return
  if (!run || run.trackId !== trackId) run = { trackId, listened: 0, counted: false }
  run.listened += seconds

  const key = dayKey()
  const day = (data.days[key] ??= {})
  const rec = (day[trackId] ??= { s: 0, p: 0 })
  rec.s += seconds
  data.totalSeconds += seconds

  const threshold = duration > 0 ? Math.min(PLAY_THRESHOLD, duration * 0.5) : PLAY_THRESHOLD
  if (!run.counted && run.listened >= threshold) {
    run.counted = true
    rec.p += 1
    data.totalPlays += 1
  }
  scheduleSave()
  emit()
}

/* ===== Подписка для интерфейса ===== */

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Актуальная статистика (null, пока не загружена) и номер ревизии.
 * Объект статистики изменяется на месте, поэтому в зависимости useMemo нужно класть ревизию, а не его.
 */
export function useListeningStats(): readonly [ListeningStats | null, number] {
  const rev = useSyncExternalStore(subscribe, () => revision)
  return [data, rev] as const
}

/**
 * Считает прослушанное время текущего трека, пока идёт воспроизведение.
 * Перемотка в начало того же трека (повтор) начинает новый «заход» и может засчитать ещё одно прослушивание.
 */
export function useListeningTracker(
  isPlaying: boolean,
  trackId: number | null,
  duration: number,
  getTime: () => number
) {
  const durationRef = useRef(duration)
  const getTimeRef = useRef(getTime)
  useEffect(() => {
    durationRef.current = duration
    getTimeRef.current = getTime
  })

  useEffect(() => {
    if (!isPlaying || trackId === null) return
    let last = performance.now()
    let lastPos = getTimeRef.current()
    const timer = setInterval(() => {
      const now = performance.now()
      /* Сон компьютера или зависание вкладки не должны превращаться в часы прослушивания */
      const delta = Math.min(5, (now - last) / 1000)
      last = now
      const pos = getTimeRef.current()
      if (run?.trackId === trackId && pos < 5 && pos + 2 < lastPos) run = null
      lastPos = pos
      addListening(trackId, delta, durationRef.current)
    }, 1000)
    return () => {
      clearInterval(timer)
      void flushListeningStats()
    }
  }, [isPlaying, trackId])

  useEffect(() => {
    const onHide = () => void flushListeningStats()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])
}

/* ===== Выборки ===== */

export interface TrackTotal {
  trackId: number
  seconds: number
  plays: number
}

/** Суммы по трекам за последние 7 / 30 / 365 дней, включая сегодня */
export function periodTotals(stats: ListeningStats, period: StatsPeriod): TrackTotal[] {
  const from = daysAgoKey(PERIOD_DAYS[period] - 1)
  const sums = new Map<number, TrackTotal>()
  for (const [key, day] of Object.entries(stats.days)) {
    if (key < from) continue
    for (const [id, v] of Object.entries(day)) {
      const trackId = Number(id)
      const cur = sums.get(trackId) ?? { trackId, seconds: 0, plays: 0 }
      cur.seconds += v.s
      cur.plays += v.p
      sums.set(trackId, cur)
    }
  }
  return [...sums.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
}

export function secondsOnDay(stats: ListeningStats, key = dayKey()): number {
  const day = stats.days[key]
  return day ? Object.values(day).reduce((acc, v) => acc + v.s, 0) : 0
}

/** Сколько дней подряд звучала музыка (сегодняшний день ещё может быть впереди — тогда счёт идёт со вчера) */
export function listeningStreak(stats: ListeningStats): number {
  const active = (n: number) => secondsOnDay(stats, daysAgoKey(n)) >= 60
  let n = active(0) ? 0 : 1
  let streak = 0
  while (n <= KEEP_DAYS && active(n)) {
    streak += 1
    n += 1
  }
  return streak
}

/** Часы:минуты:секунды, например 01:07:42 */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`
}

/** Полных дней с первого входа */
export function daysSince(ts: number): number {
  const start = new Date(ts)
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000))
}
