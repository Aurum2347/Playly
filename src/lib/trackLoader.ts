import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile, readFile, writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import type { Track } from '../App'

export const SUPPORTED_EXT = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'wma']

export function isAudioFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return SUPPORTED_EXT.includes(ext)
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface RustTrackMeta {
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  durationSecs: number
  cover: string | null
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0))

async function ensureConfigDir(): Promise<string> {
  const appDir = await appDataDir()
  return await join(appDir, 'playly')
}

async function ensureCoversDir(): Promise<string> {
  const dir = await ensureConfigDir()
  const covers = await join(dir, 'covers')
  try {
    await mkdir(covers, { recursive: true })
  } catch {
    // уже есть
  }
  return covers
}

export async function getTracksConfigPath(): Promise<string> {
  const dir = await ensureConfigDir()
  return await join(dir, 'tracks.json')
}

/* ===== Обложки ===== */

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('bmp')) return 'bmp'
  return 'jpg'
}

function mimeFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    default: return 'image/jpeg'
  }
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, comma).split(';')[0] || 'image/jpeg'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
}

async function persistCover(
  dataUrl: string,
  key: string
): Promise<{ coverFile: string; coverUrl: string } | null> {
  try {
    const { bytes, mime } = dataUrlToBytes(dataUrl)
    if (bytes.length === 0 || bytes.length > 3 * 1024 * 1024) return null

    const coversDir = await ensureCoversDir()
    const name = `${key}.${extFromMime(mime)}`
    await writeFile(await join(coversDir, name), bytes)

    return { coverFile: name, coverUrl: bytesToObjectUrl(bytes, mime) }
  } catch {
    return null
  }
}

/** Сохранить обложку из выбранного файла (key = id трека или 'pl-<id>' плейлиста) */
export async function saveCoverFromFile(
  key: string,
  sourcePath: string
): Promise<{ coverFile: string; coverUrl: string } | null> {
  try {
    const bytes = await readFile(sourcePath)
    if (!bytes || bytes.length === 0 || bytes.length > 5 * 1024 * 1024) return null

    const ext = sourcePath.split('.').pop()?.toLowerCase() || 'jpg'
    const coversDir = await ensureCoversDir()
    const name = `${key}.${ext}`

    await writeFile(await join(coversDir, name), bytes)

    return { coverFile: name, coverUrl: bytesToObjectUrl(bytes, mimeFromExt(name)) }
  } catch (e) {
    console.error('Не удалось сохранить обложку:', e)
    return null
  }
}

/* ===== Конфиг треков ===== */

export async function loadTracksFromConfig(
  onProgress?: (loaded: number, total: number) => void
): Promise<Track[]> {
  try {
    const path = await getTracksConfigPath()
    if (!(await exists(path))) return []

    const content = await readTextFile(path)
    const data = JSON.parse(content)
    if (!Array.isArray(data)) return []

    const tracks = data as Track[]
    const total = tracks.length
    onProgress?.(0, total)

    const coversDir = await ensureCoversDir()
    const BATCH = 25

    for (let i = 0; i < total; i += BATCH) {
      const batch = tracks.slice(i, i + BATCH)

      await Promise.all(
        batch.map(async (t) => {
          try {
            if (t.coverFile) {
              const abs = await join(coversDir, t.coverFile)
              if (await exists(abs)) {
                const bytes = await readFile(abs)
                t.cover = bytesToObjectUrl(bytes, mimeFromExt(t.coverFile))
              } else {
                t.cover = null
              }
            } else if (typeof t.cover === 'string' && t.cover.startsWith('data:')) {
              const saved = await persistCover(t.cover, String(t.id))
              if (saved) {
                t.coverFile = saved.coverFile
                t.cover = saved.coverUrl
              } else {
                t.cover = null
              }
            }
          } catch {
            t.cover = null
          }
        })
      )

      const mtimes = await Promise.all(
        batch.map(async (t) => {
          if (!t.filePath) return t.addedAt || 0
          try {
            return await invoke<number>('get_file_mtime', { path: t.filePath })
          } catch {
            return t.addedAt || 0
          }
        })
      )

      batch.forEach((t, j) => {
        t.fileModifiedAt = mtimes[j]
      })

      onProgress?.(Math.min(i + BATCH, total), total)
      await nextTick()
    }

    return tracks
  } catch (e) {
    console.error('Не удалось прочитать tracks.json:', e)
    return []
  }
}

export async function saveTracksToConfig(tracks: Track[]): Promise<void> {
  try {
    const path = await getTracksConfigPath()
    const stripped = tracks.map((t) => ({ ...t, cover: null }))
    await writeTextFile(path, JSON.stringify(stripped))
  } catch (e) {
    console.error('Не удалось сохранить tracks.json:', e)
  }
}

/* ===== Плейлисты ===== */

export interface PlaylistData {
  id: number
  name: string
  cover?: string | null
  coverFile?: string | null
  trackIds: number[]
}

export async function loadPlaylists(): Promise<PlaylistData[]> {
  try {
    const dir = await ensureConfigDir()
    const path = await join(dir, 'playlists.json')
    if (!(await exists(path))) return []

    const content = await readTextFile(path)
    const data = JSON.parse(content)
    if (!Array.isArray(data)) return []

    const lists = data as PlaylistData[]
    const coversDir = await ensureCoversDir()

    await Promise.all(
      lists.map(async (pl) => {
        pl.cover = null
        if (pl.coverFile) {
          try {
            const abs = await join(coversDir, pl.coverFile)
            if (await exists(abs)) {
              const bytes = await readFile(abs)
              pl.cover = bytesToObjectUrl(bytes, mimeFromExt(pl.coverFile))
            }
          } catch {
            // ignore
          }
        }
      })
    )

    return lists
  } catch {
    return []
  }
}

export async function savePlaylists(lists: PlaylistData[]): Promise<void> {
  try {
    const dir = await ensureConfigDir()
    const path = await join(dir, 'playlists.json')
    const stripped = lists.map((pl) => ({ ...pl, cover: null }))
    await writeTextFile(path, JSON.stringify(stripped))
  } catch (e) {
    console.error('Не удалось сохранить playlists.json:', e)
  }
}

/* ===== Парсинг аудио ===== */

export interface ParseOptions {
  onProgress?: (p: { current: number; total: number; fileName: string }) => void
  onTrack?: (track: Track) => void
  shouldStop?: () => boolean
  existingPaths?: Set<string>
}

export async function parseAudioFiles(filePaths: string[], opts: ParseOptions = {}) {
  const seen = new Set<string>()
  const total = filePaths.length

  for (let i = 0; i < total; i++) {
    if (opts.shouldStop?.()) break

    const path = filePaths[i]
    const fileName = path.split(/[\\/]/).pop() || path

    opts.onProgress?.({ current: i, total, fileName })

    if (opts.existingPaths?.has(path) || seen.has(path)) {
      opts.onProgress?.({ current: i + 1, total, fileName })
      await nextTick()
      continue
    }

    seen.add(path)

    const [meta, mtime] = await Promise.all([
      invoke<RustTrackMeta>('get_track_metadata', { path }).catch(() => null),
      invoke<number>('get_file_mtime', { path }).catch(() => Date.now()),
    ])

    const trackId = Date.now() + i + Math.floor(Math.random() * 10000)

    let cover: string | null = null
    let coverFile: string | null = null

    if (meta?.cover) {
      const saved = await persistCover(meta.cover, String(trackId))
      if (saved) {
        coverFile = saved.coverFile
        cover = saved.coverUrl
      }
    }

    if (meta) {
      opts.onTrack?.({
        id: trackId,
        title: meta.title || fileName.replace(/\.[^.]+$/, ''),
        artist: meta.artist || 'Неизвестный исполнитель',
        album: meta.album || 'Неизвестный альбом',
        genre: meta.genre || '',
        duration: formatDuration(meta.durationSecs),
        liked: false,
        cover,
        coverFile,
        filePath: path,
        addedAt: Date.now(),
        fileModifiedAt: mtime,
      })
    } else {
      opts.onTrack?.({
        id: trackId,
        title: fileName.replace(/\.[^.]+$/, ''),
        artist: 'Неизвестный исполнитель',
        album: 'Неизвестный альбом',
        genre: '',
        duration: '0:00',
        liked: false,
        cover: null,
        coverFile: null,
        filePath: path,
        addedAt: Date.now(),
        fileModifiedAt: mtime,
      })
    }

    opts.onProgress?.({ current: i + 1, total, fileName })
    await nextTick()
  }

  opts.onProgress?.({ current: total, total, fileName: '' })
}

/* ===== История ===== */

export async function loadPlayHistory(): Promise<Record<number, number>> {
  try {
    const dir = await ensureConfigDir()
    const path = await join(dir, 'history.json')
    if (!(await exists(path))) return {}

    const data = JSON.parse(await readTextFile(path))
    return data && typeof data === 'object' ? (data as Record<number, number>) : {}
  } catch {
    return {}
  }
}

export async function savePlayHistory(history: Record<number, number>): Promise<void> {
  try {
    const dir = await ensureConfigDir()
    await writeTextFile(await join(dir, 'history.json'), JSON.stringify(history))
  } catch (e) {
    console.error(e)
  }
}

/* ===== Настройки ===== */

export interface AppSettings {
  volume: number
  isMuted: boolean
  crossfade: number
  outputDevice: string
}

const DEFAULT_SETTINGS: AppSettings = {
  volume: 100,
  isMuted: false,
  crossfade: 0,
  outputDevice: '',
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const dir = await ensureConfigDir()
    const path = await join(dir, 'settings.json')

    if (!(await exists(path))) return DEFAULT_SETTINGS

    const data = JSON.parse(await readTextFile(path)) as Record<string, unknown>

    return {
      volume: Math.max(0, Math.min(100, Math.round((data.volume as number) ?? 100))),
      isMuted: Boolean(data.isMuted),
      crossfade: Math.max(0, Math.min(12, Math.round((data.crossfade as number) ?? 0))),
      outputDevice: typeof data.outputDevice === 'string' ? (data.outputDevice as string) : '',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/**
 * Сохраняет ТОЛЬКО переданные поля, не затирая остальные
 * (тема, свой шрифт и т.д. остаются на месте).
 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  try {
    const dir = await ensureConfigDir()
    const path = await join(dir, 'settings.json')

    let current: Record<string, unknown> = {}

    if (await exists(path)) {
      try {
        current = JSON.parse(await readTextFile(path)) as Record<string, unknown>
      } catch {
        current = {}
      }
    }

    await writeTextFile(path, JSON.stringify({ ...current, ...patch }, null, 2))
  } catch (e) {
    console.error(e)
  }
}