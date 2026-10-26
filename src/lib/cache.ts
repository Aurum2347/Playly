import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, remove } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { applyTheme, loadThemeSetting } from '../components/views/settings/helpers'

/*
 * Что считается кешем — то, что можно удалить без потерь:
 *  • кеш WebView (скрипты, шейдеры, HTTP-кеш интерфейса) — пересоздаётся сам;
 *  • обложки в папке covers, на которые больше не ссылается ни один трек или плейлист;
 *  • временные файлы (резервные копии статистики, папка tmp).
 * Библиотека, плейлисты, профиль и используемые обложки не трогаются.
 */

export interface CacheGroup {
  size: number
  files: string[]
}

export interface CacheReport {
  webview: number
  orphanCovers: CacheGroup
  temp: CacheGroup
  /* Данные Playly, которые очистка не трогает: библиотека, настройки, профиль, используемые обложки */
  dataTotal: number
}

interface FileSize {
  name: string
  size: number
}

async function playlyDir(): Promise<string> {
  return join(await appDataDir(), 'playly')
}

/** Временные файлы: копии повреждённой статистики и всё из папки tmp */
async function collectTemp(dir: string): Promise<CacheGroup> {
  const files: string[] = []
  let size = 0
  const top = await invoke<FileSize[]>('list_dir_sizes', { path: dir }).catch(() => [])
  for (const f of top) {
    if (/\.bak$/i.test(f.name) || /\.tmp$/i.test(f.name)) {
      files.push(await join(dir, f.name))
      size += f.size
    }
  }
  const tmp = await join(dir, 'tmp')
  if (await exists(tmp)) {
    files.push(tmp)
    size += await invoke<number>('path_size', { path: tmp }).catch(() => 0)
  }
  return { size, files }
}

/**
 * referenced — имена файлов обложек, которые сейчас используются (берутся из состояния приложения,
 * а не с диска: свежие изменения могли ещё не сохраниться).
 */
export async function getCacheReport(referenced: Set<string>): Promise<CacheReport> {
  const dir = await playlyDir()
  const coversDir = await join(dir, 'covers')
  const covers = await invoke<FileSize[]>('list_dir_sizes', { path: coversDir }).catch(() => [])
  const orphanCovers: CacheGroup = { size: 0, files: [] }
  for (const f of covers) {
    if (referenced.has(f.name)) continue
    orphanCovers.files.push(await join(coversDir, f.name))
    orphanCovers.size += f.size
  }

  const [webview, temp, dataTotal] = await Promise.all([
    invoke<number>('webview_cache_size').catch(() => 0),
    collectTemp(dir),
    invoke<number>('path_size', { path: dir }).catch(() => 0),
  ])
  /* Из размера папки вычитаем то, что и есть кеш, — иначе «все данные» выходили меньше самого кеша */
  return { webview, orphanCovers, temp, dataTotal: Math.max(0, dataTotal - orphanCovers.size - temp.size) }
}

export const cacheTotal = (r: CacheReport) => r.webview + r.orphanCovers.size + r.temp.size

/**
 * Удаляет кеш. Файлы WebView сейчас заняты окном, поэтому сразу очищаются только данные браузера,
 * а сами папки кеша удаляются при следующем запуске. Возвращает, сколько байт освобождено сразу.
 */
export async function clearCache(report: CacheReport): Promise<number> {
  let freed = 0
  for (const group of [report.orphanCovers, report.temp]) {
    for (const path of group.files) {
      try {
        await remove(path, { recursive: true })
      } catch (e) {
        console.error('Не удалось удалить файл кеша:', path, e)
      }
    }
    freed += group.size
  }

  try {
    await getCurrentWebview().clearAllBrowsingData()
  } catch (e) {
    console.error('Не удалось очистить данные WebView:', e)
  }
  /* Вместе с данными браузера стёрлась и запомненная тема — возвращаем, иначе при запуске мигнёт тёмная */
  applyTheme(await loadThemeSetting())
  await invoke('schedule_webview_cache_wipe').catch((e) => console.error('Не удалось запланировать очистку кеша:', e))
  return freed
}

/** 1536 → «1,5 КБ»; единицы берутся из перевода */
export function formatBytes(bytes: number, units: string[], locale: string): string {
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  const digits = i === 0 || v >= 100 ? 0 : 1
  return `${v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[i]}`
}
