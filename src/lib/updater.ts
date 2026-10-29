import { useSyncExternalStore } from 'react'
import { Channel, invoke } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import { APP_VERSION } from './version'

/*
 * Автообновление. Сначала обновление целиком скачивается и проверяется подписью,
 * и только потом — по согласию пользователя — устанавливается поверх приложения.
 * Отказ («Позже») ничего не ломает: скачанное ждёт до перезапуска или до кнопки в «О программе».
 *
 * Rust-сторона отдаёт любой опубликованный релиз (default_version_comparator в main.rs),
 * а решает уже этот модуль:
 *   • релиз новее      — обычное обновление;
 *   • та же версия     — «у вас последняя версия»;
 *   • релиз старше или
 *     просто другой    — «неизвестная версия» (сборка не из релизов): обновляться не предлагаем,
 *                        только по кнопке можно поставить текущий релиз.
 * Если в релизе нет latest.json (выложен только .exe), версия берётся из GitHub API,
 * а установить её можно только вручную со страницы релиза.
 *
 * Портативный Playly.exe (рядом нет деинсталлятора) берёт из latest.json свою запись
 * PORTABLE_TARGET и обновляется подменой .exe (см. portable_* в main.rs), а не установщиком.
 */

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  /* Новее, но без файлов автообновления — только скачать со страницы релиза */
  | 'manual'
  /* Эта сборка не совпадает ни с одним релизом */
  | 'unknown'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdaterState {
  status: UpdateStatus
  /* Версия последнего релиза на GitHub */
  version: string | null
  notes: string | null
  date: string | null
  /* Страница релиза — для ручной установки */
  releaseUrl: string | null
  /* Релиз можно поставить прямо из приложения (есть подписанный установщик) */
  installable: boolean
  downloaded: number
  total: number
  error: string | null
  checkedAt: number | null
  /* Скачивать обновления сами, без вопросов */
  auto: boolean
  /* Пользователь нажал «Позже» в уведомлении */
  dismissed: boolean
}

const REPO = 'Aurum2347/Playly'
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

/* Первая проверка после запуска и интервал повторных */
const FIRST_CHECK_DELAY = 15_000
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

let state: UpdaterState = {
  status: 'idle',
  version: null,
  notes: null,
  date: null,
  releaseUrl: null,
  installable: false,
  downloaded: 0,
  total: 0,
  error: null,
  checkedAt: null,
  auto: true,
  dismissed: false,
}
let update: Update | null = null
let started = false

const PORTABLE_TARGET = 'windows-x86_64-portable'
let portableCache: boolean | null = null
async function isPortable(): Promise<boolean> {
  if (portableCache === null) portableCache = await invoke<boolean>('is_portable').catch(() => false)
  return portableCache
}
let selfUpdateCache: boolean | null = null
async function canSelfUpdate(): Promise<boolean> {
  if (selfUpdateCache === null) selfUpdateCache = await invoke<boolean>('can_self_update').catch(() => true)
  return selfUpdateCache
}
const listeners = new Set<() => void>()

function set(patch: Partial<UpdaterState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useUpdater(): UpdaterState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => state
  )
}

/** «2.0.4» → [2, 0, 4]; null, если номера версии в строке нет */
export function parseVersion(text: string | null | undefined): number[] | null {
  const m = text?.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

/** <0 — a старше b, 0 — одна и та же версия, >0 — a новее */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function verdict(remote: string, current: string): 'available' | 'latest' | 'unknown' {
  const r = parseVersion(remote)
  const c = parseVersion(current)
  if (!r || !c) return 'unknown'
  const diff = compareVersions(r, c)
  return diff > 0 ? 'available' : diff === 0 ? 'latest' : 'unknown'
}

function dropUpdate() {
  update?.close().catch(() => {})
  update = null
}

interface GithubRelease {
  name: string | null
  tag_name: string
  html_url: string
  published_at: string | null
}

/**
 * Запасной путь, когда в релизе нет latest.json: номер версии берётся из названия релиза
 * («Snapshot 2.0.3», «Release v2.0»). Тег у релизов бывает датой, поэтому он — только если похож на v1.2.3.
 */
async function fetchGithubRelease(): Promise<{ version: string; url: string; date: string | null } | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`)
  const rel = (await res.json()) as GithubRelease
  const parsed = parseVersion(rel.name) ?? (/^v\d/i.test(rel.tag_name) ? parseVersion(rel.tag_name) : null)
  if (!parsed) return null
  return { version: parsed.join('.'), url: rel.html_url, date: rel.published_at }
}

/** silent — фоновая проверка: ошибки (нет сети, нет релиза) не показываются */
export async function checkForUpdates(silent = false): Promise<void> {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'installing') return
  /* Уже скачанное обновление не перепроверяем — оно готово к установке */
  if (state.status === 'ready') return
  set({ status: 'checking', error: null })

  let found: Update | null = null
  let pluginError: unknown = null
  try {
    found = await check((await isPortable()) ? { target: PORTABLE_TARGET } : undefined)
  } catch (e) {
    pluginError = e
  }

  if (found) {
    dropUpdate()
    const status = verdict(found.version, found.currentVersion)
    /* Пакеты .deb и .rpm на Linux сами не обновляются (умеет только AppImage) — им только ссылка на релиз */
    const installable = status !== 'latest' && (await canSelfUpdate())
    if (installable) update = found
    else found.close().catch(() => {})
    set({
      status: status === 'available' && !installable ? 'manual' : status,
      checkedAt: Date.now(),
      version: found.version,
      notes: found.body?.trim() || null,
      date: found.date ?? null,
      releaseUrl: RELEASES_URL,
      installable,
      /* Новое уведомление — только о действительно новой версии */
      dismissed: status === 'available' ? false : state.dismissed,
    })
    if (status === 'available' && installable && state.auto) await downloadUpdate()
    return
  }

  /* Плагин ничего не вернул или не смог прочитать latest.json — спрашиваем GitHub напрямую */
  if (pluginError) console.warn('[updater] latest.json недоступен:', pluginError)
  try {
    const rel = await fetchGithubRelease()
    dropUpdate()
    if (!rel) {
      set({ status: 'latest', checkedAt: Date.now(), version: null, notes: null, date: null, releaseUrl: RELEASES_URL, installable: false })
      return
    }
    const status = verdict(rel.version, APP_VERSION)
    set({
      status: status === 'available' ? 'manual' : status,
      checkedAt: Date.now(),
      version: rel.version,
      notes: null,
      date: rel.date,
      releaseUrl: rel.url,
      installable: false,
      dismissed: status === 'available' ? false : state.dismissed,
    })
  } catch (e) {
    console.warn('[updater] Не удалось проверить обновления:', e)
    set(silent ? { status: 'idle' } : { status: 'error', error: String(pluginError ?? e), checkedAt: Date.now() })
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!update || state.status === 'downloading' || state.status === 'ready') return
  set({ status: 'downloading', downloaded: 0, total: 0, error: null })
  try {
    let downloaded = 0
    if (await isPortable()) {
      const onProgress = new Channel<{ event: 'Started' | 'Progress'; total?: number | null; chunk?: number }>()
      onProgress.onmessage = (m) => {
        if (m.event === 'Started') set({ total: m.total ?? 0 })
        else {
          downloaded += m.chunk ?? 0
          set({ downloaded })
        }
      }
      await invoke('portable_download', { onProgress })
    } else {
      await update.download((event) => {
        if (event.event === 'Started') set({ total: event.data.contentLength ?? 0 })
        else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          set({ downloaded })
        }
      })
    }
    /* Подпись уже проверена плагином: до этого момента приложение ничего не трогает */
    set({ status: 'ready', dismissed: false })
  } catch (e) {
    console.error('[updater] Не удалось скачать обновление:', e)
    set({ status: 'error', error: String(e) })
  }
}

/** Установить скачанное и перезапуститься (на Windows установщик сам закроет и откроет Playly) */
export async function installUpdate(): Promise<void> {
  if (!update || state.status !== 'ready') return
  set({ status: 'installing' })
  try {
    /* Портативная версия подменяет свой .exe и перезапускается сама (Rust закрывает приложение) */
    if (await isPortable()) {
      await invoke('portable_apply')
      return
    }
    await update.install()
    await relaunch()
  } catch (e) {
    console.error('[updater] Не удалось установить обновление:', e)
    set({ status: 'error', error: String(e) })
  }
}

/** «Неизвестная версия» → поставить текущий релиз: скачать и сразу установить */
export async function installReleaseBuild(): Promise<void> {
  if (!update || state.status !== 'unknown') return
  await downloadUpdate()
  /* downloadUpdate меняет state — TypeScript об этом не знает и сузил бы тип до 'unknown' */
  if ((state.status as UpdateStatus) === 'ready') await installUpdate()
}

export function dismissUpdateToast() {
  set({ dismissed: true })
}

export async function setAutoUpdate(auto: boolean) {
  set({ auto })
  await writeSettingsRaw({ autoUpdate: auto })
  if (auto && state.status === 'available') void downloadUpdate()
}

/** Запускается один раз, когда приложение готово: фоновые проверки по расписанию */
export async function startUpdater() {
  if (started) return
  started = true
  const raw = await readSettingsRaw()
  set({ auto: raw.autoUpdate !== false })
  setTimeout(() => {
    void checkForUpdates(true)
    setInterval(() => void checkForUpdates(true), CHECK_INTERVAL)
  }, FIRST_CHECK_DELAY)
}
