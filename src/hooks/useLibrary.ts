import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { join } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import {
  loadPlayHistory,
  loadPlaylists,
  loadTracksFromConfig,
  parseAudioFiles,
  isAudioFile,
  saveCoverFromFile,
  savePlayHistory,
  savePlaylists,
  saveTracksToConfig,
} from '../lib/trackLoader'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import type { CoverPick, Playlist, Track, ViewType } from '../App'

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

interface UseLibraryOptions {
  navigate: (view: ViewType) => void
  onTracksDeleted: (ids: number[]) => void
  onLibraryCleared: () => void
}

async function collectAudioFiles(dir: string): Promise<string[]> {
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

    }
  }
  await walk(dir)
  return out
}

export default function useLibrary({
  navigate,
  onTracksDeleted,
  onLibraryCleared,
}: UseLibraryOptions) {
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
  }, [])

  const addTracksFromPaths = useCallback(async (paths: string[]) => {
    cancelUploadRef.current = false
    const names = paths.map((p) => ({ name: p.split(/[\\/]/).pop() || p }))
    setUpload({ files: names, total: paths.length, current: 0, fileName: '', finished: false })
    const existing = new Set(tracksRef.current.map((t) => t.filePath))
    await parseAudioFiles(paths, {
      existingPaths: existing,
      shouldStop: () => cancelUploadRef.current,
      onProgress: (p) =>
        setUpload((u) => (u ? { ...u, current: p.current, fileName: p.fileName } : u)),
      onTrack: (track) => setTracks((prev) => [...prev, track]),
    })
    if (cancelUploadRef.current) {
      setUpload(null)
    } else {
      setUpload((u) => (u ? { ...u, finished: true, current: u.total } : u))
      setTimeout(() => setUpload(null), 700)
    }
  }, [])

  const handleAddTracks = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Аудио',
            extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'wma'],
          },
        ],
      })
      if (!selected) return
      await addTracksFromPaths(Array.isArray(selected) ? selected : [selected])
    } catch (e) {
      console.error('Ошибка диалога:', e)
    }
  }, [addTracksFromPaths])

  const scanFolder = useCallback(
    async (folder?: string) => {
      const dir = folder || libraryFolderRef.current
      if (!dir || isScanningRef.current) return
      isScanningRef.current = true
      setIsScanning(true)
      try {
        const files = await collectAudioFiles(dir)
        const existing = new Set(tracksRef.current.map((t) => t.filePath))
        const fresh = files.filter((f) => !existing.has(f))
        if (fresh.length > 0) await addTracksFromPaths(fresh)
      } catch (e) {
        console.error('Ошибка сканирования папки:', e)
      }
      isScanningRef.current = false
      setIsScanning(false)
    },
    [addTracksFromPaths]
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

  const handleClearLibrary = useCallback(() => {
    setTracks([])
    setPlaylists([])
    setPlayHistory({})
    playHistoryRef.current = {}
    setActivePlaylistId(null)
    saveTracksToConfig([])
    savePlaylists([])
    savePlayHistory({})
    onLibraryCleared()
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
      updates: {
        title?: string
        artist?: string
        cover?: string | null
        coverFile?: string | null
        playbackRate?: number
      }
    ) => {
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
    },
    []
  )

  const handleDeleteTracks = useCallback(
    (ids: number[]) => {
      const idSet = new Set(ids)
      setTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
      setPlaylists((prev) =>
        prev.map((pl) => ({ ...pl, trackIds: pl.trackIds.filter((id) => !idSet.has(id)) }))
      )
      onTracksDeleted(ids)
    },
    [onTracksDeleted]
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
    (id: number, patch: Partial<Pick<Playlist, 'cover' | 'coverFile' | 'color'>>) => {
      setPlaylists((prev) => prev.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)))
    },
    []
  )

  const handleChangePlaylistCover = useCallback(async (id: number) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      })
      if (!selected || Array.isArray(selected)) return
      const saved = await saveCoverFromFile(`pl-${id}`, selected)
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
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      })
      if (!selected || Array.isArray(selected)) return null
      return await saveCoverFromFile(`pl-${Date.now()}`, selected)
    } catch (e) {
      console.error('Ошибка выбора изображения:', e)
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
    handleAddToPlaylist,
    handleRemoveFromPlaylist,
    handleReorderPlaylists,
    handleOpenPlaylist,
    handleSelectFolder,
    handleSyncModeChange,
    handleRescan,
    handleClearLibrary,
  }
}