import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { join, appDataDir } from '@tauri-apps/api/path'
import { readDir, remove, exists } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { notify, reportError } from '../lib/feedback'
import {
  baseName,
  diffFolder,
  isInside,
  lrcNameFor,
  normPath,
  pickCandidate,
  pickLrc,
  searchRoots,
  sidecarLrc,
  type DiskFile,
} from '../lib/libraryMatch'
import { writeLibraryJson } from '../lib/libraryFiles'
import { open } from '@tauri-apps/plugin-dialog'
import {
  loadPlayHistory,
  loadPlaylists,
  loadTracksFromConfig,
  parseAudioFiles,
  isAudioFile,
  saveCoverFromBytes,
  writeCoverFile,
  coverBlobUrl,
  SUPPORTED_EXT,
  savePlayHistory,
  savePlaylists,
  saveTracksToConfig,
} from '../lib/trackLoader'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import { initPlayEvents, recordPlayEvent, clearPlayEvents, forgetPlayEvents } from '../lib/playHistory'
import { pickVisual } from '../lib/media'
import type { CoverPick, Playlist, Track, ViewType } from '../App'
import type { TrackUpdates } from '../components/views/TrackEditModal'

export interface UploadState {
  files: { name: string }[]
  total: number
  current: number
  fileName: string
  finished: boolean
}

export interface LoadProgress {
  loaded: number
  total: number
}

export type SyncMode = 'auto' | 'manual'

/* Обложки и баннеры (GIF бывают тяжёлыми) */
const COVER_MAX_BYTES = 5 * 1024 * 1024
const BANNER_MAX_BYTES = 25 * 1024 * 1024

interface UseLibraryOptions {
  navigate: (view: ViewType) => void
  onTracksDeleted: (ids: number[]) => void
  onLibraryCleared: () => void
}

interface FileStatus {
  exists: boolean
  size: number
  readable: boolean
}

/** Перемещённый трек нашёлся в нескольких местах — пользователь выбирает сам */
export interface RelinkChoice {
  trackId: number
  title: string
  oldPath: string
  candidates: string[]
  /* Найденные .lrc с тем же именем — чтобы привязать текст после выбора */
  lrcs: DiskFile[]
}

/* Слежение за папкой недоступно — проверяем её так часто */
const FALLBACK_SCAN_MS = 60_000

const isLrcPath = (p: string) => /\.lrc$/i.test(p)

/* .lrc без своего трека рядом (перенесли отдельно от музыки) — только такие можно привязать к другому месту */
function orphanLrcs(lrcs: DiskFile[], audio: DiskFile[]): DiskFile[] {
  const sidecars = new Set(audio.map((f) => normPath(sidecarLrc(f.path))))
  return lrcs.filter((l) => !sidecars.has(normPath(l.path)))
}

async function walkAudioFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string) => {
    try {
      const entries = await readDir(d)
      for (const e of entries) {
        if (!e.name) continue
        const p = await join(d, e.name)
        if (e.isDirectory) await walk(p)
        else if (isAudioFile(p)) out.push(p)
      }
    } catch {
      /* Папка недоступна (нет прав, удалена во время обхода) — пропускаем её */
    }
  }
  await walk(dir)
  return out
}

/** Все аудиофайлы папки: быстрый обход на стороне Rust, при его недоступности — через плагин fs */
async function scanDir(dir: string, withLrc = false): Promise<DiskFile[] | null> {
  try {
    return await invoke<DiskFile[]>('scan_audio_dir', { root: dir, exts: withLrc ? [...SUPPORTED_EXT, 'lrc'] : SUPPORTED_EXT })
  } catch (e) {
    /* Папки нет (диск отключён) — это не «все файлы удалены» */
    if (e === 'missing') return null
    const files = await walkAudioFiles(dir)
    return files.map((path) => ({ path, size: 0, mtime: 0 }))
  }
}

async function fileStatus(paths: string[]): Promise<FileStatus[] | null> {
  if (paths.length === 0) return []
  return invoke<FileStatus[]>('file_status', { paths }).catch(() => null)
}

export default function useLibrary(options: UseLibraryOptions) {
  /* Колбэки приходят новыми на каждой перерисовке — держим их в ref, чтобы обработчики библиотеки
     оставались стабильными и memo-страницы не перерисовывались на каждом тике плеера */
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const navigate = useCallback((view: ViewType) => optionsRef.current.navigate(view), [])
  const onTracksDeleted = useCallback((ids: number[]) => optionsRef.current.onTracksDeleted(ids), [])
  const onLibraryCleared = useCallback(() => optionsRef.current.onLibraryCleared(), [])

  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playHistory, setPlayHistory] = useState<Record<number, number>>({})
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null)
  const [isLoadingTracks, setIsLoadingTracks] = useState(true)
  const [upload, setUpload] = useState<UploadState | null>(null)
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null)
  const [libraryFolder, setLibraryFolder] = useState('')
  const [syncMode, setSyncMode] = useState<SyncMode>('auto')
  const [isScanning, setIsScanning] = useState(false)

  const tracksRef = useRef<Track[]>([])
  const playHistoryRef = useRef<Record<number, number>>({})
  const cancelUploadRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playlistsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const libraryFolderRef = useRef('')
  const syncModeRef = useRef<SyncMode>('auto')
  const isScanningRef = useRef(false)
  /* Файлы, которые прямо сейчас импортируются: перетаскивание во время сканирования папки не добавит их дважды */
  const importingRef = useRef(new Set<string>())
  /* Пока папка сканируется, пришли новые изменения — после текущего прохода нужен ещё один */
  const resyncRef = useRef(false)
  const relinkBusyRef = useRef(new Set<number>())
  const [relinkChoices, setRelinkChoices] = useState<RelinkChoice[]>([])

  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])
  useEffect(() => {
    libraryFolderRef.current = libraryFolder
  }, [libraryFolder])
  useEffect(() => {
    syncModeRef.current = syncMode
  }, [syncMode])

  const scheduleSave = useCallback((next: Track[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveTracksToConfig(next), 300)
  }, [])

  const schedulePlaylistsSave = useCallback((lists: Playlist[]) => {
    if (playlistsSaveTimerRef.current) clearTimeout(playlistsSaveTimerRef.current)
    playlistsSaveTimerRef.current = setTimeout(() => savePlaylists(lists), 300)
  }, [])

  useEffect(() => {
    if (isLoadingTracks) return
    scheduleSave(tracks)
  }, [tracks, isLoadingTracks, scheduleSave])

  useEffect(() => {
    if (isLoadingTracks) return
    schedulePlaylistsSave(playlists)
  }, [playlists, isLoadingTracks, schedulePlaylistsSave])

  const recordPlay = useCallback((trackId: number) => {
    const next = { ...playHistoryRef.current, [trackId]: Date.now() }
    playHistoryRef.current = next
    setPlayHistory(next)
    savePlayHistory(next)
    recordPlayEvent(trackId)
  }, [])

  /* Возвращает id треков из выбранных файлов: и новых, и уже лежавших в библиотеке */
  const addTracksFromPaths = useCallback(async (paths: string[]): Promise<number[]> => {
    cancelUploadRef.current = false
    const names = paths.map((p) => ({ name: p.split(/[\\/]/).pop() || p }))
    setUpload({ files: names, total: paths.length, current: 0, fileName: '', finished: false })
    const existing = new Set([...tracksRef.current.map((t) => t.filePath), ...importingRef.current])
    const byPath = new Map(tracksRef.current.map((t) => [t.filePath, t.id]))
    const ids = paths.map((p) => byPath.get(p)).filter((id): id is number => id !== undefined)
    const mine = paths.filter((p) => !existing.has(p))
    mine.forEach((p) => importingRef.current.add(p))
    /* Пустые, недоступные и нечитаемые файлы в библиотеку не попадают */
    const broken: string[] = []
    const statuses = await fileStatus(mine)
    if (statuses) {
      mine.forEach((p, i) => {
        if (statuses[i] && !statuses[i].readable) {
          broken.push(p)
          existing.add(p)
        }
      })
    }
    try {
      await parseAudioFiles(paths, {
        existingPaths: existing,
        onSkip: (path) => broken.push(path),
        shouldStop: () => cancelUploadRef.current,
        onProgress: (p) =>
          setUpload((u) => (u ? { ...u, current: p.current, fileName: p.fileName } : u)),
        onTrack: (track) => {
          if (cancelUploadRef.current) return
          ids.push(track.id)
          setTracks((prev) => [...prev, track])
        },
      })
    } finally {
      mine.forEach((p) => importingRef.current.delete(p))
    }
    if (broken.length > 0) {
      reportError('importBroken', broken.join('\n'), { n: broken.length, name: baseName(broken[0]) })
    }
    if (cancelUploadRef.current) {
      setUpload(null)
    } else {
      setUpload((u) => (u ? { ...u, finished: true, current: u.total } : u))
      setTimeout(() => setUpload(null), 700)
    }
    return ids
  }, [])

  const handleAddTracks = useCallback(async (): Promise<number[]> => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Аудио и видео', extensions: SUPPORTED_EXT }],
      })
      if (!selected) return []
      return await addTracksFromPaths(Array.isArray(selected) ? selected : [selected])
    } catch (e) {
      console.error('Ошибка диалога:', e)
      return []
    }
  }, [addTracksFromPaths])

  const handleDeleteTracks = useCallback(
    (ids: number[]) => {
      const idSet = new Set(ids)
      setTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
      setPlaylists((prev) =>
        prev.map((pl) => ({ ...pl, trackIds: pl.trackIds.filter((id) => !idSet.has(id)) }))
      )
      forgetPlayEvents(idSet)
      onTracksDeleted(ids)
    },
    [onTracksDeleted]
  )

  /* Новые пути и поля треков; tracksRef обновляем сразу, чтобы следующий проход уже видел изменения */
  const patchTracks = useCallback((patches: Map<number, Partial<Track>>) => {
    if (patches.size === 0) return
    const apply = (list: Track[]) => list.map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id) } : t))
    tracksRef.current = apply(tracksRef.current)
    setTracks(apply)
  }, [])

  /**
   * Сверить библиотеку с папкой: новые файлы — импорт, перемещённые внутри папки — новый путь
   * (лайки, плейлисты и история остаются), исчезнувшие — убрать из библиотеки (только при prune).
   */
  const syncFolderRef = useRef<((opts?: { folder?: string; prune?: boolean }) => Promise<void>) | null>(null)
  const syncFolder = useCallback(
    async (opts: { folder?: string; prune?: boolean } = {}) => {
      const dir = opts.folder || libraryFolderRef.current
      if (!dir) return
      if (isScanningRef.current) {
        resyncRef.current = true
        return
      }
      isScanningRef.current = true
      setIsScanning(true)
      try {
        const files = await scanDir(dir, true)
        if (!files) return
        const audio = files.filter((f) => !isLrcPath(f.path))
        const lrcs = orphanLrcs(files.filter((f) => isLrcPath(f.path)), audio)
        const lrcOnDisk = new Set(files.filter((f) => isLrcPath(f.path)).map((f) => normPath(f.path)))
        const busy = new Set([...importingRef.current].map(normPath))
        const diff = diffFolder(dir, tracksRef.current, audio, busy)

        /* Текст песни: рядом с треком — как обычно; иначе ищем .lrc, перенесённый отдельно */
        const lrcByName = new Map<string, DiskFile[]>()
        for (const l of lrcs) {
          const key = baseName(normPath(l.path))
          lrcByName.set(key, [...(lrcByName.get(key) ?? []), l])
        }
        const patches = new Map<number, Partial<Track>>()
        for (const t of tracksRef.current) {
          const moved = diff.moved.get(t.id)
          const path = moved?.path ?? t.filePath
          if (!isInside(path, dir)) continue
          const patch: Partial<Track> = moved ? { filePath: moved.path, fileModifiedAt: moved.mtime || t.fileModifiedAt } : {}
          let lrcPath = t.lrcPath ?? null
          if (lrcOnDisk.has(normPath(sidecarLrc(path)))) lrcPath = null
          else if (!lrcPath || (isInside(lrcPath, dir) && !lrcOnDisk.has(normPath(lrcPath)))) {
            lrcPath = pickLrc(path, lrcByName.get(baseName(normPath(lrcNameFor(path)))) ?? [])
          }
          if (lrcPath !== (t.lrcPath ?? null)) patch.lrcPath = lrcPath
          if (Object.keys(patch).length > 0) patches.set(t.id, patch)
        }
        patchTracks(patches)
        if (diff.moved.size > 0) notify('tracksRelinked', { n: diff.moved.size })

        /* Пустая папка при непустой библиотеке — скорее сбой доступа, чем удаление всего подряд */
        if (opts.prune && diff.removed.length > 0 && audio.length > 0) {
          const gone = tracksRef.current.filter((t) => diff.removed.includes(t.id))
          const statuses = await fileStatus(gone.map((t) => t.filePath))
          if (statuses) {
            const ids = gone.filter((_, i) => statuses[i] && !statuses[i].exists).map((t) => t.id)
            if (ids.length > 0) {
              handleDeleteTracks(ids)
              notify('tracksGone', { n: ids.length })
            }
          }
        }
        if (diff.added.length > 0) await addTracksFromPaths(diff.added)
      } catch (e) {
        console.error('Ошибка сканирования папки:', e)
      } finally {
        isScanningRef.current = false
        setIsScanning(false)
        if (resyncRef.current) {
          resyncRef.current = false
          setTimeout(() => void syncFolderRef.current?.({ prune: syncModeRef.current === 'auto' }), 300)
        }
      }
    },
    [addTracksFromPaths, handleDeleteTracks, patchTracks]
  )
  /* Повторная сверка из finally идёт через ref: сама на себя useCallback ссылаться не может */
  useEffect(() => {
    syncFolderRef.current = syncFolder
  }, [syncFolder])

  const scanFolder = useCallback(
    (folder?: string) => syncFolder({ folder, prune: syncModeRef.current === 'auto' && !folder }),
    [syncFolder]
  )

  /* ===== Перемещённые файлы ===== */

  /**
   * Файлов этих треков нет на месте — ищем их по имени рядом с прежним местом и в папке библиотеки.
   * Нашёлся один (или один с тем же временем изменения) — привязываем сразу, несколько — спрашиваем.
   * Возвращает, сколько треков привязано.
   */
  const relinkTracks = useCallback(
    async (ids: number[]): Promise<number> => {
      const wanted = new Set(ids)
      const list = tracksRef.current.filter((t) => wanted.has(t.id) && !relinkBusyRef.current.has(t.id))
      if (list.length === 0) return 0
      list.forEach((t) => relinkBusyRef.current.add(t.id))
      try {
        const statuses = await fileStatus(list.map((t) => t.filePath))
        if (!statuses) return 0
        const missing = list.filter((_, i) => statuses[i] && !statuses[i].exists)
        if (missing.length === 0) return 0
        const names = new Set<string>()
        for (const t of missing) {
          names.add(baseName(t.filePath))
          names.add(lrcNameFor(t.filePath))
        }
        const found = await invoke<Record<string, DiskFile[]>>('find_files_by_name', {
          roots: searchRoots(missing.map((t) => t.filePath), libraryFolderRef.current),
          names: [...names],
        }).catch(() => ({}) as Record<string, DiskFile[]>)
        const known = new Set(tracksRef.current.map((t) => normPath(t.filePath)))
        const patches = new Map<number, Partial<Track>>()
        const choices: RelinkChoice[] = []
        for (const t of missing) {
          const cands = (found[baseName(t.filePath).toLowerCase()] ?? []).filter((f) => !known.has(normPath(f.path)))
          const lrcs = found[lrcNameFor(t.filePath).toLowerCase()] ?? []
          const pick = pickCandidate(t.fileModifiedAt, cands)
          if (pick) {
            known.add(normPath(pick.path))
            patches.set(t.id, { filePath: pick.path, fileModifiedAt: pick.mtime || t.fileModifiedAt, lrcPath: pickLrc(pick.path, lrcs) })
          } else if (cands.length > 1) {
            choices.push({ trackId: t.id, title: t.title, oldPath: t.filePath, candidates: cands.map((c) => c.path), lrcs })
          }
        }
        patchTracks(patches)
        if (patches.size > 0) notify('tracksRelinked', { n: patches.size })
        if (choices.length > 0) {
          setRelinkChoices((prev) => [...prev.filter((c) => !choices.some((n) => n.trackId === c.trackId)), ...choices])
        }
        return patches.size
      } finally {
        list.forEach((t) => relinkBusyRef.current.delete(t.id))
      }
    },
    [patchTracks]
  )

  /** Пользователь выбрал, где теперь лежит трек (null — оставить как есть) */
  const resolveRelink = useCallback(
    (trackId: number, path: string | null) => {
      const choice = relinkChoices.find((c) => c.trackId === trackId)
      setRelinkChoices((prev) => prev.filter((c) => c.trackId !== trackId))
      if (!choice || !path) return
      patchTracks(new Map([[trackId, { filePath: path, lrcPath: pickLrc(path, choice.lrcs) }]]))
      notify('tracksRelinked', { n: 1 })
    },
    [relinkChoices, patchTracks]
  )

  /** Проверить всю библиотеку: найти перемещённые файлы и тексты песен */
  const handleRelinkAll = useCallback(async () => {
    const n = await relinkTracks(tracksRef.current.map((t) => t.id))
    if (n === 0) notify('relinkNothing')
  }, [relinkTracks])

  /* ===== Массовые действия ===== */

  /**
   * Одна обложка для всех выбранных треков. confirm спрашивает пользователя уже после выбора картинки.
   * Ошибки отдельных треков не мешают остальным — о них сообщаем в конце.
   */
  const handleSetCovers = useCallback(
    async (ids: number[], confirm?: (n: number) => boolean) => {
      if (ids.length === 0) return
      let picked
      try {
        picked = await pickVisual({ filterName: 'Изображения', purpose: 'cover', maxBytes: COVER_MAX_BYTES })
      } catch (e) {
        reportError('coversFailed', e, { failed: ids.length, n: ids.length })
        return
      }
      if (!picked) return
      if (confirm && !confirm(ids.length)) return
      const gif = picked.ext === 'gif' && picked.poster ? picked.bytes : null
      const still = gif ? picked.poster! : picked.bytes
      const stillExt = gif ? 'jpg' : picked.ext
      const url = coverBlobUrl(still, `cover.${stillExt}`)
      const stamp = Date.now()
      const patches = new Map<number, Partial<Track>>()
      let failed = 0
      for (const id of ids) {
        const coverFile = `tr-${id}-${stamp}.${stillExt}`
        if (!(await writeCoverFile(coverFile, still))) {
          failed++
          continue
        }
        let animCoverFile: string | null = null
        if (gif) {
          animCoverFile = `tra-${id}-${stamp}.gif`
          if (!(await writeCoverFile(animCoverFile, gif))) animCoverFile = null
        }
        patches.set(id, { cover: url, coverFile, animCoverFile })
      }
      patchTracks(patches)
      if (failed > 0) reportError('coversFailed', undefined, { failed, n: ids.length })
      else notify('coversApplied', { n: patches.size })
    },
    [patchTracks]
  )

  /** Удалить файлы с диска (и треки из библиотеки). Подтверждение — на стороне окна */
  const handleRemoveFiles = useCallback(
    async (ids: number[]): Promise<number[]> => {
      const wanted = new Set(ids)
      const list = tracksRef.current.filter((t) => wanted.has(t.id))
      const done: number[] = []
      const failed: string[] = []
      for (const t of list) {
        try {
          if (await exists(t.filePath)) await remove(t.filePath)
          done.push(t.id)
        } catch (e) {
          console.error('Не удалось удалить файл:', t.filePath, e)
          failed.push(t.filePath)
        }
      }
      if (done.length > 0) handleDeleteTracks(done)
      if (failed.length > 0) reportError('filesRemoveFailed', failed.join('\n'), { n: failed.length })
      else if (done.length > 0) notify('filesRemoved', { n: done.length })
      return done
    },
    [handleDeleteTracks]
  )

  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (!selected || Array.isArray(selected)) return
      setLibraryFolder(selected)
      libraryFolderRef.current = selected
      writeSettingsRaw({ libraryFolder: selected })
      await scanFolder(selected)
    } catch (e) {
      console.error('Ошибка выбора папки:', e)
    }
  }, [scanFolder])

  const handleSyncModeChange = useCallback(
    (mode: SyncMode) => {
      setSyncMode(mode)
      syncModeRef.current = mode
      writeSettingsRaw({ syncMode: mode })
      if (mode === 'auto') scanFolder()
    },
    [scanFolder]
  )

  const handleRescan = useCallback(() => {
    scanFolder()
  }, [scanFolder])

  const maybeAutoScan = useCallback(() => {
    if (syncModeRef.current === 'auto' && libraryFolderRef.current) {
      scanFolder()
    }
  }, [scanFolder])

  /* Режим «Автоматическая»: следим за папкой; если слежение недоступно — периодически проверяем её */
  useEffect(() => {
    if (isLoadingTracks || syncMode !== 'auto' || !libraryFolder) return
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const run = () => {
      if (alive) void syncFolder({ prune: true })
    }
    const unlisten = listen<number>('library://fs-changed', run)
    invoke('watch_library_folder', { path: libraryFolder }).catch((e) => {
      console.warn('Слежение за папкой недоступно, перехожу на периодическую проверку:', e)
      if (alive) timer = setInterval(run, FALLBACK_SCAN_MS)
    })
    return () => {
      alive = false
      void unlisten.then((fn) => fn())
      if (timer) clearInterval(timer)
      invoke('unwatch_library_folder').catch(() => {})
    }
  }, [isLoadingTracks, syncMode, libraryFolder, syncFolder])

  /* Сначала очищаем файлы и только потом интерфейс: если запись не удалась,
     библиотека на экране остаётся как была и не расходится с диском.
     Исходные аудиофайлы не трогаются — удаляются только кеш обложек и записи Playly */
  const handleClearLibrary = useCallback(async () => {
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (playlistsSaveTimerRef.current) clearTimeout(playlistsSaveTimerRef.current)
      cancelUploadRef.current = true
      await writeLibraryJson('tracks.json', [])
      await writeLibraryJson('playlists.json', [])
      await writeLibraryJson('history.json', {})
      setTracks([])
      setPlaylists([])
      setPlayHistory({})
      playHistoryRef.current = {}
      setActivePlaylistId(null)
      onLibraryCleared()
      await clearPlayEvents()
      const covers = await join(await appDataDir(), 'playly', 'covers')
      if (await exists(covers)) await remove(covers, { recursive: true })
    } catch (error) {
      reportError('libraryClear', error)
    }
  }, [onLibraryCleared])

  const loadLibraryData = useCallback(async () => {
    try {
      const raw = await readSettingsRaw()
      if (typeof raw.libraryFolder === 'string') {
        setLibraryFolder(raw.libraryFolder)
        libraryFolderRef.current = raw.libraryFolder
      }
      const sm = raw.syncMode
      if (sm === 'auto' || sm === 'manual') {
        setSyncMode(sm)
        syncModeRef.current = sm
      }
      const loaded = await loadTracksFromConfig((l, t) => setLoadProgress({ loaded: l, total: t }))
      setTracks(loaded)
      const pls = await loadPlaylists()
      setPlaylists(pls)
      const hist = await loadPlayHistory()
      playHistoryRef.current = hist
      setPlayHistory(hist)
      await initPlayEvents(hist)
    } catch (e) {
      console.error('Ошибка загрузки библиотеки:', e)
    }
    setIsLoadingTracks(false)
  }, [])

  const handleToggleLike = useCallback((trackId: number, liked: boolean) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId ? { ...t, liked, likedAt: liked ? Date.now() : undefined } : t
      )
    )
  }, [])

  const handleEditTrack = useCallback(
    (
      trackId: number,
      updates: TrackUpdates
    ) => {
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
    },
    []
  )

  const handleCreatePlaylist = useCallback((name: string, cover?: CoverPick | null) => {
    const id = Date.now()
    setPlaylists((prev) => [
      ...prev,
      {
        id,
        name,
        cover: cover?.coverUrl ?? null,
        coverFile: cover?.coverFile ?? null,
        trackIds: [],
      },
    ])
    return id
  }, [])

  const handleRenamePlaylist = useCallback((id: number, name: string) => {
    setPlaylists((prev) => prev.map((pl) => (pl.id === id ? { ...pl, name } : pl)))
  }, [])

  const handleDeletePlaylist = useCallback(
    (id: number) => {
      setPlaylists((prev) => prev.filter((pl) => pl.id !== id))
      setActivePlaylistId((cur) => {
        if (cur === id) {
          navigate('home')
          return null
        }
        return cur
      })
    },
    [navigate]
  )

  const handleUpdatePlaylist = useCallback(
    (id: number, patch: Partial<Pick<Playlist, 'cover' | 'coverFile' | 'color' | 'banner'>>) => {
      setPlaylists((prev) => prev.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)))
    },
    []
  )

  const handleChangePlaylistCover = useCallback(async (id: number) => {
    try {
      const picked = await pickVisual({ filterName: 'Изображения', purpose: 'cover', maxBytes: COVER_MAX_BYTES })
      if (!picked) return
      const saved = await saveCoverFromBytes(`pl-${id}-${Date.now()}`, picked.bytes, picked.ext)
      if (saved) {
        setPlaylists((prev) =>
          prev.map((pl) =>
            pl.id === id ? { ...pl, cover: saved.coverUrl, coverFile: saved.coverFile } : pl
          )
        )
      }
    } catch (e) {
      console.error('Ошибка выбора обложки:', e)
    }
  }, [])

  const handlePickImage = useCallback(async (): Promise<CoverPick | null> => {
    try {
      const picked = await pickVisual({ filterName: 'Изображения', purpose: 'cover', maxBytes: COVER_MAX_BYTES })
      if (!picked) return null
      return await saveCoverFromBytes(`pl-${Date.now()}`, picked.bytes, picked.ext)
    } catch (e) {
      console.error('Ошибка выбора изображения:', e)
      return null
    }
  }, [])

  /* Картинка для баннера: GIF тоже подходит, поэтому лимит размера выше, чем у обложек */
  const handlePickBanner = useCallback(async (): Promise<CoverPick | null> => {
    try {
      const picked = await pickVisual({ filterName: 'Изображения', purpose: 'banner', maxBytes: BANNER_MAX_BYTES })
      if (!picked) return null
      return await saveCoverFromBytes(`plb-${Date.now()}`, picked.bytes, picked.ext)
    } catch (e) {
      console.error('Ошибка выбора баннера:', e)
      return null
    }
  }, [])

  const handleAddToPlaylist = useCallback((trackIds: number[], playlistId: number) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId
          ? { ...pl, trackIds: Array.from(new Set([...pl.trackIds, ...trackIds])) }
          : pl
      )
    )
  }, [])

  const handleRemoveFromPlaylist = useCallback((playlistId: number, trackIds: number[]) => {
    const set = new Set(trackIds)
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId ? { ...pl, trackIds: pl.trackIds.filter((id) => !set.has(id)) } : pl
      )
    )
  }, [])

  const handleReorderPlaylists = useCallback((fromIndex: number, toIndex: number) => {
    setPlaylists((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const handleOpenPlaylist = useCallback(
    (id: number) => {
      setActivePlaylistId(id)
      navigate('playlist')
    },
    [navigate]
  )

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  )

  return {
    tracks,
    playlists,
    playHistory,
    activePlaylistId,
    activePlaylist,
    isLoadingTracks,
    loadProgress,
    upload,
    cancelUploadRef,
    libraryFolder,
    syncMode,
    isScanning,
    tracksRef,
    playHistoryRef,
    recordPlay,
    loadLibraryData,
    maybeAutoScan,
    addTracksFromPaths,
    handleAddTracks,
    handleToggleLike,
    handleEditTrack,
    handleDeleteTracks,
    handleCreatePlaylist,
    handleRenamePlaylist,
    handleUpdatePlaylist,
    handleDeletePlaylist,
    handleChangePlaylistCover,
    handlePickImage,
    handlePickBanner,
    handleAddToPlaylist,
    handleRemoveFromPlaylist,
    handleReorderPlaylists,
    handleOpenPlaylist,
    handleSelectFolder,
    handleSyncModeChange,
    handleRescan,
    handleClearLibrary,
    relinkTracks,
    relinkChoices,
    resolveRelink,
    handleRelinkAll,
    handleSetCovers,
    handleRemoveFiles,
  }
}