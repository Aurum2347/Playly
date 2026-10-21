import {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile, readFile, mkdir } from '@tauri-apps/plugin-fs'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/layout/Sidebar'
import PlayerBar from './components/layout/PlayerBar'
import HomeView from './components/views/HomeView'
import SettingsView from './components/views/SettingsView'
import TracksView from './components/views/TracksView'
import LikedView from './components/views/LikedView'
import PlaylistView from './components/views/PlaylistView'
import Onboarding from './components/Onboarding'
import Logo from './components/Logo'
import useLibrary from './hooks/useLibrary'
import { loadSettings, saveSettings, isAudioFile } from './lib/trackLoader'
import { I18nProvider, useI18n } from './i18n'
import './App.css'

export type ViewType = 'home' | 'settings' | 'tracks' | 'liked' | 'playlist'

export interface Track {
  id: number
  title: string
  artist: string
  album: string
  genre: string
  duration: string
  liked: boolean
  likedAt?: number
  cover?: string | null
  coverFile?: string | null
  filePath: string
  addedAt: number
  fileModifiedAt: number
  playbackRate?: number
}

export interface Playlist {
  id: number
  name: string
  cover?: string | null
  coverFile?: string | null
  /* Цвет фона шапки плейлиста (#rrggbb), null — стандартный */
  color?: string | null
  trackIds: number[]
}

export interface CoverPick {
  coverUrl: string
  coverFile: string
}

export type RepeatMode = 'off' | 'all' | 'one'

type AvatarShape = 'circle' | 'square'

function audioMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'ogg':
    case 'opus':
      return 'audio/ogg'
    case 'm4a':
    case 'aac':
      return 'audio/mp4'
    case 'wma':
      return 'audio/x-ms-wma'
    default:
      return 'application/octet-stream'
  }
}

function imageMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

const SidebarM = memo(Sidebar)
const HomeViewM = memo(HomeView)
const SettingsViewM = memo(SettingsView)
const TracksViewM = memo(TracksView)
const LikedViewM = memo(LikedView)
const PlaylistViewM = memo(PlaylistView)

function AppInner() {
  const { t } = useI18n()
  const [appState, setAppState] = useState<'splash' | 'onboarding' | 'main'>('splash')
  const [userNickname, setUserNickname] = useState('Aurum2347')
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [avatarShape, setAvatarShape] = useState<AvatarShape>('circle')
  const [currentView, setCurrentView] = useState<ViewType>('home')
  const [isMaximized, setIsMaximized] = useState(false)
  const [queue, setQueue] = useState<number[]>([])
  const [queueIndex, setQueueIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(100)
  const [isMuted, setIsMuted] = useState(false)
  const [isShuffle, setIsShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off')
  const [crossfade, setCrossfade] = useState(0)
  const [outputDevice, setOutputDevice] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playersRef = useRef<HTMLAudioElement[]>([])
  const gainsRef = useRef<GainNode[]>([])
  const masterGainRef = useRef<GainNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const activeIndexRef = useRef(0)
  const objectUrlsRef = useRef<(string | null)[]>([null, null])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const crossfadingRef = useRef(false)
  const crossfadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCrossfadeRef = useRef<{ nextIdx: number } | null>(null)
  const skipLoadRef = useRef(false)
  const pendingPlayRef = useRef(false)
  const userAvatarUrlRef = useRef<string | null>(null)
  const historyRef = useRef<number[]>([])
  const queueRef = useRef<number[]>([])
  const queueIndexRef = useRef(-1)
  const repeatRef = useRef<RepeatMode>('off')
  const shuffleRef = useRef(false)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(100)
  const mutedRef = useRef(false)
  const crossfadeRef = useRef(0)
  const outputDeviceRef = useRef('')
  const crossfadeAbortedForTrackRef = useRef<number | null>(null)

  const {
    tracks,
    playlists,
    playHistory,
    activePlaylist,
    loadProgress,
    upload,
    cancelUploadRef,
    tracksRef,
    recordPlay,
    loadLibraryData,
    maybeAutoScan,
    addTracksFromPaths,
    handleAddTracks,
    handleToggleLike,
    handleEditTrack: libraryEditTrack,
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
    libraryFolder,
    syncMode,
    isScanning,
    handleSelectFolder,
    handleSyncModeChange,
    handleRescan,
    handleClearLibrary,
  } = useLibrary({
    navigate: (v) => setCurrentView(v),
    onTracksDeleted: (ids) => {
      const idSet = new Set(ids)
      const curId = queueRef.current[queueIndexRef.current]
      const newQueue = queueRef.current.filter((id) => !idSet.has(id))
      if (curId !== undefined && idSet.has(curId)) {
        if (newQueue.length > 0) {
          setQueue(newQueue)
          setQueueIndex(Math.min(queueIndexRef.current, newQueue.length - 1))
          pendingPlayRef.current = true
        } else {
          setQueue([])
          setQueueIndex(-1)
          playersRef.current.forEach((p) => p?.pause())
          setIsPlaying(false)
        }
      } else {
        setQueue(newQueue)
        if (curId !== undefined) setQueueIndex(Math.max(0, newQueue.indexOf(curId)))
      }
    },
    onLibraryCleared: () => {
      setQueue([])
      setQueueIndex(-1)
      playersRef.current.forEach((p) => p?.pause())
      setCurrentTime(0)
      setDuration(0)
      setIsPlaying(false)
    },
  })

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    queueIndexRef.current = queueIndex
  }, [queueIndex])

  useEffect(() => {
    repeatRef.current = repeatMode
  }, [repeatMode])

  useEffect(() => {
    shuffleRef.current = isShuffle
  }, [isShuffle])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => {
    mutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    crossfadeRef.current = crossfade
  }, [crossfade])

  useEffect(() => {
    outputDeviceRef.current = outputDevice
  }, [outputDevice])

  const appWindow = getCurrentWindow()

  const selectedTrack = useMemo(() => {
    if (queueIndex < 0 || queueIndex >= queue.length) return null
    const id = queue[queueIndex]
    return tracks.find((t) => t.id === id) ?? null
  }, [queue, queueIndex, tracks])

  const applyOutputDevice = useCallback(async (deviceId: string) => {
    for (const p of playersRef.current) {
      if (!p) continue
      const withSink = p as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      if (typeof withSink.setSinkId === 'function') {
        try {
          await withSink.setSinkId(deviceId || 'default')
        } catch (e) {
          console.warn('Не удалось применить устройство вывода:', e)
        }
      }
    }
  }, [])

  const applyMasterGain = useCallback(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = mutedRef.current ? 0 : volumeRef.current / 100
    }
  }, [])

  const computeNextIndex = useCallback((): number | null => {
    const q = queueRef.current
    const idx = queueIndexRef.current
    if (q.length === 0) return null
    if (shuffleRef.current) {
      if (q.length === 1) return null
      let n: number
      do {
        n = Math.floor(Math.random() * q.length)
      } while (n === idx)
      return n
    }
    let n = idx + 1
    if (n >= q.length) {
      if (repeatRef.current === 'all') n = 0
      else return null
    }
    return n
  }, [])

  const finishCrossfade = useCallback(() => {
    console.log('[CF] finishCrossfade вызван')
    const pend = pendingCrossfadeRef.current
    pendingCrossfadeRef.current = null
    crossfadingRef.current = false
    if (!pend) {
      console.log('[CF] finishCrossfade: нет ожидающего перехода, выходим')
      return
    }
    console.log('[CF] finishCrossfade: завершаем переход на индекс', pend.nextIdx)
    const ctx = audioCtxRef.current
    const ai = activeIndexRef.current
    const oi = 1 - ai
    const oldPlayer = playersRef.current[ai]
    const newPlayer = playersRef.current[oi]
    if (!oldPlayer || !newPlayer) {
      console.log('[CF] finishCrossfade: старый или новый плеер не найден')
      return
    }
    activeIndexRef.current = oi
    audioRef.current = newPlayer
    oldPlayer.pause()
    console.log('[CF] finishCrossfade: активный индекс теперь', oi)
    if (ctx && gainsRef.current[oi] && gainsRef.current[ai]) {
      gainsRef.current[oi].gain.cancelScheduledValues(ctx.currentTime)
      gainsRef.current[oi].gain.value = 1
      gainsRef.current[ai].gain.cancelScheduledValues(ctx.currentTime)
      gainsRef.current[ai].gain.value = 0
      console.log('[CF] finishCrossfade: громкости переключены')
    }
    setCurrentTime(newPlayer.currentTime || 0)
    setDuration(isFinite(newPlayer.duration) ? newPlayer.duration : 0)
    setIsPlaying(true)
    newPlayer.play().catch(() => {})
    console.log('[CF] finishCrossfade: новый плеер запущен')
    historyRef.current.push(queueIndexRef.current)
    if (historyRef.current.length > 50) historyRef.current.shift()
    skipLoadRef.current = true
    setQueueIndex(pend.nextIdx)
    const nextId = queueRef.current[pend.nextIdx]
    if (nextId !== undefined) recordPlay(nextId)
    console.log('[CF] finishCrossfade: завершён')
  }, [recordPlay])

  /* ===== Старт кроссфейда ===== */
  const startCrossfade = useCallback(async () => {
    console.log('[CF] startCrossfade вызван')
    if (crossfadingRef.current) {
      console.log('[CF] startCrossfade: уже идёт кроссфейд, выходим')
      return
    }
    if (repeatRef.current === 'one') {
      console.log('[CF] startCrossfade: repeat = one, выходим')
      return
    }
    const currentTrackId = queueRef.current[queueIndexRef.current]
    if (crossfadeAbortedForTrackRef.current === currentTrackId) {
      console.log('[CF] startCrossfade: кроссфейд уже отменяли для этого трека, выходим')
      return
    }
    const nextIdx = computeNextIndex()
    if (nextIdx === null) {
      console.log('[CF] startCrossfade: нет следующего индекса, выходим')
      return
    }
    const nextId = queueRef.current[nextIdx]
    const nextTrack = tracksRef.current.find((t) => t.id === nextId)
    if (!nextTrack) {
      console.log('[CF] startCrossfade: не найден следующий трек', nextId)
      return
    }
    console.log('[CF] startCrossfade: следующий трек', nextTrack.title, 'id', nextId)
    const ctx = audioCtxRef.current
    const ai = activeIndexRef.current
    const oi = 1 - ai
    const incoming = playersRef.current[oi]
    const gIn = gainsRef.current[oi]
    const gOut = gainsRef.current[ai]
    if (!ctx || !incoming || !gIn || !gOut) {
      console.log('[CF] startCrossfade: недостаточно данных', {
        ctx: !!ctx,
        incoming: !!incoming,
        gIn: !!gIn,
        gOut: !!gOut,
      })
      return
    }
    const cf = crossfadeRef.current
    crossfadingRef.current = true
    pendingCrossfadeRef.current = { nextIdx }
    try {
      await ctx.resume().catch(() => {})
      if (!crossfadingRef.current) return
      const bytes = await readFile(nextTrack.filePath)
      if (!crossfadingRef.current) return
      const oldUrl = objectUrlsRef.current[oi]
      if (oldUrl) URL.revokeObjectURL(oldUrl)
      const url = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], { type: audioMime(nextTrack.filePath) })
      )
      objectUrlsRef.current[oi] = url
      incoming.src = url
      incoming.playbackRate = nextTrack.playbackRate ?? 1
      const now = ctx.currentTime
      gIn.gain.cancelScheduledValues(now)
      gIn.gain.setValueAtTime(0, now)
      gOut.gain.cancelScheduledValues(now)
      gOut.gain.setValueAtTime(gOut.gain.value, now)
      await incoming.play()
      if (!crossfadingRef.current) {
        incoming.pause()
        return
      }
      gIn.gain.linearRampToValueAtTime(1, now + cf)
      gOut.gain.linearRampToValueAtTime(0.0001, now + cf)
      console.log('[CF] startCrossfade: начато затухание на', cf, 'сек')
      if (crossfadeTimerRef.current) clearTimeout(crossfadeTimerRef.current)
      crossfadeTimerRef.current = setTimeout(() => {
        finishCrossfade()
      }, cf * 1000)
    } catch (e) {
      console.error('[CF] startCrossfade: Ошибка:', e)
      crossfadingRef.current = false
      pendingCrossfadeRef.current = null
      const now = ctx.currentTime
      gOut.gain.cancelScheduledValues(now)
      gOut.gain.setValueAtTime(gOut.gain.value, now)
      gIn.gain.cancelScheduledValues(now)
      gIn.gain.setValueAtTime(0, now)
      incoming.pause()
      incoming.removeAttribute('src')
      incoming.load()
      const oldUrl = objectUrlsRef.current[oi]
      if (oldUrl) URL.revokeObjectURL(oldUrl)
      objectUrlsRef.current[oi] = null
    }
  }, [computeNextIndex, finishCrossfade, tracksRef])

  const abortCrossfade = useCallback(() => {
    console.log('[CF] abortCrossfade вызван, crossfadingRef.current =', crossfadingRef.current)
    if (!crossfadingRef.current) {
      console.log('[CF] abortCrossfade: кроссфейд уже не активен, выходим')
      return
    }
    crossfadingRef.current = false
    pendingCrossfadeRef.current = null
    if (crossfadeTimerRef.current) {
      clearTimeout(crossfadeTimerRef.current)
      crossfadeTimerRef.current = null
    }
    const activeTrackId = queueRef.current[queueIndexRef.current]
    if (activeTrackId !== undefined) {
      crossfadeAbortedForTrackRef.current = activeTrackId
    }
    const ctx = audioCtxRef.current
    const ai = activeIndexRef.current
    const oi = 1 - ai
    const incoming = playersRef.current[oi]
    if (incoming) {
      incoming.pause()
      incoming.currentTime = 0
    }
    const oldUrl = objectUrlsRef.current[oi]
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl)
      objectUrlsRef.current[oi] = null
    }
    if (incoming) {
      incoming.removeAttribute('src')
      incoming.load()
    }
    if (ctx && gainsRef.current[oi] && gainsRef.current[ai]) {
      const now = ctx.currentTime
      gainsRef.current[oi].gain.cancelScheduledValues(now)
      gainsRef.current[oi].gain.setValueAtTime(0, now)
      gainsRef.current[ai].gain.cancelScheduledValues(now)
      gainsRef.current[ai].gain.setValueAtTime(1, now)
    }
    console.log('[CF] abortCrossfade завершён')
  }, [])

  useEffect(() => {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const master = ctx.createGain()
    master.gain.value = mutedRef.current ? 0 : volumeRef.current / 100
    master.connect(ctx.destination)
    masterGainRef.current = master

    const players: HTMLAudioElement[] = []
    const gains: GainNode[] = []
    for (let i = 0; i < 2; i++) {
      const a = new Audio()
      const src = ctx.createMediaElementSource(a)
      const g = ctx.createGain()
      g.gain.value = i === 0 ? 1 : 0
      src.connect(g)
      g.connect(master)
      players.push(a)
      gains.push(g)
    }
    playersRef.current = players
    gainsRef.current = gains
    activeIndexRef.current = 0
    audioRef.current = players[0]

    const makeHandlers = (i: number) => {
      const a = players[i]
      const onTime = () => {
        if (playersRef.current[i] !== audioRef.current) return
        setCurrentTime(a.currentTime)
        const cf = crossfadeRef.current
        if (cf > 0 && !crossfadingRef.current && repeatRef.current !== 'one' && isPlayingRef.current) {
          const currentTrackId = queueRef.current[queueIndexRef.current]
          if (crossfadeAbortedForTrackRef.current === currentTrackId) return
          const dur = a.duration
          const cur = a.currentTime
          if (isFinite(dur) && dur > cf) {
            const remaining = dur - cur
            if (remaining > 0.05 && remaining <= cf) {
              startCrossfade()
            }
          }
        }
      }
      const onMeta = () => {
        if (playersRef.current[i] !== audioRef.current) return
        setDuration(a.duration)
      }
      const onPlay = () => {
        if (playersRef.current[i] !== audioRef.current) return
        setIsPlaying(true)
      }
      const onPause = () => {
        if (playersRef.current[i] !== audioRef.current) return
        setIsPlaying(false)
      }
      const onEnded = () => {
        if (playersRef.current[i] !== audioRef.current) return
        if (crossfadingRef.current) return
        if (pendingCrossfadeRef.current) return
        const q = queueRef.current
        const idx = queueIndexRef.current
        const mode = repeatRef.current
        if (mode === 'one') {
          a.currentTime = 0
          a.play().catch(() => {})
          return
        }
        if (q.length === 0) return
        let next: number
        if (shuffleRef.current) {
          if (q.length === 1) return
          do {
            next = Math.floor(Math.random() * q.length)
          } while (next === idx)
        } else {
          next = idx + 1
          if (next >= q.length) {
            if (mode === 'all') {
              next = 0
            } else {
              setIsPlaying(false)
              return
            }
          }
        }
        historyRef.current.push(idx)
        if (historyRef.current.length > 50) historyRef.current.shift()
        pendingPlayRef.current = true
        setQueueIndex(next)
      }
      a.addEventListener('timeupdate', onTime)
      a.addEventListener('loadedmetadata', onMeta)
      a.addEventListener('play', onPlay)
      a.addEventListener('pause', onPause)
      a.addEventListener('ended', onEnded)
      return () => {
        a.removeEventListener('timeupdate', onTime)
        a.removeEventListener('loadedmetadata', onMeta)
        a.removeEventListener('play', onPlay)
        a.removeEventListener('pause', onPause)
        a.removeEventListener('ended', onEnded)
      }
    }
    const cleanups = [makeHandlers(0), makeHandlers(1)]
    return () => {
      cleanups.forEach((fn) => fn?.())
      players.forEach((p) => p.pause())
      objectUrlsRef.current.forEach((u) => {
        if (u) URL.revokeObjectURL(u)
      })
      objectUrlsRef.current = [null, null]
      ctx.close().catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false
      crossfadeAbortedForTrackRef.current = null
      return
    }
    crossfadeAbortedForTrackRef.current = null
    const audio = audioRef.current
    if (!audio) return
    crossfadingRef.current = false
    pendingCrossfadeRef.current = null
    if (crossfadeTimerRef.current) clearTimeout(crossfadeTimerRef.current)
    const ai = activeIndexRef.current
    playersRef.current.forEach((p, idx) => {
      if (idx !== ai) p.pause()
    })
    if (gainsRef.current[ai]) gainsRef.current[ai].gain.value = 1
    if (gainsRef.current[1 - ai]) gainsRef.current[1 - ai].gain.value = 0
    if (!selectedTrack) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      const oldUrl = objectUrlsRef.current[ai]
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl)
        objectUrlsRef.current[ai] = null
      }
      setCurrentTime(0)
      setDuration(0)
      return
    }
    const trackId = selectedTrack.id
    const filePath = selectedTrack.filePath
    let cancelled = false
    setCurrentTime(0)
    setDuration(0)
    setSeekTick((v) => v + 1)
    ;(async () => {
      try {
        const bytes = await readFile(filePath)
        if (cancelled) return
        const oldUrl = objectUrlsRef.current[ai]
        if (oldUrl) URL.revokeObjectURL(oldUrl)
        const url = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: audioMime(filePath) })
        )
        objectUrlsRef.current[ai] = url
        audio.src = url
        audio.playbackRate = selectedTrack.playbackRate ?? 1
        audio.load()
        if (pendingPlayRef.current) {
          pendingPlayRef.current = false
          audioCtxRef.current?.resume().catch(() => {})
          audio.play().catch((e) => {
            console.warn('Не удалось воспроизвести:', e)
            setIsPlaying(false)
          })
        }
      } catch (e) {
        console.error(`Не удалось прочитать трек (id ${trackId}):`, e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedTrack?.id])

  const scheduleSettingsSave = useCallback(
    (patch: {
      volume?: number
      isMuted?: boolean
      crossfade?: number
      outputDevice?: string
      discordRpc?: boolean
    }) => {
      if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current)
      settingsSaveTimerRef.current = setTimeout(() => {
        saveSettings(patch).catch((e) => console.error('Не удалось сохранить настройки:', e))
      }, 250)
    },
    []
  )

  const handleCrossfadeChange = useCallback(
    (sec: number) => {
      const v = Math.max(0, Math.min(12, Math.round(sec)))
      setCrossfade(v)
      crossfadeRef.current = v
      scheduleSettingsSave({ crossfade: v })
    },
    [scheduleSettingsSave]
  )

  const handleOutputDeviceChange = useCallback(
    (id: string) => {
      setOutputDevice(id)
      outputDeviceRef.current = id
      applyOutputDevice(id)
      scheduleSettingsSave({ outputDevice: id })
    },
    [applyOutputDevice, scheduleSettingsSave]
  )

  const [discordRpc, setDiscordRpc] = useState(true)
  const [seekTick, setSeekTick] = useState(0)

  const handleDiscordRpcChange = useCallback(
    (v: boolean) => {
      setDiscordRpc(v)
      scheduleSettingsSave({ discordRpc: v })
      if (!v) {
        invoke('discord_clear_presence').catch(() => {})
      }
    },
    [scheduleSettingsSave]
  )

  useEffect(() => {
    if (!discordRpc) {
      invoke('discord_clear_presence').catch(() => {})
      return
    }
    if (selectedTrack) {
      const artist = selectedTrack.artist || '—'
      invoke('discord_update_presence', {
        title: selectedTrack.title,
        artist,
        durationSecs: Math.max(1, Math.round(duration)),
        isPlaying,
        positionSecs: Math.max(0, Math.round(currentTime)),
        status: isPlaying
          ? `${t('discord.author')}: ${artist}`
          : `${t('discord.author')}: ${artist} · ${t('discord.pause')}`,
        searchLabel: t('discord.search'),
      }).catch(() => {})
    } else {
      invoke('discord_idle_presence', {
        details: t('discord.idleTitle'),
        status: t('discord.idleState'),
      }).catch(() => {})
    }
  }, [discordRpc, isPlaying, selectedTrack?.id, duration, seekTick, t])

  const loadProfile = useCallback(async () => {
    try {
      const appDir = await appDataDir()
      const playlyDir = await join(appDir, 'playly')
      const profileDir = await join(playlyDir, 'profile')
      const profileFile = await join(profileDir, 'profile.json')
      if (!(await exists(profileFile))) {
        if (userAvatarUrlRef.current) {
          URL.revokeObjectURL(userAvatarUrlRef.current)
          userAvatarUrlRef.current = null
        }
        setUserAvatar(null)
        setAvatarShape('circle')
        return
      }
      const raw = await readTextFile(profileFile)
      const data = JSON.parse(raw) as { avatarFile?: string; avatarShape?: AvatarShape }
      setAvatarShape(data.avatarShape === 'square' ? 'square' : 'circle')
      let nextUrl: string | null = null
      if (data.avatarFile) {
        const filePath =
          data.avatarFile.includes('/') || data.avatarFile.includes('\\')
            ? data.avatarFile
            : await join(profileDir, data.avatarFile)
        if (await exists(filePath)) {
          const bytes = await readFile(filePath)
          nextUrl = URL.createObjectURL(
            new Blob([bytes as unknown as BlobPart], { type: imageMime(filePath) })
          )
        }
      }
      if (userAvatarUrlRef.current && userAvatarUrlRef.current !== nextUrl) {
        URL.revokeObjectURL(userAvatarUrlRef.current)
      }
      userAvatarUrlRef.current = nextUrl
      setUserAvatar(nextUrl)
    } catch (e) {
      console.error('Ошибка загрузки профиля:', e)
    }
  }, [])

  useEffect(() => {
    loadProfile()
    window.addEventListener('playly-profile-updated', loadProfile)
    return () => {
      window.removeEventListener('playly-profile-updated', loadProfile)
      if (userAvatarUrlRef.current) {
        URL.revokeObjectURL(userAvatarUrlRef.current)
        userAvatarUrlRef.current = null
      }
    }
  }, [loadProfile])

  useEffect(() => {
    const init = async () => {
      const startTime = Date.now()
      try {
        const appDir = await appDataDir()
        const playlyDir = await join(appDir, 'playly')
        const userFile = await join(playlyDir, 'user.json')
        const settings = await loadSettings()
        setVolume(settings.volume)
        setIsMuted(settings.isMuted)
        setCrossfade(settings.crossfade ?? 0)
        setOutputDevice(settings.outputDevice ?? '')
        volumeRef.current = settings.volume
        mutedRef.current = settings.isMuted
        crossfadeRef.current = settings.crossfade ?? 0
        outputDeviceRef.current = settings.outputDevice ?? ''
        applyMasterGain()
        if (settings.outputDevice) {
          await applyOutputDevice(settings.outputDevice)
        }
        const settingsFile = await join(playlyDir, 'settings.json')
        if (await exists(settingsFile)) {
          try {
            const raw = JSON.parse(await readTextFile(settingsFile)) as Record<string, unknown>
            if (raw.discordRpc === false) setDiscordRpc(false)
          } catch {
          }
        }
        if (await exists(userFile)) {
          const data = JSON.parse(await readTextFile(userFile))
          setUserNickname(data.nickname || 'Aurum2347')
          await loadLibraryData()
          maybeAutoScan()
          const remaining = Math.max(0, 2500 - (Date.now() - startTime))
          setTimeout(() => setAppState('main'), remaining)
        } else {
          const remaining = Math.max(0, 2500 - (Date.now() - startTime))
          setTimeout(() => setAppState('onboarding'), remaining)
        }
      } catch (error) {
        console.error('Ошибка запуска:', error)
        setTimeout(() => setAppState('onboarding'), 500)
      }
    }
    init()
  }, [applyMasterGain, applyOutputDevice, loadLibraryData, maybeAutoScan])

  useEffect(() => {
    const unHover = listen<string[]>('tauri://file-drop-hover', () => setIsDragging(true))
    const unCancel = listen('tauri://file-drop-cancelled', () => setIsDragging(false))
    const unDrop = listen<string[]>('tauri://file-drop', async (event) => {
      setIsDragging(false)
      const paths = (event.payload || []).filter((p) => isAudioFile(p))
      if (paths.length > 0) await addTracksFromPaths(paths)
    })
    return () => {
      unHover.then((f) => f())
      unCancel.then((f) => f())
      unDrop.then((f) => f())
    }
  }, [])

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('.track-row') ||
        target.closest('.player') ||
        target.closest('.confirm-overlay') ||
        target.closest('.modal')
      ) {
        return
      }
      if (currentView === 'tracks' || currentView === 'liked' || currentView === 'playlist') {
        return
      }
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [currentView])

  const handleCopyTitle = useCallback(
    async (trackId: number) => {
      const tr = tracks.find((x) => x.id === trackId)
      if (tr) await navigator.clipboard.writeText(tr.title)
    },
    [tracks]
  )

  const handleCopyArtist = useCallback(
    async (trackId: number) => {
      const tr = tracks.find((x) => x.id === trackId)
      if (tr) await navigator.clipboard.writeText(tr.artist)
    },
    [tracks]
  )

  const handleCopyTitleArtist = useCallback(
    async (trackId: number) => {
      const tr = tracks.find((x) => x.id === trackId)
      if (tr) await navigator.clipboard.writeText(`${tr.title} — ${tr.artist}`)
    },
    [tracks]
  )

  const handleCopyPath = useCallback(
    async (trackId: number) => {
      const tr = tracks.find((x) => x.id === trackId)
      if (tr) await navigator.clipboard.writeText(tr.filePath)
    },
    [tracks]
  )

  const handleRevealInDir = useCallback(
    async (trackId: number) => {
      const tr = tracks.find((x) => x.id === trackId)
      if (!tr) return
      try {
        await invoke('reveal_item_in_dir', { path: tr.filePath })
      } catch (e) {
        console.error('Не удалось открыть папку:', e)
      }
    },
    [tracks]
  )

  const handleTrackSelect = useCallback(
    (track: Track, ctx?: Track[]) => {
      let ids: number[]
      if (ctx && ctx.length > 0) {
        ids = ctx.map((t) => t.id)
      } else if (queueRef.current.length > 0 && queueRef.current.includes(track.id)) {
        ids = queueRef.current
      } else {
        ids = tracksRef.current.map((t) => t.id)
      }
      const idx = ids.indexOf(track.id)
      if (idx < 0) return
      setQueue(ids)
      setQueueIndex(idx)
      historyRef.current = []
      pendingPlayRef.current = true
      recordPlay(track.id)
    },
    [recordPlay, tracksRef]
  )

  /* ===== Плеер ===== */
  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    if (isPlayingRef.current) {
      abortCrossfade()
      audio.pause()
      audioCtxRef.current?.suspend().catch(() => {})
      setIsPlaying(false)
    } else {
      audioCtxRef.current?.resume().catch(() => {})
      audio.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [abortCrossfade])

  const handleNext = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) return
    let next: number
    if (shuffleRef.current) {
      if (q.length === 1) return
      do {
        next = Math.floor(Math.random() * q.length)
      } while (next === queueIndexRef.current)
    } else {
      next = queueIndexRef.current + 1
      if (next >= q.length) {
        if (repeatRef.current === 'all') {
          next = 0
        } else {
          return
        }
      }
    }
    historyRef.current.push(queueIndexRef.current)
    if (historyRef.current.length > 50) historyRef.current.shift()
    pendingPlayRef.current = true
    setQueueIndex(next)
  }, [])

  const handlePrev = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const q = queueRef.current
    if (q.length === 0) return
    if (historyRef.current.length > 0) {
      const prev = historyRef.current.pop() as number
      pendingPlayRef.current = true
      setQueueIndex(prev)
      return
    }
    if (!shuffleRef.current) {
      pendingPlayRef.current = true
      setQueueIndex((queueIndexRef.current - 1 + q.length) % q.length)
    }
  }, [])

  const handleSeek = useCallback(
    (time: number) => {
      abortCrossfade()
      if (audioRef.current) audioRef.current.currentTime = time
      setCurrentTime(time)
      setSeekTick((v) => v + 1)
    },
    [abortCrossfade]
  )

  const handleVolumeChange = useCallback(
    (p: number) => {
      const v = Math.max(0, Math.min(100, Math.round(p)))
      setVolume(v)
      volumeRef.current = v
      if (v > 0 && mutedRef.current) {
        mutedRef.current = false
        setIsMuted(false)
      }
      applyMasterGain()
      scheduleSettingsSave({ volume: v, isMuted: mutedRef.current })
    },
    [applyMasterGain, scheduleSettingsSave]
  )

  const handleMuteToggle = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setIsMuted(next)
    applyMasterGain()
    scheduleSettingsSave({ volume: volumeRef.current, isMuted: next })
  }, [applyMasterGain, scheduleSettingsSave])

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
      libraryEditTrack(trackId, updates)
      if (typeof updates.playbackRate === 'number') {
        const rate = updates.playbackRate
        playersRef.current.forEach((p) => {
          if (p) p.playbackRate = rate
        })
      }
    },
    [libraryEditTrack]
  )

  const handleMaximize = useCallback(async () => {
    await appWindow.toggleMaximize()
    setIsMaximized((v) => !v)
  }, [appWindow])

  const handleTitleBarDoubleClick = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('.control-btn')) return
    handleMaximize()
  }

  const handleSaveNickname = useCallback(async (newNickname: string) => {
    setUserNickname(newNickname)
    try {
      const appDir = await appDataDir()
      const playlyDir = await join(appDir, 'playly')
      const userFile = await join(playlyDir, 'user.json')
      await mkdir(playlyDir, { recursive: true })
      let data: Record<string, unknown> = {}
      if (await exists(userFile)) {
        try {
          data = JSON.parse(await readTextFile(userFile)) as Record<string, unknown>
        } catch {
          data = {}
        }
      }
      await writeTextFile(userFile, JSON.stringify({ ...data, nickname: newNickname }, null, 2))
    } catch (error) {
      console.error('Ошибка сохранения никнейма:', error)
    }
  }, [])
  const currentTimeRef = useRef(0)
  const durationRef = useRef(0)
  const selectedTrackRef = useRef<Track | null>(null)

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  useEffect(() => {
    selectedTrackRef.current = selectedTrack
  }, [selectedTrack])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const track = selectedTrackRef.current

      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.code === 'ArrowRight' && track) {
          e.preventDefault()
          handleNext()
        } else if (e.code === 'ArrowLeft' && track) {
          e.preventDefault()
          handlePrev()
        }
        return
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return

      switch (e.code) {
        case 'Space':
          if (track) {
            e.preventDefault()
            handlePlayPause()
          }
          break
        case 'ArrowRight':
          if (track && durationRef.current > 0) {
            e.preventDefault()
            handleSeek(Math.min(durationRef.current, currentTimeRef.current + 5))
          }
          break
        case 'ArrowLeft':
          if (track) {
            e.preventDefault()
            handleSeek(Math.max(0, currentTimeRef.current - 5))
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          handleVolumeChange(volumeRef.current + 5)
          break
        case 'ArrowDown':
          e.preventDefault()
          handleVolumeChange(volumeRef.current - 5)
          break
        case 'KeyM':
          handleMuteToggle()
          break
        case 'KeyL':
          if (track) handleToggleLike(track.id, !track.liked)
          break
      }
    }
    const onDragStart = (e: DragEvent) => e.preventDefault()
    window.addEventListener('keydown', onKey)
    document.addEventListener('dragstart', onDragStart)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('dragstart', onDragStart)
    }
  }, [handlePlayPause, handleNext, handlePrev, handleSeek, handleVolumeChange, handleMuteToggle, handleToggleLike])
  
  /* Стабильная ссылка: иначе memo(LikedView) перерисовывается на каждом тике плеера */
  const likedTracks = useMemo(() => tracks.filter((t) => t.liked), [tracks])

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return (
          <HomeViewM
            tracks={tracks}
            nickname={userNickname}
            onSelectTrack={handleTrackSelect}
            lastPlayed={selectedTrack}
            playHistory={playHistory}
            playingTrackId={selectedTrack?.id ?? null}
            isPlaying={isPlaying}
            onPlayToggle={handlePlayPause}
          />
        )
      case 'settings':
        return (
          <SettingsViewM
            currentNickname={userNickname}
            onSaveNickname={handleSaveNickname}
            crossfade={crossfade}
            onChangeCrossfade={handleCrossfadeChange}
            outputDevice={outputDevice}
            onChangeOutputDevice={handleOutputDeviceChange}
            libraryFolder={libraryFolder}
            syncMode={syncMode}
            isScanning={isScanning}
            onSelectFolder={handleSelectFolder}
            onChangeSyncMode={handleSyncModeChange}
            onRescan={handleRescan}
            onClearLibrary={handleClearLibrary}
            discordRpc={discordRpc}
            onChangeDiscordRpc={handleDiscordRpcChange}
          />
        )
      case 'tracks':
        return (
          <TracksViewM
            tracks={tracks}
            playlists={playlists}
            onSelectTrack={handleTrackSelect}
            playingTrackId={selectedTrack?.id ?? null}
            onToggleLike={handleToggleLike}
            onDeleteTracks={handleDeleteTracks}
            onAddTracks={handleAddTracks}
            onAddToPlaylist={handleAddToPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onEditTrack={handleEditTrack}
            // Новые пропсы для контекстного меню
            onCopyTitle={handleCopyTitle}
            onCopyArtist={handleCopyArtist}
            onCopyPath={handleCopyPath}
            onRevealInDir={handleRevealInDir}
          />
        )
      case 'liked':
        return (
          <LikedViewM
            tracks={likedTracks}
            playlists={playlists}
            onSelectTrack={handleTrackSelect}
            playingTrackId={selectedTrack?.id ?? null}
            onToggleLike={handleToggleLike}
            onDeleteTracks={handleDeleteTracks}
            onAddToPlaylist={handleAddToPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onEditTrack={handleEditTrack}
            // Новые пропсы для контекстного меню
            onCopyTitle={handleCopyTitle}
            onCopyArtist={handleCopyArtist}
            onCopyPath={handleCopyPath}
            onRevealInDir={handleRevealInDir}
          />
        )
      case 'playlist':
        return (
          <PlaylistViewM
            key={activePlaylist?.id ?? 'none'}
            playlist={activePlaylist}
            playlists={playlists}
            tracks={tracks}
            onSelectTrack={handleTrackSelect}
            playingTrackId={selectedTrack?.id ?? null}
            onToggleLike={handleToggleLike}
            onRemoveFromPlaylist={handleRemoveFromPlaylist}
            onEditTrack={handleEditTrack}
            onCopyTitle={handleCopyTitle}
            onCopyArtist={handleCopyArtist}
            onCopyPath={handleCopyPath}
            onRevealInDir={handleRevealInDir}
            onCopyTitleArtist={handleCopyTitleArtist}
            onCreatePlaylist={handleCreatePlaylist}
            onAddToPlaylist={handleAddToPlaylist}
          />
        )
      default:
        return (
          <HomeViewM
            tracks={tracks}
            nickname={userNickname}
            onSelectTrack={handleTrackSelect}
            lastPlayed={selectedTrack}
            playHistory={playHistory}
          />
        )
    }
  }

  if (appState === 'splash') {
    const percent =
      loadProgress && loadProgress.total > 0
        ? Math.round((loadProgress.loaded / loadProgress.total) * 100)
        : 0
    return (
      <div className="splash-screen">
        <div className="splash-bg"></div>
        <div className="container">
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                marginBottom: 10,
              }}
            >
              <Logo style={{ width: 56, height: 50, color: 'var(--text)' }} />
              <span
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: 'var(--text)',
                }}
              >
                Playly
              </span>
            </div>
            <div className="subtitle">Version 2.0.2</div>
            <div className="loading-bar-container">
              <div
                className="loading-bar-fill"
                style={{ width: `${Math.max(percent, 5)}%` }}
              ></div>
            </div>
            <div className="loading-text">
              {loadProgress && loadProgress.total > 0
                ? t('splash.loaded', { loaded: loadProgress.loaded, total: loadProgress.total })
                : t('splash.loading')}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (appState === 'onboarding') {
    return (
      <Onboarding
        onComplete={(n) => {
          setUserNickname(n)
          setTimeout(() => setAppState('main'), 300)
        }}
      />
    )
  }

  const percent = upload
    ? Math.round((upload.current / Math.max(upload.total, 1)) * 100)
    : 0

  return (
    <div className="app">
      <div
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={handleTitleBarDoubleClick}
      >
        <div></div>
        <div className="titlebar-center">
          <span className="titlebar-app-name">Playly</span>
        </div>
        <div className="titlebar-controls">
          <button
            className="control-btn minimize-btn"
            onClick={() => appWindow.minimize()}
            title={t('titlebar.minimize')}
          >
            <svg viewBox="0 0 14 14" fill="none">
              <line
                className="icon-stroke"
                x1="3"
                y1="7"
                x2="11"
                y2="7"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            className="control-btn maximize-btn"
            onClick={handleMaximize}
            title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}
          >
            <svg viewBox="0 0 14 14" fill="none">
              {isMaximized ? (
                <>
                  <rect
                    className="icon-stroke"
                    x="4.5"
                    y="1.5"
                    width="7"
                    height="7"
                    rx="1.2"
                    strokeWidth="1.2"
                    fill="none"
                  />
                  <rect
                    className="icon-stroke"
                    x="2.5"
                    y="4.5"
                    width="7"
                    height="7"
                    rx="1.2"
                    strokeWidth="1.2"
                    fill="#161618"
                  />
                  <rect
                    className="icon-stroke"
                    x="2.5"
                    y="4.5"
                    width="7"
                    height="7"
                    rx="1.2"
                    strokeWidth="1.2"
                    fill="none"
                  />
                </>
              ) : (
                <rect
                  className="icon-stroke"
                  x="3"
                  y="3"
                  width="8"
                  height="8"
                  rx="1.5"
                  strokeWidth="1.3"
                />
              )}
            </svg>
          </button>
          <button
            className="control-btn close-btn"
            onClick={() => appWindow.close()}
            title={t('titlebar.close')}
          >
            <svg viewBox="0 0 14 14" fill="none">
              <line
                className="icon-stroke"
                x1="4"
                y1="4"
                x2="10"
                y2="10"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <line
                className="icon-stroke"
                x1="10"
                y1="4"
                x2="4"
                y2="10"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <SidebarM
        currentView={currentView}
        onViewChange={setCurrentView}
        nickname={userNickname}
        playlists={playlists}
        avatarUrl={userAvatar}
        avatarShape={avatarShape}
        onCreatePlaylist={handleCreatePlaylist}
        onRenamePlaylist={handleRenamePlaylist}
        onUpdatePlaylist={handleUpdatePlaylist}
        tracks={tracks}
        onDeletePlaylist={handleDeletePlaylist}
        onChangePlaylistCover={handleChangePlaylistCover}
        onPickImage={handlePickImage}
        onOpenPlaylist={handleOpenPlaylist}
        onReorderPlaylists={handleReorderPlaylists}
      />
      <main
        className={`main ${
          currentView === 'tracks' || currentView === 'liked' || currentView === 'playlist'
            ? 'selectable'
            : ''
        }`}
        id="mainContent"
      >
        {renderView()}
      </main>
      <PlayerBar
        track={selectedTrack}
        isPlaying={isPlaying}
        onPlayToggle={handlePlayPause}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isMuted={isMuted}
        onVolumeChange={handleVolumeChange}
        onMuteToggle={handleMuteToggle}
        onSeek={handleSeek}
        onNext={handleNext}
        onPrev={handlePrev}
        isShuffle={isShuffle}
        repeatMode={repeatMode}
        onShuffleToggle={() => setIsShuffle((v) => !v)}
        onRepeatToggle={() =>
          setRepeatMode((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'))
        }
        isLiked={selectedTrack?.liked ?? false}
        onToggleLike={handleToggleLike}
        onCopyTitle={
          selectedTrack ? () => navigator.clipboard.writeText(selectedTrack.title) : undefined
        }
        onCopyArtist={
          selectedTrack
            ? () => navigator.clipboard.writeText(selectedTrack.artist)
            : undefined
        }
        onCopyTitleArtist={
          selectedTrack
            ? () =>
                navigator.clipboard.writeText(
                  `${selectedTrack.title} — ${selectedTrack.artist}`
                )
            : undefined
        }
      />
      <div className={`drag-overlay ${isDragging || upload ? 'active' : ''}`}>
        {!upload ? (
          <div className="drag-inner">
            <div className="drop-icon">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h2>{t('upload.dropTitle')}</h2>
            <p>
              {t('upload.dropFormats')} <strong>{t('upload.formats')}</strong>
            </p>
          </div>
        ) : (
          <div className="upload-card">
            <div className="upload-header">
              <div className="upload-title">
                {upload.finished ? t('upload.done') : t('upload.importing')}
              </div>
              <div className="upload-percent">{percent}%</div>
            </div>
            <div className="upload-bar-bg">
              <div className="upload-bar-fill" style={{ width: `${percent}%` }} />
            </div>
            {upload.fileName && !upload.finished && (
              <div className="upload-current">{t('upload.reading', { file: upload.fileName })}</div>
            )}
            <div className="upload-files">
              {upload.files.slice(0, 6).map((f, i) => (
                <div
                  key={i}
                  className={`upload-file-item ${
                    i < upload.current
                      ? 'done'
                      : i === upload.current && !upload.finished
                        ? 'active'
                        : ''
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <div className="upload-file-name">{f.name}</div>
                  <div className="upload-file-status">{i < upload.current ? '✓' : ''}</div>
                </div>
              ))}
              {upload.files.length > 6 && (
                <div className="upload-more">{t('upload.more', { n: upload.files.length - 6 })}</div>
              )}
            </div>
            {!upload.finished && (
              <div className="upload-actions">
                <button
                  className="upload-cancel-btn"
                  onClick={() => {
                    cancelUploadRef.current = true
                  }}
                >
                  {t('upload.cancel')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}

export default App