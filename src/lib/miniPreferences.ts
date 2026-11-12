import { useSyncExternalStore } from 'react'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'

/* ===== Внешний вид мини-плеера (хранится в settings.json → miniPreferences) ===== */

export interface MiniPreferences {
  enabled: boolean
  background: 'dark' | 'cover'
  /* Затемнение обложки на фоне: 0…0.9 */
  dim: number
}

export const DEFAULT_MINI_PREFERENCES: MiniPreferences = { enabled: true, background: 'cover', dim: 0.4 }
const SAVE_DELAY = 400

let preferences: MiniPreferences = DEFAULT_MINI_PREFERENCES
let saveTimer: number | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function normalizeMiniPreferences(raw: unknown): MiniPreferences {
  const r = (raw ?? {}) as Partial<MiniPreferences>
  const dim = typeof r.dim === 'number' && Number.isFinite(r.dim) ? Math.max(0, Math.min(0.9, r.dim)) : DEFAULT_MINI_PREFERENCES.dim
  return { enabled: r.enabled !== false, background: r.background === 'dark' ? 'dark' : 'cover', dim }
}

export async function loadMiniPreferences() {
  preferences = normalizeMiniPreferences((await readSettingsRaw()).miniPreferences)
  emit()
}

/** Применяется сразу, в файл пишется с задержкой: ползунок не пишет settings.json на каждый шаг */
export function updateMiniPreferences(patch: Partial<MiniPreferences>) {
  preferences = { ...preferences, ...patch }
  emit()
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void writeSettingsRaw({ miniPreferences: preferences }), SAVE_DELAY)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useMiniPreferences() {
  return useSyncExternalStore(subscribe, () => preferences)
}
