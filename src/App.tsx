import {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/layout/Sidebar'
import PlayerBar from './components/layout/PlayerBar'
import HomeView from './components/views/HomeView'
import SettingsView, { type SettingsSection } from './components/views/SettingsView'
import TracksView from './components/views/TracksView'
import LikedView from './components/views/LikedView'
import PlaylistView from './components/views/PlaylistView'
import NowPlayingView from './components/views/NowPlayingView'
import Onboarding from './components/Onboarding'
import TitleBar from './components/layout/TitleBar'
import ProfileModal from './components/ProfileModal'
import Logo from './components/Logo'
import useLibrary from './hooks/useLibrary'
import { formatDuration, loadCoverUrl, loadSettings, saveSettings, isAudioFile, type AppSettings } from './lib/trackLoader'
import VideoGifHost from './components/VideoGifEditor'
import AppBackdrop from './components/AppBackdrop'
import UpdateToast from './components/UpdateToast'
import { startUpdater } from './lib/updater'
import {
  activeParticleKind,
  customIdOf,
  DEFAULT_BACKDROP,
  DEFAULT_PARTICLES,
  loadBackdropUrl,
  normalizeBackdrop,
  normalizeParticles,
  type AppBackdrop as AppBackdropSettings,
  type ParticleSettings,
} from './lib/appearance'
import { AudioEngine, type CrossfadeCurve, type EngineEvents } from './lib/audioEngine'
import { applyUiScale, clampUiScale, UI_SCALE_DEFAULT } from './lib/uiScale'
import { DEFAULT_FRAME, normalizeFrame, type ImageFrame } from './lib/imageFrame'
import { normalizeCustomPresets, presetGains, type EqPreset } from './lib/equalizer'
import { initListeningStats, useListeningTracker } from './lib/listeningStats'
import { loadProfileImage, normalizeLook, readProfileFile, type AvatarShape, type ProfileLook } from './lib/profile'
import { versionLabel } from './lib/version'
import type { TrackUpdates } from './components/views/TrackEditModal'
import { MINI_COMMAND_EVENT, MINI_HELLO_EVENT, MINI_STATE_EVENT, type MiniCommand, type MiniState } from './lib/miniBridge'
import { DEFAULT_DISCORD_PARTS, normalizeDiscordParts, type DiscordParts } from './lib/discord'
import { I18nProvider, useI18n } from './i18n'
import './App.css'
import './styles/buttons.css'
import './styles/responsive.css'

export type ViewType = 'home' | 'settings' | 'tracks' | 'liked' | 'playlist' | 'nowplaying'

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
  /* Анимированная обложка (GIF в папке covers): видна, пока трек играет; в списках — обычная cover */
  animCoverFile?: string | null
  /* Не показывать этот трек в статусе Discord */
  discordHidden?: boolean
}

export interface Playlist {
  id: number
  name: string
  cover?: string | null
  coverFile?: string | null
  /* Цвет фона шапки плейлиста (#rrggbb), null — стандартный */
  color?: string | null
  /* Картинка (можно GIF) на фоне шапки плейлиста */
  banner?: PlaylistBanner | null
  trackIds: number[]
}

/* Где размыт баннер: нигде, у одного края, у обоих краёв или целиком */
export type BannerBlur = 'none' | 'left' | 'right' | 'both' | 'all'

export interface PlaylistBanner {
  /* Картинка (по умолчанию) или градиент — у градиента file пустой */
  mode?: 'image' | 'gradient'
  gradient?: { from: string; to: string; angle: number }
  file: string
  /* Загруженная картинка (blob-url); в playlists.json не сохраняется */
  url?: string | null
  frame: ImageFrame
  blur: BannerBlur
  /* Сила размытия, px */
  blurAmount: number
  /* Насколько далеко от края тянется размытие, % ширины */
  blurSize: number
  /* Затемнение для читаемости текста, 0–0.8 */
  dim: number
}

export interface CoverPick {
  coverUrl: string
  coverFile: string
}

export type RepeatMode = 'off' | 'all' | 'one'

/* За сколько секунд до начала кроссфейда подгружать следующий трек */
const CROSSFADE_PRELOAD_LEAD = 12
/* Ручное переключение не должно тянуться так же долго, как автоматический переход */
const MANUAL_CROSSFADE_MAX = 4

interface CrossfadePlan {
  from: number
  idx: number
  trackId: number
  shuffle: boolean
  repeat: RepeatMode
  failed: boolean
}

const SidebarM = memo(Sidebar)
const HomeViewM = memo(HomeView)
const NowPlayingViewM = memo(NowPlayingView)
const SettingsViewM = memo(SettingsView)
const TracksViewM = memo(TracksView)
const LikedViewM = memo(LikedView)
const PlaylistViewM = memo(PlaylistView)

function AppInner() {
  const { t, lang } = useI18n()
  const [appState, setAppState] = useState<'splash' | 'onboarding' | 'main'>('splash')
  const [userNickname, setUserNickname] = useState('Aurum2347')
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [avatarShape, setAvatarShape] = useState<AvatarShape>('circle')
  const [avatarFrame, setAvatarFrame] = useState<ImageFrame>(DEFAULT_FRAME)
  const [cardLook, setCardLook] = useState<ProfileLook | null>(null)
  const [bannerLook, setBannerLook] = useState<ProfileLook | null>(null)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [currentView, setCurrentView] = useState<ViewType>('home')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
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
  const [manualCrossfade, setManualCrossfade] = useState(false)
  const [crossfadeCurve, setCrossfadeCurve] = useState<CrossfadeCurve>('equal')
  const [outputDevice, setOutputDevice] = useState('')
  /* Растёт при перемотке и смене трека — по нему обновляется позиция в Discord */
  const [seekTick, setSeekTick] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const engineRef = useRef<AudioEngine | null>(null)
  const engineEventsRef = useRef<EngineEvents | null>(null)
  const skipLoadRef = useRef(false)
  const pendingPlayRef = useRef(false)
  /* blob-url картинок профиля (аватарка, фон карточки, баннер) — освобождаются при перезагрузке профиля */
  const profileUrlsRef = useRef<string[]>([])
  const profileLoadSeqRef = useRef(0)
  const historyRef = useRef<number[]>([])
  const queueRef = useRef<number[]>([])
  const queueIndexRef = useRef(-1)
  const repeatRef = useRef<RepeatMode>('off')
  const shuffleRef = useRef(false)
  const isPlayingRef = useRef(false)
  const volumeRef = useRef(100)
  const mutedRef = useRef(false)
  const crossfadeRef = useRef(0)
  const manualCrossfadeRef = useRef(false)
  const outputDeviceRef = useRef('')
  /* Идёт загрузка трека для автоматического кроссфейда */
  const autoXfadeRef = useRef(false)
  const xfadePlanRef = useRef<CrossfadePlan | null>(null)

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
    handlePickBanner,
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
          engineRef.current?.stop()
        }
      } else {
        setQueue(newQueue)
        if (curId !== undefined) setQueueIndex(Math.max(0, newQueue.indexOf(curId)))
      }
    },
    onLibraryCleared: () => {
      setQueue([])
      setQueueIndex(-1)
      engineRef.current?.stop()
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

  const selectedTrack = useMemo(() => {
    if (queueIndex < 0 || queueIndex >= queue.length) return null
    const id = queue[queueIndex]
    return tracks.find((t) => t.id === id) ?? null
  }, [queue, queueIndex, tracks])

  const applyOutputDevice = useCallback(async (deviceId: string) => {
    await engineRef.current?.setOutputDevice(deviceId)
  }, [])

  const applyMasterGain = useCallback(() => {
    engineRef.current?.setVolume(volumeRef.current / 100, mutedRef.current)
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

  /*
   * Следующий трек для кроссфейда выбирается один раз и запоминается (важно при перемешивании:
   * предзагруженный и реально включённый трек должны совпасть). План сбрасывается сам,
   * как только меняется текущий трек, очередь или режимы повтора/перемешивания.
   */
  const getCrossfadePlan = useCallback((): CrossfadePlan | null => {
    const q = queueRef.current
    const cur = queueIndexRef.current
    const p = xfadePlanRef.current
    if (
      p &&
      p.from === cur &&
      p.shuffle === shuffleRef.current &&
      p.repeat === repeatRef.current &&
      q[p.idx] === p.trackId
    ) {
      return p
    }
    const idx = computeNextIndex()
    if (idx === null) {
      xfadePlanRef.current = null
      return null
    }
    const plan: CrossfadePlan = {
      from: cur,
      idx,
      trackId: q[idx],
      shuffle: shuffleRef.current,
      repeat: repeatRef.current,
      failed: false,
    }
    xfadePlanRef.current = plan
    return plan
  }, [computeNextIndex])

  /* Длительность визуальной смены трека в расширенном режиме: при кроссфейде — столько же, сколько звук */
  const [trackFadeMs, setTrackFadeMs] = useState(450)
  const markTrackFade = useCallback(
    (sec: number) => setTrackFadeMs(Math.round(Math.min(6000, Math.max(450, sec * 1000)))),
    []
  )
  const manualFadeSec = useCallback(
    () => (manualCrossfadeRef.current && crossfadeRef.current > 0 ? Math.min(crossfadeRef.current, MANUAL_CROSSFADE_MAX) : 0),
    []
  )

  /* Переключает интерфейс на трек, который движок уже играет */
  const commitQueueIndex = useCallback(
    (idx: number, fadeSec: number) => {
      markTrackFade(fadeSec)
      const q = queueRef.current
      const nextId = q[idx]
      historyRef.current.push(queueIndexRef.current)
      if (historyRef.current.length > 50) historyRef.current.shift()
      if (nextId !== q[queueIndexRef.current]) skipLoadRef.current = true
      setQueueIndex(idx)
      if (nextId !== undefined) recordPlay(nextId)
    },
    [recordPlay, markTrackFade]
  )

  /* ===== Автоматический кроссфейд: предзагрузка заранее, старт точно за N секунд до конца ===== */
  const maybeAutoCrossfade = useCallback(() => {
    const eng = engineRef.current
    const cf = crossfadeRef.current
    if (!eng || cf <= 0 || autoXfadeRef.current || eng.isTransitioning) return
    if (!isPlayingRef.current || repeatRef.current === 'one') return
    const remaining = eng.remaining()
    if (!isFinite(remaining) || remaining > cf + CROSSFADE_PRELOAD_LEAD) return
    const plan = getCrossfadePlan()
    if (!plan || plan.failed) return
    const next = tracksRef.current.find((t) => t.id === plan.trackId)
    if (!next) return
    if (remaining > cf + 0.3) {
      eng.preload(next)
      return
    }
    /* Слишком поздно — трек доиграет и переключится обычным способом */
    if (remaining < 0.2) return
    autoXfadeRef.current = true
    const fade = Math.min(cf, remaining)
    eng.load(next, { autoplay: true, fade }).then((ok) => {
      autoXfadeRef.current = false
      if (!ok) {
        plan.failed = true
        return
      }
      let idx = plan.idx
      if (queueRef.current[idx] !== next.id) idx = queueRef.current.indexOf(next.id)
      if (idx >= 0) commitQueueIndex(idx, fade)
    })
  }, [getCrossfadePlan, commitQueueIndex, tracksRef])

  /* Трек доиграл без кроссфейда */
  const handleEnded = useCallback(() => {
    const eng = engineRef.current
    if (!eng || autoXfadeRef.current) return
    const q = queueRef.current
    const idx = queueIndexRef.current
    if (repeatRef.current === 'one') {
      eng.seek(0)
      eng.play()
      return
    }
    if (q.length === 0) return
    const next = computeNextIndex()
    if (next === null) {
      eng.pause()
      return
    }
    if (next === idx) {
      eng.seek(0)
      eng.play()
      recordPlay(q[idx])
      return
    }
    historyRef.current.push(idx)
    if (historyRef.current.length > 50) historyRef.current.shift()
    pendingPlayRef.current = true
    markTrackFade(0)
    setQueueIndex(next)
  }, [computeNextIndex, recordPlay, markTrackFade])

  useEffect(() => {
    engineEventsRef.current = {
      onTime: (t) => {
        setCurrentTime(t)
        maybeAutoCrossfade()
      },
      onDuration: (d) => setDuration(d),
      onPlayingChange: (p) => {
        isPlayingRef.current = p
        setIsPlaying(p)
      },
      onEnded: handleEnded,
    }
  }, [maybeAutoCrossfade, handleEnded])

  /* У видео и редких форматов длительность из тегов не читается — берём её у движка, когда трек загрузится */
  useEffect(() => {
    if (selectedTrack && duration > 0 && selectedTrack.duration === '0:00') {
      libraryEditTrack(selectedTrack.id, { duration: formatDuration(duration) })
    }
  }, [selectedTrack, duration, libraryEditTrack])

  useEffect(() => {
    const eng = new AudioEngine({
      onTime: (t) => engineEventsRef.current?.onTime(t),
      onDuration: (d) => engineEventsRef.current?.onDuration(d),
      onPlayingChange: (p) => engineEventsRef.current?.onPlayingChange(p),
      onEnded: () => engineEventsRef.current?.onEnded(),
    })
    eng.setVolume(volumeRef.current / 100, mutedRef.current)
    engineRef.current = eng
    return () => {
      eng.dispose()
      if (engineRef.current === eng) engineRef.current = null
    }
  }, [])

  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false
      return
    }
    const eng = engineRef.current
    if (!eng) return
    if (!selectedTrack) {
      eng.stop()
      setCurrentTime(0)
      setDuration(0)
      return
    }
    const autoplay = pendingPlayRef.current
    pendingPlayRef.current = false
    /* Ручное переключение: короткий кроссфейд, если включён, иначе мгновенно (но без щелчка) */
    const cf = crossfadeRef.current
    const fade = manualCrossfadeRef.current && cf > 0 ? Math.min(cf, MANUAL_CROSSFADE_MAX) : 0
    setCurrentTime(0)
    setDuration(0)
    setSeekTick((v) => v + 1)
    void eng.load(selectedTrack, { autoplay, fade })
  }, [selectedTrack?.id])

  /* Патчи копятся, пока идёт задержка, — иначе быстрая смена двух разных настроек теряла первую */
  const pendingSettingsRef = useRef<Partial<AppSettings>>({})
  const scheduleSettingsSave = useCallback((patch: Partial<AppSettings>) => {
    pendingSettingsRef.current = { ...pendingSettingsRef.current, ...patch }
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current)
    settingsSaveTimerRef.current = setTimeout(() => {
      const p = pendingSettingsRef.current
      pendingSettingsRef.current = {}
      saveSettings(p).catch((e) => console.error('Не удалось сохранить настройки:', e))
    }, 250)
  }, [])

  const handleCrossfadeChange = useCallback(
    (sec: number) => {
      const v = Math.max(0, Math.min(12, Math.round(sec)))
      setCrossfade(v)
      crossfadeRef.current = v
      scheduleSettingsSave({ crossfade: v })
    },
    [scheduleSettingsSave]
  )

  const handleManualCrossfadeChange = useCallback(
    (v: boolean) => {
      setManualCrossfade(v)
      manualCrossfadeRef.current = v
      scheduleSettingsSave({ manualCrossfade: v })
    },
    [scheduleSettingsSave]
  )

  const handleCrossfadeCurveChange = useCallback(
    (c: CrossfadeCurve) => {
      setCrossfadeCurve(c)
      if (engineRef.current) engineRef.current.curve = c
      scheduleSettingsSave({ crossfadeCurve: c })
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
  const [discordParts, setDiscordParts] = useState<DiscordParts>(DEFAULT_DISCORD_PARTS)
  const [visualizerEnabled, setVisualizerEnabled] = useState(true)
  const [eqEnabled, setEqEnabled] = useState(false)
  const [eqPresetId, setEqPresetId] = useState('flat')
  const [eqCustomPresets, setEqCustomPresets] = useState<EqPreset[]>([])
  /* Усиления из открытого редактора пресета — слышны сразу, пока его двигают */
  const [eqPreview, setEqPreview] = useState<number[] | null>(null)

  /* ===== Фон приложения и частицы ===== */
  const [backdrop, setBackdrop] = useState<AppBackdropSettings>(DEFAULT_BACKDROP)
  const [particles, setParticles] = useState<ParticleSettings>(DEFAULT_PARTICLES)

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

  const handleDiscordPartsChange = useCallback(
    (parts: DiscordParts) => {
      setDiscordParts(parts)
      scheduleSettingsSave({ discordParts: parts })
    },
    [scheduleSettingsSave]
  )

  /* Пока настройки не прочитаны (заставка, онбординг), статус не трогаем: RPC мог быть выключен */
  const rpcReady = appState === 'main'
  const rpcTitle = selectedTrack?.title
  const rpcArtist = selectedTrack?.artist
  const rpcAlbum = selectedTrack?.album
  const rpcRate = selectedTrack?.playbackRate ?? 1
  /* Трек, скрытый в его настройках, в Discord не раскрывается */
  const rpcHidden = selectedTrack?.discordHidden === true

  useEffect(() => {
    if (!rpcReady) return
    if (!discordRpc) {
      invoke('discord_clear_presence').catch(() => {})
      return
    }
    const parts = discordParts
    const idle = () => {
      if (parts.idle) {
        invoke('discord_idle_presence', {
          details: t('discord.idleTitle'),
          status: t('discord.idleState'),
          showButtons: parts.buttons,
        }).catch(() => {})
      } else {
        invoke('discord_clear_presence').catch(() => {})
      }
    }

    if (rpcTitle === undefined) {
      idle()
      return
    }
    if (!isPlaying && !parts.paused) {
      invoke('discord_clear_presence').catch(() => {})
      return
    }
    if (rpcHidden) {
      invoke('discord_idle_presence', {
        details: t('discord.privateTitle'),
        status: isPlaying ? t('discord.privateState') : t('discord.pause'),
        showButtons: parts.buttons,
      }).catch(() => {})
      return
    }

    const artist = rpcArtist?.trim() || t('views.nowPlaying.unknownArtist')
    const pause = isPlaying ? '' : ` · ${t('discord.pause')}`
    const status = parts.artist ? `${t('discord.author')}: ${artist}${pause}` : isPlaying ? 'Playly' : t('discord.pause')
    /* Discord ведёт полосу по реальному времени, поэтому учитываем скорость воспроизведения */
    const rate = rpcRate > 0 ? rpcRate : 1
    const position = engineRef.current?.currentTime ?? currentTime
    invoke('discord_update_presence', {
      title: parts.title ? rpcTitle : t('discord.privateTitle'),
      artist: parts.artist ? artist : '',
      album: parts.album ? rpcAlbum ?? '' : '',
      durationSecs: Math.max(1, duration) / rate,
      isPlaying,
      positionSecs: Math.max(0, position) / rate,
      status,
      searchLabel: t('discord.search'),
      showProgress: parts.progress,
      showButtons: parts.buttons,
      /* Поиск без названия и исполнителя бессмысленен */
      showLinks: parts.buttons && parts.title && parts.artist,
    }).catch(() => {})
    /* currentTime намеренно не в зависимостях: позиция обновляется по seekTick, а не каждый кадр */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcReady, discordRpc, discordParts, isPlaying, selectedTrack?.id, rpcTitle, rpcArtist, rpcAlbum, rpcRate, rpcHidden, duration, seekTick, t])

  const loadProfile = useCallback(async () => {
    /* Две быстрые перезагрузки подряд: применяется только последняя */
    const seq = ++profileLoadSeqRef.current
    try {
      const data = await readProfileFile()
      const card = normalizeLook(data.card, 'card')
      const banner = normalizeLook(data.banner, 'banner')
      const [avatarUrl, cardUrl, bannerUrl] = await Promise.all([
        loadProfileImage(data.avatarFile),
        card.mode === 'image' ? loadProfileImage(card.file) : null,
        banner.mode === 'image' ? loadProfileImage(banner.file) : null,
      ])
      if (seq !== profileLoadSeqRef.current) {
        ;[avatarUrl, cardUrl, bannerUrl].forEach((u) => u && URL.revokeObjectURL(u))
        return
      }
      /* Старые картинки освобождаем чуть позже: иначе до перерисовки они на миг пропадают */
      const stale = profileUrlsRef.current
      setTimeout(() => stale.forEach((u) => URL.revokeObjectURL(u)), 1000)
      profileUrlsRef.current = [avatarUrl, cardUrl, bannerUrl].filter((u): u is string => !!u)

      setAvatarShape(data.avatarShape === 'square' ? 'square' : 'circle')
      setAvatarFrame(normalizeFrame(data.avatarFrame))
      setUserAvatar(avatarUrl)
      setCardLook({ ...card, url: cardUrl })
      setBannerLook({ ...banner, url: bannerUrl })
    } catch (e) {
      console.error('Ошибка загрузки профиля:', e)
    }
  }, [])

  useEffect(() => {
    loadProfile()
    window.addEventListener('playly-profile-updated', loadProfile)
    return () => {
      window.removeEventListener('playly-profile-updated', loadProfile)
      profileUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      profileUrlsRef.current = []
    }
  }, [loadProfile])

  useEffect(() => {
    const init = async () => {
      const startTime = Date.now()
      try {
        /* До онбординга: иначе только что созданный профиль примет себя за давний */
        await initListeningStats()
        const appDir = await appDataDir()
        const playlyDir = await join(appDir, 'playly')
        const userFile = await join(playlyDir, 'user.json')
        const settings = await loadSettings()
        setVolume(settings.volume)
        setIsMuted(settings.isMuted)
        setCrossfade(settings.crossfade ?? 0)
        setManualCrossfade(settings.manualCrossfade)
        setCrossfadeCurve(settings.crossfadeCurve)
        setOutputDevice(settings.outputDevice ?? '')
        manualCrossfadeRef.current = settings.manualCrossfade
        if (engineRef.current) engineRef.current.curve = settings.crossfadeCurve
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
            setBackdrop(normalizeBackdrop(raw.appBackdrop))
            setParticles(normalizeParticles(raw.particles))
            setDiscordParts(normalizeDiscordParts(raw.discordParts))
            if (raw.visualizer === false) setVisualizerEnabled(false)
            if (raw.eqEnabled === true) setEqEnabled(true)
            if (typeof raw.eq === 'string') setEqPresetId(raw.eq)
            setEqCustomPresets(normalizeCustomPresets(raw.eqCustomPresets))
            if (raw.uiScale !== undefined && clampUiScale(raw.uiScale) !== UI_SCALE_DEFAULT) {
              void applyUiScale(clampUiScale(raw.uiScale))
            }
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

  /* Перетаскивание файлов в окно (API Tauri v2: события tauri://file-drop* из v1 больше не приходят) */
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload
      if (p.type === 'enter') {
        /* Подсказку показываем, только если среди файлов есть музыка */
        setIsDragging(p.paths.some((path) => isAudioFile(path)))
      } else if (p.type === 'leave') {
        setIsDragging(false)
      } else if (p.type === 'drop') {
        setIsDragging(false)
        const paths = p.paths.filter((path) => isAudioFile(path))
        if (paths.length > 0) void addTracksFromPaths(paths)
      }
    })
    return () => {
      unlisten.then((f) => f())
    }
  }, [addTracksFromPaths])

  useEffect(() => {
    /* Системное меню браузера (Назад / Обновить / Проверить элемент) не нужно нигде.
       Оставляем его только в полях ввода — там через него вставляют и копируют текст.
       Свои меню (треки, плеер, обложки) вызывают preventDefault сами и сюда не доходят. */
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const editable = target?.closest('input, textarea, [contenteditable="true"]') as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLElement
        | null
      if (editable && !(editable as HTMLInputElement).disabled) {
        const type = (editable as HTMLInputElement).type
        if (editable.tagName !== 'INPUT' || !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(type)) return
      }
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

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

  /** autoplay: false — трек встаёт в плеер на паузе (например, при открытии расширенного режима) */
  const handleTrackSelect = useCallback(
    (track: Track, ctx?: Track[], autoplay = true) => {
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
      markTrackFade(manualFadeSec())
      setQueueIndex(idx)
      historyRef.current = []
      pendingPlayRef.current = autoplay
      if (autoplay) recordPlay(track.id)
    },
    [recordPlay, tracksRef, markTrackFade, manualFadeSec]
  )

  /* ===== Плеер ===== */
  const handlePlayPause = useCallback(() => {
    const eng = engineRef.current
    if (!eng || !eng.hasSource) return
    if (eng.isPlaying) eng.pause()
    else eng.play()
  }, [])

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
    markTrackFade(manualFadeSec())
    setQueueIndex(next)
  }, [markTrackFade, manualFadeSec])

  const handlePrev = useCallback(() => {
    const eng = engineRef.current
    if (eng && eng.currentTime > 3) {
      eng.seek(0)
      return
    }
    const q = queueRef.current
    if (q.length === 0) return
    if (historyRef.current.length > 0) {
      const prev = historyRef.current.pop() as number
      pendingPlayRef.current = true
      markTrackFade(manualFadeSec())
      setQueueIndex(prev)
      return
    }
    if (!shuffleRef.current) {
      pendingPlayRef.current = true
      markTrackFade(manualFadeSec())
      setQueueIndex((queueIndexRef.current - 1 + q.length) % q.length)
    }
  }, [markTrackFade, manualFadeSec])

  const handleSeek = useCallback(
    (time: number) => {
      engineRef.current?.seek(time)
      setCurrentTime(time)
      setSeekTick((v) => v + 1)
    },
    []
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
      updates: TrackUpdates
    ) => {
      libraryEditTrack(trackId, updates)
      if (typeof updates.playbackRate === 'number') {
        engineRef.current?.setRate(trackId, updates.playbackRate)
      }
    },
    [libraryEditTrack]
  )

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
  
  const handleShuffleToggle = useCallback(() => setIsShuffle((v) => !v), [])
  const handleRepeatToggle = useCallback(
    () => setRepeatMode((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off')),
    []
  )

  /* ===== Мини-плеер: состояние уходит в окно у трея, команды приходят обратно ===== */
  const miniStateRef = useRef<() => MiniState>(() => ({}) as MiniState)
  const miniHandlersRef = useRef<(cmd: MiniCommand) => void>(() => {})
  /* Свежие замыкания кладём в ref после каждого рендера — подписки на события остаются постоянными */
  useEffect(() => {
    miniStateRef.current = () => ({
    track: selectedTrack
      ? {
          id: selectedTrack.id,
          title: selectedTrack.title,
          artist: selectedTrack.artist,
          coverFile: selectedTrack.coverFile ?? null,
          animCoverFile: selectedTrack.animCoverFile ?? null,
          liked: selectedTrack.liked,
        }
      : null,
    isPlaying,
    position: engineRef.current?.currentTime ?? currentTimeRef.current,
    at: Date.now(),
    duration,
    rate: selectedTrack?.playbackRate ?? 1,
    volume,
    muted: isMuted,
    shuffle: isShuffle,
    repeat: repeatMode,
    lang,
  })
    miniHandlersRef.current = (cmd: MiniCommand) => {
      switch (cmd.type) {
        case 'toggle':
          handlePlayPause()
          break
        case 'next':
          handleNext()
          break
        case 'prev':
          handlePrev()
          break
        case 'like':
          if (selectedTrack) handleToggleLike(selectedTrack.id, !selectedTrack.liked)
          break
        case 'shuffle':
          handleShuffleToggle()
          break
        case 'repeat':
          handleRepeatToggle()
          break
        case 'mute':
          handleMuteToggle()
          break
        case 'seek':
          handleSeek(Math.max(0, Math.min(durationRef.current || cmd.time, cmd.time)))
          break
        case 'volume':
          handleVolumeChange(cmd.value)
          break
      }
    }
  })

  const sendMiniState = useCallback(() => {
    emitTo('mini', MINI_STATE_EVENT, miniStateRef.current()).catch(() => {})
  }, [])

  useEffect(() => {
    if (appState !== 'main') return
    sendMiniState()
    /* Пока играет музыка, изредка сверяем позицию: мини-плеер досчитывает её сам и может немного уплыть */
    if (!isPlaying) return
    const timer = setInterval(sendMiniState, 5000)
    return () => clearInterval(timer)
  }, [
    appState,
    sendMiniState,
    selectedTrack?.id,
    selectedTrack?.title,
    selectedTrack?.artist,
    selectedTrack?.liked,
    selectedTrack?.coverFile,
    selectedTrack?.animCoverFile,
    selectedTrack?.playbackRate,
    isPlaying,
    duration,
    seekTick,
    volume,
    isMuted,
    isShuffle,
    repeatMode,
    lang,
  ])

  useEffect(() => {
    const unCommand = listen<MiniCommand>(MINI_COMMAND_EVENT, (e) => miniHandlersRef.current(e.payload))
    const unHello = listen(MINI_HELLO_EVENT, () => sendMiniState())
    return () => {
      unCommand.then((f) => f())
      unHello.then((f) => f())
    }
  }, [sendMiniState])

  /* Фоновая проверка обновлений — только когда приложение уже загрузилось */
  useEffect(() => {
    if (appState === 'main') void startUpdater()
  }, [appState])


  const openProfileSettings = useCallback(() => {
    setIsProfileOpen(false)
    setSettingsSection('profile')
    setCurrentView('settings')
  }, [])

  const openProfile = useCallback(() => setIsProfileOpen(true), [])

  const pageTitle =
    currentView === 'playlist'
      ? activePlaylist?.name ?? t('views.playlist.label')
      : currentView === 'nowplaying'
        ? t('views.nowPlaying.title')
        : t(`layout.sidebar.${currentView}`)
  const closeProfile = useCallback(() => setIsProfileOpen(false), [])

  /* ===== Расширенный режим ===== */
  const viewBeforeNowPlayingRef = useRef<ViewType>('home')

  const openNowPlaying = useCallback(() => {
    setCurrentView((v) => {
      if (v !== 'nowplaying') viewBeforeNowPlayingRef.current = v
      return 'nowplaying'
    })
  }, [])

  const closeNowPlaying = useCallback(() => setCurrentView(viewBeforeNowPlayingRef.current), [])

  const getAnalyser = useCallback(() => engineRef.current?.analyser ?? null, [])
  const getEngineTime = useCallback(() => engineRef.current?.currentTime ?? 0, [])

  /* Статистика прослушиваний для окна профиля */
  useListeningTracker(isPlaying, selectedTrack?.id ?? null, duration, getEngineTime)
  const getPlayback = useCallback(
    () => ({ time: engineRef.current?.currentTime ?? 0, duration: engineRef.current?.duration ?? 0 }),
    []
  )

  /* ===== Эквалайзер ===== */
  useEffect(() => {
    const eng = engineRef.current
    if (!eng) return
    if (eqPreview) eng.setEq(eqPreview)
    else eng.setEq(eqEnabled ? presetGains(eqPresetId, eqCustomPresets) : null)
  }, [eqEnabled, eqPresetId, eqCustomPresets, eqPreview])

  const handleEqEnabledChange = useCallback(
    (v: boolean) => {
      setEqEnabled(v)
      scheduleSettingsSave({ eqEnabled: v })
    },
    [scheduleSettingsSave]
  )

  const handleEqPresetChange = useCallback(
    (id: string) => {
      setEqPresetId(id)
      scheduleSettingsSave({ eq: id })
    },
    [scheduleSettingsSave]
  )

  /* Новый или изменённый свой пресет — сразу становится текущим */
  const handleEqSavePreset = useCallback(
    (preset: EqPreset) => {
      setEqCustomPresets((prev) => {
        const next = prev.some((p) => p.id === preset.id)
          ? prev.map((p) => (p.id === preset.id ? preset : p))
          : [...prev, preset]
        scheduleSettingsSave({ eqCustomPresets: next, eq: preset.id })
        return next
      })
      setEqPresetId(preset.id)
    },
    [scheduleSettingsSave]
  )

  const handleEqDeletePreset = useCallback(
    (id: string) => {
      setEqCustomPresets((prev) => {
        const next = prev.filter((p) => p.id !== id)
        scheduleSettingsSave({ eqCustomPresets: next })
        return next
      })
      setEqPresetId((cur) => {
        if (cur !== id) return cur
        scheduleSettingsSave({ eq: 'flat' })
        return 'flat'
      })
    },
    [scheduleSettingsSave]
  )

  const handleVisualizerChange = useCallback(
    (v: boolean) => {
      setVisualizerEnabled(v)
      scheduleSettingsSave({ visualizer: v })
    },
    [scheduleSettingsSave]
  )

  /* Для предпросмотра в настройках профиля; стабильная ссылка, чтобы memo(SettingsView) не перерисовывался зря */
  const profileLooks = useMemo(
    () => ({ card: cardLook, banner: bannerLook, avatarUrl: userAvatar, avatarShape, avatarFrame }),
    [cardLook, bannerLook, userAvatar, avatarShape, avatarFrame]
  )

  /* ===== Анимированная обложка играющего трека (в списках остаётся статичная) ===== */
  const [animCover, setAnimCover] = useState<{ file: string; url: string } | null>(null)
  const animFile = selectedTrack?.animCoverFile ?? null
  useEffect(() => {
    if (!animFile) return
    let alive = true
    let url: string | null = null
    loadCoverUrl(animFile).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      url = u
      setAnimCover(u ? { file: animFile, url: u } : null)
    })
    return () => {
      alive = false
      /* Освобождаем чуть позже, чтобы обложка не мигала при смене трека */
      if (url) setTimeout(() => URL.revokeObjectURL(url as string), 1500)
    }
  }, [animFile])
  const displayTrack = useMemo(
    () => (selectedTrack && animCover && animCover.file === animFile ? { ...selectedTrack, cover: animCover.url } : selectedTrack),
    [selectedTrack, animCover, animFile]
  )

  /* Картинка фона читается из файла; blob освобождается при смене */
  const [backdropUrl, setBackdropUrl] = useState<{ file: string; url: string } | null>(null)
  const backdropFile = backdrop.mode === 'image' ? backdrop.file : null
  useEffect(() => {
    if (!backdropFile) return
    let alive = true
    let url: string | null = null
    loadBackdropUrl(backdropFile).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      url = u
      setBackdropUrl(u ? { file: backdropFile, url: u } : null)
    })
    return () => {
      alive = false
      if (url) setTimeout(() => URL.revokeObjectURL(url as string), 1500)
    }
  }, [backdropFile])
  const backdropWithUrl = useMemo<AppBackdropSettings>(
    () => ({ ...backdrop, url: backdropUrl && backdropUrl.file === backdropFile ? backdropUrl.url : null }),
    [backdrop, backdropUrl, backdropFile]
  )

  const particleKind = activeParticleKind(particles, selectedTrack?.id ?? null, isPlaying)
  const particleCustomId = customIdOf(particleKind)
  const particleCustom = useMemo(
    () => (particleCustomId ? particles.custom.find((c) => c.id === particleCustomId) ?? null : null),
    [particleCustomId, particles.custom]
  )
  const particleOptions = useMemo(
    () => ({
      kind: particleKind,
      density: particles.density,
      speed: particles.speed,
      size: particles.size,
      opacity: particles.opacity,
      blur: particles.blur,
      custom: particleCustom,
    }),
    [particleKind, particles.density, particles.speed, particles.size, particles.opacity, particles.blur, particleCustom]
  )
  /* Фон рисуется, если выбран свой фон или вообще настроены частицы (хотя бы в правилах) */
  const hasBackdrop =
    appState === 'main' && (backdrop.mode !== 'none' || particles.kind !== 'none' || particles.rules.length > 0)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('has-backdrop', hasBackdrop)
    /* Без картинки фона панели плотнее: частицы видны, но текст читается легко */
    root.style.setProperty('--ui-alpha', String(backdrop.mode === 'none' ? 0.72 : backdrop.uiOpacity))
  }, [hasBackdrop, backdrop.mode, backdrop.uiOpacity])

  const handleBackdropChange = useCallback(
    (next: AppBackdropSettings) => {
      const { url: _url, ...stored } = next
      void _url
      setBackdrop(stored)
      scheduleSettingsSave({ appBackdrop: stored })
    },
    [scheduleSettingsSave]
  )

  const handleParticlesChange = useCallback(
    (next: ParticleSettings) => {
      setParticles(next)
      scheduleSettingsSave({ particles: next })
    },
    [scheduleSettingsSave]
  )

  /* Обложки, на которые ссылаются треки и плейлисты, — очистка кеша их не трогает */
  const playlistsRef = useRef(playlists)
  useEffect(() => {
    playlistsRef.current = playlists
  }, [playlists])
  const getReferencedCovers = useCallback(() => {
    const used = new Set<string>()
    const add = (f?: string | null) => {
      if (f) used.add(f.split(/[\\/]/).pop() as string)
    }
    tracksRef.current.forEach((tr) => {
      add(tr.coverFile)
      add(tr.animCoverFile)
    })
    playlistsRef.current.forEach((pl) => {
      add(pl.coverFile)
      add(pl.banner?.file)
    })
    return used
  }, [tracksRef])

  /* Стабильная ссылка: иначе memo(LikedView) перерисовывается на каждом тике плеера */
  const likedTracks = useMemo(() => tracks.filter((t) => t.liked), [tracks])

  const renderHome = () => (
    <HomeViewM
      tracks={tracks}
      nickname={userNickname}
      onSelectTrack={handleTrackSelect}
      currentTrack={displayTrack}
      playHistory={playHistory}
      playingTrackId={selectedTrack?.id ?? null}
      isPlaying={isPlaying}
      onPlayToggle={handlePlayPause}
      onOpenNowPlaying={openNowPlaying}
      getPlayback={getPlayback}
      playlists={playlists}
      onToggleLike={handleToggleLike}
      onDeleteTracks={handleDeleteTracks}
      onAddToPlaylist={handleAddToPlaylist}
      onCreatePlaylist={handleCreatePlaylist}
      onEditTrack={handleEditTrack}
      onCopyTitle={handleCopyTitle}
      onCopyArtist={handleCopyArtist}
      onCopyPath={handleCopyPath}
      onRevealInDir={handleRevealInDir}
    />
  )

  const renderView = () => {
    switch (currentView) {
      case 'home':
        return renderHome()
      case 'nowplaying':
        return (
          <NowPlayingViewM
            track={displayTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            isLiked={selectedTrack?.liked ?? false}
            onPlayToggle={handlePlayPause}
            onNext={handleNext}
            onPrev={handlePrev}
            onSeek={handleSeek}
            onToggleLike={handleToggleLike}
            volume={volume}
            isMuted={isMuted}
            isShuffle={isShuffle}
            repeatMode={repeatMode}
            onVolumeChange={handleVolumeChange}
            onMuteToggle={handleMuteToggle}
            onShuffleToggle={handleShuffleToggle}
            onRepeatToggle={handleRepeatToggle}
            onBack={closeNowPlaying}
            trackFadeMs={trackFadeMs}
            getAnalyser={getAnalyser}
            getCurrentTime={getEngineTime}
            visualizerEnabled={visualizerEnabled}
            onToggleVisualizer={handleVisualizerChange}
          />
        )
      case 'settings':
        return (
          <SettingsViewM
            section={settingsSection}
            onSectionChange={setSettingsSection}
            currentNickname={userNickname}
            onSaveNickname={handleSaveNickname}
            profileLooks={profileLooks}
            crossfade={crossfade}
            onChangeCrossfade={handleCrossfadeChange}
            manualCrossfade={manualCrossfade}
            onChangeManualCrossfade={handleManualCrossfadeChange}
            crossfadeCurve={crossfadeCurve}
            onChangeCrossfadeCurve={handleCrossfadeCurveChange}
            eqEnabled={eqEnabled}
            eqPresetId={eqPresetId}
            eqCustomPresets={eqCustomPresets}
            onChangeEqEnabled={handleEqEnabledChange}
            onChangeEqPreset={handleEqPresetChange}
            onSaveEqPreset={handleEqSavePreset}
            onDeleteEqPreset={handleEqDeletePreset}
            onPreviewEq={setEqPreview}
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
            discordParts={discordParts}
            onChangeDiscordParts={handleDiscordPartsChange}
            getReferencedCovers={getReferencedCovers}
            backdrop={backdrop}
            onChangeBackdrop={handleBackdropChange}
            backdropUrl={backdropWithUrl.url ?? null}
            coverUrl={displayTrack?.cover ?? null}
            particles={particles}
            onChangeParticles={handleParticlesChange}
            tracks={tracks}
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
            onImportTracks={handleAddTracks}
          />
        )
      default:
        return renderHome()
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
            <div className="subtitle">Version {versionLabel(t)}</div>
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
    <>
    {hasBackdrop && <AppBackdrop backdrop={backdropWithUrl} coverUrl={displayTrack?.cover ?? null} particles={particleOptions} />}
    <div className={`app ${currentView === 'nowplaying' ? 'immersive' : ''}`}>
      <TitleBar
        pageTitle={pageTitle}
        track={selectedTrack ? { title: selectedTrack.title, artist: selectedTrack.artist } : null}
        isPlaying={isPlaying}
        onOpenNowPlaying={openNowPlaying}
        versionLabel={`Playly ${versionLabel(t)}`}
      />
      <SidebarM
        currentView={currentView}
        onViewChange={setCurrentView}
        onOpenProfile={openProfile}
        nickname={userNickname}
        playlists={playlists}
        avatarUrl={userAvatar}
        avatarShape={avatarShape}
        avatarFrame={avatarFrame}
        cardLook={cardLook}
        onCreatePlaylist={handleCreatePlaylist}
        onRenamePlaylist={handleRenamePlaylist}
        onUpdatePlaylist={handleUpdatePlaylist}
        tracks={tracks}
        onDeletePlaylist={handleDeletePlaylist}
        onChangePlaylistCover={handleChangePlaylistCover}
        onPickImage={handlePickImage}
        onPickBanner={handlePickBanner}
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
        track={displayTrack}
        isNowPlayingOpen={currentView === 'nowplaying'}
        onToggleNowPlaying={currentView === 'nowplaying' ? closeNowPlaying : openNowPlaying}
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
        onShuffleToggle={handleShuffleToggle}
        onRepeatToggle={handleRepeatToggle}
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
      <VideoGifHost />
      <UpdateToast />
      <ProfileModal
        open={isProfileOpen}
        onClose={closeProfile}
        nickname={userNickname}
        avatarUrl={userAvatar}
        avatarShape={avatarShape}
        avatarFrame={avatarFrame}
        bannerLook={bannerLook}
        tracks={tracks}
        playlistsCount={playlists.length}
        onEditProfile={openProfileSettings}
        onPlayTrack={handleTrackSelect}
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
    </>
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