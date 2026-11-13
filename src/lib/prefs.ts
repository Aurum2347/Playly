import { useSyncExternalStore } from 'react'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import { normalizeChannelMode, type ChannelMode } from './audioEngine'

/*
 * Настройки 2.0.7, которые нужны сразу в нескольких местах (плеер, шапка, настройки, списки).
 * Хранятся в settings.json отдельными ключами; читает и пишет их только главное окно.
 */

export interface StreamerMode {
  /* Окна Playly не попадают в запись и демонстрацию экрана */
  window: boolean
  /* Звук Playly уходит на отдельное устройство, которое программа захвата не слушает */
  audio: boolean
  /* Устройство вывода на время режима стримера ('' — не выбрано) */
  device: string
  /* Что было включено до выключения общей кнопкой — его же она и вернёт */
  last: { window: boolean; audio: boolean }
}

export interface AppPrefs {
  /* Общий режим каналов; у трека может быть свой */
  channelMode: ChannelMode
  /* Пауза, если отключились наушники или выбранное устройство */
  pauseOnDeviceLoss: boolean
  /* Режим экономии ресурсов */
  powerSave: boolean
  /* Рекомендацию включить экономию уже показывали — больше не навязываем */
  powerSavePrompted: boolean
  streamer: StreamerMode
  /* Напоминать (раз за запуск), что после закрытия окна Playly работает в трее */
  trayNotice: boolean
}

export const DEFAULT_STREAMER: StreamerMode = { window: false, audio: false, device: '', last: { window: true, audio: false } }

export const DEFAULT_PREFS: AppPrefs = {
  channelMode: 'original',
  pauseOnDeviceLoss: true,
  powerSave: false,
  powerSavePrompted: false,
  streamer: DEFAULT_STREAMER,
  trayNotice: true,
}

/* Ключи в settings.json */
const KEYS = {
  channelMode: 'channelMode',
  pauseOnDeviceLoss: 'pauseOnDeviceLoss',
  powerSave: 'powerSave',
  powerSavePrompted: 'powerSavePrompted',
  streamer: 'streamerMode',
  trayNotice: 'trayNotice',
} as const satisfies Record<keyof AppPrefs, string>

function normalizeStreamer(raw: unknown): StreamerMode {
  const r = (raw ?? {}) as Partial<StreamerMode>
  const last = (r.last ?? {}) as Partial<StreamerMode['last']>
  return {
    window: r.window === true,
    audio: r.audio === true && typeof r.device === 'string' && r.device !== '',
    device: typeof r.device === 'string' ? r.device : '',
    last: { window: last.window !== false, audio: last.audio === true },
  }
}

export function normalizePrefs(raw: Record<string, unknown>): AppPrefs {
  return {
    channelMode: normalizeChannelMode(raw[KEYS.channelMode]),
    pauseOnDeviceLoss: raw[KEYS.pauseOnDeviceLoss] !== false,
    powerSave: raw[KEYS.powerSave] === true,
    powerSavePrompted: raw[KEYS.powerSavePrompted] === true,
    streamer: normalizeStreamer(raw[KEYS.streamer]),
    trayNotice: raw[KEYS.trayNotice] !== false,
  }
}

let prefs: AppPrefs = DEFAULT_PREFS
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export async function loadPrefs() {
  prefs = normalizePrefs(await readSettingsRaw().catch(() => ({})))
  loaded = true
  emit()
  return prefs
}

export const prefsLoaded = () => loaded
export const getPrefs = () => prefs

export function updatePrefs(patch: Partial<AppPrefs>) {
  prefs = { ...prefs, ...patch }
  emit()
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as Array<keyof AppPrefs>) out[KEYS[key]] = prefs[key]
  void writeSettingsRaw(out).catch(() => {})
}

/** Режим стримера включён, если включена хотя бы одна его часть */
export const streamerActive = (s: StreamerMode) => s.window || s.audio

export function updateStreamer(patch: Partial<StreamerMode>) {
  updatePrefs({ streamer: { ...prefs.streamer, ...patch } })
}

/** Общая кнопка в шапке: выключает всё (запомнив, что было) или возвращает прежний набор */
export function toggleStreamer() {
  const s = prefs.streamer
  if (streamerActive(s)) {
    updateStreamer({ window: false, audio: false, last: { window: s.window, audio: s.audio } })
  } else {
    const audio = s.last.audio && s.device !== ''
    const window = s.last.window || !audio
    updateStreamer({ window, audio })
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function usePrefs(): AppPrefs {
  return useSyncExternalStore(subscribe, () => prefs)
}

/** Сколько треков на странице списка: в режиме экономии — 25 */
export function usePageSize(normal = 100): number {
  const { powerSave } = usePrefs()
  return powerSave ? 25 : normal
}
