import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Track, RepeatMode } from '../../App'
import { useI18n } from '../../i18n'
import Visualizer from '../Visualizer'
import { useCoverColor } from '../../lib/coverColor'
import { activeLineIndex, loadLyrics, type Lyrics } from '../../lib/lyrics'
import './NowPlayingView.css'

interface NowPlayingViewProps {
  track: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  isLiked: boolean
  volume: number
  isMuted: boolean
  isShuffle: boolean
  repeatMode: RepeatMode
  onPlayToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (t: number) => void
  onToggleLike: (id: number, liked: boolean) => void
  onVolumeChange: (v: number) => void
  onMuteToggle: () => void
  onShuffleToggle: () => void
  onRepeatToggle: () => void
  onBack: () => void
  /* Сколько длится визуальная смена трека (при кроссфейде — как сам кроссфейд) */
  trackFadeMs: number
  getAnalyser: () => AnalyserNode | null | undefined
  getCurrentTime: () => number
  visualizerEnabled: boolean
  onToggleVisualizer: (v: boolean) => void
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
)

/* ===== Текст песни ===== */
function LyricsPanel({ lyrics, getCurrentTime, onSeek }: {
  lyrics: Lyrics
  getCurrentTime: () => number
  onSeek: (t: number) => void
}) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLElement | null>>([])
  const [active, setActive] = useState(-1)
  /* Пока пользователь сам крутит текст, не перехватываем прокрутку */
  const userScrollUntil = useRef(0)

  useEffect(() => {
    if (!lyrics.synced) return
    let raf = 0
    let last = -2
    const tick = () => {
      raf = requestAnimationFrame(tick)
      /* Чуть раньше реального времени — строка подсвечивается к началу пения, а не после */
      const idx = activeLineIndex(lyrics.lines, getCurrentTime() + 0.15)
      if (idx !== last) {
        last = idx
        setActive(idx)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lyrics, getCurrentTime])

  useEffect(() => {
    if (!lyrics.synced || Date.now() < userScrollUntil.current) return
    const box = scrollRef.current
    const el = lineRefs.current[Math.max(0, active)]
    if (!box || !el) return
    const top = el.offsetTop - box.clientHeight * 0.4 + el.offsetHeight / 2
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [active, lyrics])

  const pauseAutoScroll = () => {
    userScrollUntil.current = Date.now() + 3500
  }

  return (
    <section className="np-lyrics">
      <div className="np-lyrics-head">
        <span>{t('views.nowPlaying.lyrics')}</span>
        {!lyrics.synced && <span className="np-lyrics-badge">{t('views.nowPlaying.lyricsUnsynced')}</span>}
      </div>
      <div
        ref={scrollRef}
        className={`np-lyrics-scroll ${lyrics.synced ? 'synced' : 'plain'}`}
        onWheel={pauseAutoScroll}
        onPointerDown={pauseAutoScroll}
      >
        {lyrics.synced
          ? lyrics.lines.map((line, i) => (
              <button
                key={i}
                ref={(el) => { lineRefs.current[i] = el }}
                className={`np-line ${i === active ? 'active' : i < active ? 'past' : ''} ${line.text ? '' : 'gap'}`}
                onClick={() => {
                  userScrollUntil.current = 0
                  onSeek(line.time)
                }}
              >
                {line.text || '♪'}
              </button>
            ))
          : lyrics.lines.map((line, i) => (
              <p key={i} className={`np-line-plain ${line ? '' : 'gap'}`}>{line || ' '}</p>
            ))}
      </div>
    </section>
  )
}

/*
 * Смена трека «слоями»: предыдущий трек остаётся на экране, пока проигрывается
 * анимация ухода, а новый проявляется поверх. Длительность совпадает с кроссфейдом.
 */
function useTrackSwap(track: Track | null, ms: number) {
  const [state, setState] = useState<{ current: Track | null; previous: Track | null; ms: number }>({
    current: track,
    previous: null,
    ms,
  })
  if (track?.id !== state.current?.id) {
    setState({ current: track, previous: state.current, ms })
  } else if (track !== state.current) {
    /* Тот же трек, но обновились данные (лайк, обложка) — без анимации */
    setState((s) => ({ ...s, current: track }))
  }

  useEffect(() => {
    if (!state.previous) return
    const timer = setTimeout(() => setState((s) => ({ ...s, previous: null })), state.ms + 60)
    return () => clearTimeout(timer)
  }, [state.previous, state.ms])

  return state
}

/* ===== Полоса прогресса: пока тянем — показываем черновик, отпустили — перематываем ===== */
function SeekBar({ currentTime, duration, onSeek, trackKey, fadeMs }: {
  currentTime: number
  duration: number
  onSeek: (t: number) => void
  trackKey: number
  fadeMs: number
}) {
  const [draft, setDraft] = useState<number | null>(null)
  /* При смене трека заполнение не прыгает в ноль, а плавно «стекает» за время перехода */
  const [seenKey, setSeenKey] = useState(trackKey)
  const [resetting, setResetting] = useState(false)
  if (trackKey !== seenKey) {
    setSeenKey(trackKey)
    setResetting(true)
  }
  useEffect(() => {
    if (!resetting) return
    const timer = setTimeout(() => setResetting(false), fadeMs)
    return () => clearTimeout(timer)
  }, [resetting, fadeMs])

  const value = draft ?? currentTime
  const pct = duration > 0 ? Math.min(100, (value / duration) * 100) : 0
  const commit = () => {
    if (draft !== null) onSeek(draft)
    setDraft(null)
  }
  return (
    <div className={`np-seek ${resetting ? 'resetting' : ''}`}>
      <span className="np-time">{fmt(value)}</span>
      <input
        type="range"
        className="np-seek-input"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.1}
        value={Math.min(value, duration || 0)}
        disabled={duration <= 0}
        style={{ '--np-seek-pos': `${pct}%` } as CSSProperties}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="np-time">{fmt(duration)}</span>
    </div>
  )
}

/* ===== Громкость в карточке ===== */
function VolumeControl({ volume, isMuted, onVolumeChange, onMuteToggle }: {
  volume: number
  isMuted: boolean
  onVolumeChange: (v: number) => void
  onMuteToggle: () => void
}) {
  const { t } = useI18n()
  const shown = isMuted ? 0 : volume
  return (
    <div className="np-volume">
      <button
        className="np-icon-btn small"
        onClick={onMuteToggle}
        title={isMuted ? t('layout.playerbar.muteOff') : t('layout.playerbar.muteOn')}
      >
        {isMuted || volume === 0 ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />{volume > 50 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}</svg>
        )}
      </button>
      <input
        type="range"
        className="np-volume-input"
        min={0}
        max={100}
        value={shown}
        style={{ '--val': `${shown}%` } as CSSProperties}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        title={t('layout.playerbar.volume')}
      />
      <span className="np-volume-value">{shown}</span>
    </div>
  )
}

export default function NowPlayingView({
  track, isPlaying, currentTime, duration, isLiked,
  volume, isMuted, isShuffle, repeatMode,
  onPlayToggle, onNext, onPrev, onSeek, onToggleLike, onBack,
  onVolumeChange, onMuteToggle, onShuffleToggle, onRepeatToggle,
  getAnalyser, getCurrentTime, visualizerEnabled, onToggleVisualizer, trackFadeMs,
}: NowPlayingViewProps) {
  const { t } = useI18n()
  const tint = useCoverColor(track?.cover)
  const swap = useTrackSwap(track, trackFadeMs)
  const prev = swap.previous

  /* Escape — выход из расширенного режима (если не открыто какое-нибудь окно) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-overlay.open, .confirm-overlay')) return
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
  const [lyricsState, setLyricsState] = useState<{ path: string; lyrics: Lyrics | null } | null>(null)

  const filePath = track?.filePath
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    loadLyrics(filePath).then((lyrics) => {
      if (!cancelled) setLyricsState({ path: filePath, lyrics })
    })
    return () => {
      cancelled = true
    }
  }, [filePath])

  /* Пока текст не прочитан, считаем, что его нет: страница не прыгает от «пустой колонки» */
  const lyrics = track && lyricsState?.path === track.filePath ? lyricsState.lyrics : null
  const hasLyrics = !!lyrics && lyrics.lines.length > 0

  const header = (
    <header className="np-header">
      <button className="np-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {t('views.nowPlaying.back')}
      </button>
      <div className="np-header-title">{t('views.nowPlaying.title')}</div>
      <span />
    </header>
  )

  if (!track) {
    return (
      <div className="np-view empty">
        {header}
        <div className="np-empty">
          <div className="np-empty-icon"><MusicIcon /></div>
          <div className="np-empty-title">{t('views.nowPlaying.emptyTitle')}</div>
          <div className="np-empty-text">{t('views.nowPlaying.emptyText')}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`np-view ${hasLyrics ? 'with-lyrics' : 'no-lyrics'} ${visualizerEnabled ? 'with-viz' : ''} ${isPlaying ? 'playing' : ''}`}
      style={{ ...(tint ? { '--np-tint': tint } : {}), '--np-fade': `${swap.ms}ms` } as CSSProperties}
    >
      <div className="np-backdrop" aria-hidden="true">
        {prev?.cover && <img key={`p${prev.id}`} className="np-layer-out" src={prev.cover} alt="" />}
        {track.cover && <img key={`c${track.id}`} className={prev ? 'np-layer-in' : ''} src={track.cover} alt="" />}
      </div>

      {header}

      <div className="np-body">
        <section className="np-stage">
          <div className="np-card">
            <div className="np-cover">
              {prev && (
                <div key={`p${prev.id}`} className="np-cover-layer np-layer-out">
                  {prev.cover ? <img src={prev.cover} alt="" /> : <MusicIcon />}
                </div>
              )}
              <div key={`c${track.id}`} className={`np-cover-layer ${prev ? 'np-layer-in' : ''}`}>
                {track.cover ? <img src={track.cover} alt="" /> : <MusicIcon />}
              </div>
            </div>
            <div className="np-meta">
              {prev && (
                <div key={`p${prev.id}`} className="np-meta-layer np-text-out" aria-hidden="true">
                  <div className="np-title">{prev.title}</div>
                  <div className="np-artist">{prev.artist || t('views.nowPlaying.unknownArtist')}</div>
                  {prev.album && <div className="np-album">{prev.album}</div>}
                </div>
              )}
              <div key={`c${track.id}`} className={`np-meta-layer ${prev ? 'np-text-in' : ''}`}>
                <div className="np-title" title={track.title}>{track.title}</div>
                <div className="np-artist">{track.artist || t('views.nowPlaying.unknownArtist')}</div>
                {track.album && <div className="np-album">{track.album}</div>}
              </div>
            </div>

            <SeekBar currentTime={currentTime} duration={duration} onSeek={onSeek} trackKey={track.id} fadeMs={swap.ms} />

            <div className="np-controls">
              <button
                className={`np-icon-btn ${isShuffle ? 'active' : ''}`}
                onClick={onShuffleToggle}
                title={t('layout.playerbar.shuffle')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
              </button>
              <button className="np-icon-btn" onClick={onPrev} title={t('layout.playerbar.prev')}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
              </button>
              <button className="np-play" onClick={onPlayToggle} title={isPlaying ? t('layout.playerbar.pause') : t('layout.playerbar.play')}>
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
                )}
              </button>
              <button className="np-icon-btn" onClick={onNext} title={t('layout.playerbar.next')}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-3.5 6L4 6v12z" /></svg>
              </button>
              <button
                className={`np-icon-btn ${repeatMode !== 'off' ? 'active' : ''}`}
                onClick={onRepeatToggle}
                title={t('layout.playerbar.repeat')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                {repeatMode === 'one' && <span className="np-repeat-one">1</span>}
              </button>
            </div>

            <div className="np-toolbar">
              <VolumeControl volume={volume} isMuted={isMuted} onVolumeChange={onVolumeChange} onMuteToggle={onMuteToggle} />
              <div className="np-toolbar-right">
                <button
                  className={`np-icon-btn small ${isLiked ? 'liked' : ''}`}
                  onClick={() => onToggleLike(track.id, !isLiked)}
                  title={isLiked ? t('layout.playerbar.likeRemove') : t('layout.playerbar.likeAdd')}
                >
                  <svg viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
                <button
                  className={`np-viz-switch ${visualizerEnabled ? 'on' : ''}`}
                  onClick={() => onToggleVisualizer(!visualizerEnabled)}
                  role="switch"
                  aria-checked={visualizerEnabled}
                  title={visualizerEnabled ? t('views.nowPlaying.vizOff') : t('views.nowPlaying.vizOn')}
                >
                  <span className="np-viz-switch-bars" aria-hidden="true"><i /><i /><i /><i /></span>
                  <span className="np-viz-switch-label">{t('views.nowPlaying.visualizer')}</span>
                  <span className="np-viz-switch-track" aria-hidden="true"><span /></span>
                </button>
              </div>
            </div>
          </div>

          {visualizerEnabled && (
            <Visualizer className="np-visualizer" getAnalyser={getAnalyser} isPlaying={isPlaying} tint={tint} />
          )}
        </section>

        {hasLyrics && lyrics && (
          <LyricsPanel key={track.filePath} lyrics={lyrics} getCurrentTime={getCurrentTime} onSeek={onSeek} />
        )}
      </div>
    </div>
  )
}
