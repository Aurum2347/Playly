import { useSyncExternalStore } from 'react'
import { reportError } from './feedback'
import { readLibraryJson, writeLibraryJson } from './libraryFiles'

/* ===== История прослушивания: каждое начало воспроизведения отдельной записью =====
 * В отличие от history.json (трек → последний раз), здесь сохраняются и повторы.
 * Новые записи в начале списка, храним последние MAX_EVENTS.
 */

export interface PlayEvent {
  trackId: number
  playedAt: number
}

const MAX_EVENTS = 10_000
const SAVE_DELAY = 1500
const DAY = 86_400_000

let events: PlayEvent[] = []
let saveTimer: number | undefined
let writing: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

function isEvent(x: unknown): x is PlayEvent {
  const e = x as PlayEvent | null
  return !!e && Number.isSafeInteger(e.trackId) && Number.isFinite(e.playedAt) && e.playedAt >= 0 && e.playedAt <= Date.now() + DAY
}

function flush(): Promise<void> {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  const snapshot = events
  writing = writing
    .catch(() => {})
    .then(() => writeLibraryJson('listening-history.json', snapshot))
    .catch((e) => reportError('historySave', e))
  return writing
}

/* Пишем с задержкой: при быстрых «Далее» подряд файл сохраняется один раз */
function scheduleSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flush(), SAVE_DELAY)
}

/** Загружает историю; при первом запуске переносит записи из старого history.json */
export async function initPlayEvents(legacy: Record<number, number>) {
  let raw: unknown = null
  try {
    raw = await readLibraryJson('listening-history.json')
  } catch (e) {
    console.error('История прослушивания не прочиталась:', e)
  }
  events = Array.isArray(raw)
    ? raw.filter(isEvent).slice(0, MAX_EVENTS)
    : Object.entries(legacy)
        .map(([id, time]) => ({ trackId: Number(id), playedAt: time }))
        .filter(isEvent)
        .sort((a, b) => b.playedAt - a.playedAt)
  emit()
}

export function recordPlayEvent(trackId: number) {
  events = [{ trackId, playedAt: Date.now() }, ...events].slice(0, MAX_EVENTS)
  emit()
  scheduleSave()
}

/** Убирает из истории удалённые треки */
export function forgetPlayEvents(ids: Set<number>) {
  const next = events.filter((e) => !ids.has(e.trackId))
  if (next.length === events.length) return
  events = next
  emit()
  scheduleSave()
}

export async function clearPlayEvents() {
  events = []
  emit()
  await flush()
}

/* Закрытие окна: несохранённое дописываем сразу, не дожидаясь таймера */
window.addEventListener('beforeunload', () => {
  if (saveTimer !== undefined) void flush()
})

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function usePlayEvents() {
  return useSyncExternalStore(subscribe, () => events)
}
