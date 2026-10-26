import { appDataDir, join, sep } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile, readFile, writeFile, mkdir } from '@tauri-apps/plugin-fs'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { Track, PlaylistBanner } from '../App'
import { normalizeFrame } from './imageFrame'
import type { DiscordParts } from './discord'
import type { AppBackdrop, ParticleSettings } from './appearance'

/* Аудио и видео: у видео играет звуковая дорожка, а кадры можно взять для анимированной обложки */
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'oga', 'aac', 'opus', 'wma', 'aif', 'aiff', 'weba']
export const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv']
export const SUPPORTED_EXT = [...AUDIO_EXT, ...VIDEO_EXT]

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
  await mkdir(covers, { recursive: true }).catch(() => {})
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

/** Сохранить обложку из уже прочитанных байтов (например, GIF, собранный из видео) */
export async function saveCoverFromBytes(
  key: string,
  bytes: Uint8Array,
  ext: string
): Promise<{ coverFile: string; coverUrl: string } | null> {
  try {
    if (bytes.length === 0) return null
    const name = `${key}.${ext}`
    await writeFile(await join(await ensureCoversDir(), name), bytes)
    return { coverFile: name, coverUrl: bytesToObjectUrl(bytes, mimeFromExt(name)) }
  } catch (e) {
    console.error('Не удалось сохранить обложку:', e)
    return null
  }
}

/*
 * При запуске обложки не читаются в память: WebView загружает их сам по asset-ссылке —
 * лениво (только видимые), с кешем и без сотен вызовов IPC. Метка сессии в ссылке нужна,
 * чтобы после замены файла с тем же именем не показалась старая картинка из кеша.
 */
const SESSION_STAMP = Date.now().toString(36)

/** Имена файлов в папке обложек — одним вызовом вместо exists() на каждый трек */
async function listCoverFiles(dir: string): Promise<Set<string>> {
  try {
    const files = await invoke<Array<{ name: string }>>('list_dir_sizes', { path: dir })
    return new Set(files.map((f) => f.name))
  } catch {
    return new Set()
  }
}

function coverAssetUrl(dir: string, file: string): string {
  return `${convertFileSrc(`${dir}${sep()}${file}`)}?v=${SESSION_STAMP}`
}

/** Загрузить файл из папки covers как blob-url (null — файла нет) */
export async function loadCoverUrl(coverFile: string | null | undefined): Promise<string | null> {
  if (!coverFile) return null
  try {
    const abs = await join(await ensureCoversDir(), coverFile)
    if (!(await exists(abs))) return null
    return bytesToObjectUrl(await readFile(abs), mimeFromExt(coverFile))
  } catch {
    return null
  }
}

/**
 * Длительность файла без чтения целиком: браузер сам берёт её из заголовка
 * (нужно для форматов, которые не разбирают теги, — например, WebM и MKV).
 */
export function probeDuration(path: string, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.muted = true
    let done = false
    const finish = (v: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.removeAttribute('src')
      el.load()
      resolve(isFinite(v) && v > 0 ? v : 0)
    }
    const timer = setTimeout(() => finish(0), timeoutMs)
    el.onloadedmetadata = () => finish(el.duration)
    el.onerror = () => finish(0)
    el.src = convertFileSrc(path)
  })
}

/** Скопировать уже сохранённую обложку (например, другого трека) под новым именем */
export async function copyCover(
  key: string,
  coverFile: string
): Promise<{ coverFile: string; coverUrl: string } | null> {
  const source = await join(await ensureCoversDir(), coverFile)
  /* Уникальное имя: иначе смена обложки у источника перезапишет и копию */
  return saveCoverFromFile(`${key}-${Date.now()}`, source)
}

/** Сохранить обложку из выбранного файла (key = id трека или 'pl-<id>' плейлиста) */
export async function saveCoverFromFile(
  key: string,
  sourcePath: string,
  /* Баннеры (особенно GIF) бывают заметно тяжелее обложек */
  maxBytes = 5 * 1024 * 1024
): Promise<{ coverFile: string; coverUrl: string } | null> {
  try {
    const bytes = await readFile(sourcePath)
    if (!bytes || bytes.length === 0 || bytes.length > maxBytes) return null

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
    const coverFiles = await listCoverFiles(coversDir)
    const BATCH = 25

    for (let i = 0; i < total; i += BATCH) {
      const batch = tracks.slice(i, i + BATCH)

      await Promise.all(
        batch.map(async (t) => {
          try {
            if (t.coverFile) {
              t.cover = coverFiles.has(t.coverFile) ? coverAssetUrl(coversDir, t.coverFile) : null
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
  color?: string | null
  banner?: PlaylistBanner | null
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
    const coverFiles = await listCoverFiles(coversDir)

    await Promise.all(
      lists.map(async (pl) => {
        pl.cover = null
        if (pl.coverFile && coverFiles.has(pl.coverFile)) pl.cover = coverAssetUrl(coversDir, pl.coverFile)
        if (pl.banner?.file) {
          pl.banner.url = null
          pl.banner.frame = normalizeFrame(pl.banner.frame)
          if (coverFiles.has(pl.banner.file)) pl.banner.url = coverAssetUrl(coversDir, pl.banner.file)
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
    const stripped = lists.map((pl) => ({
      ...pl,
      cover: null,
      banner: pl.banner ? { ...pl.banner, url: null } : pl.banner,
    }))
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

    /* Видео и редкие контейнеры: тегов нет, но длительность можно узнать у самого движка */
    const durationSecs = meta?.durationSecs || (await probeDuration(path))

    if (meta) {
      opts.onTrack?.({
        id: trackId,
        title: meta.title || fileName.replace(/\.[^.]+$/, ''),
        artist: meta.artist || 'Неизвестный исполнитель',
        album: meta.album || 'Неизвестный альбом',
        genre: meta.genre || '',
        duration: formatDuration(durationSecs),
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
        duration: formatDuration(durationSecs),
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

export type CrossfadeCurveSetting = 'equal' | 'linear' | 'smooth'

export interface AppSettings {
  volume: number
  isMuted: boolean
  crossfade: number
  /* Кроссфейд и при ручном переключении треков */
  manualCrossfade: boolean
  crossfadeCurve: CrossfadeCurveSetting
  outputDevice: string
  discordRpc?: boolean
  discordParts?: DiscordParts
  appBackdrop?: AppBackdrop
  particles?: ParticleSettings
  autoUpdate?: boolean
  /* Визуализатор в расширенном режиме */
  visualizer?: boolean
  /* Эквалайзер: включён ли, id пресета, свои пресеты */
  eqEnabled?: boolean
  eq?: string
  eqCustomPresets?: Array<{ id: string; name: string; gains: number[] }>
}

const DEFAULT_SETTINGS: AppSettings = {
  volume: 100,
  isMuted: false,
  crossfade: 0,
  manualCrossfade: false,
  crossfadeCurve: 'equal',
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
      manualCrossfade: data.manualCrossfade === true,
      crossfadeCurve:
        data.crossfadeCurve === 'linear' || data.crossfadeCurve === 'smooth'
          ? data.crossfadeCurve
          : 'equal',
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