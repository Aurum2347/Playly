import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../../App'
import TrackActions, { type TrackActionHandlers } from '../TrackActions'
import CoverMenu, { type CoverMenuTarget } from '../CoverMenu'
import { computeMenuPosition, useContextMenu, usePresence } from './shared'
import { useI18n } from '../../i18n'
import { useCoverColor } from '../../lib/coverColor'
import './HomeView.css'

interface HomeViewProps extends TrackActionHandlers {
  tracks: Track[]
  playlists?: Playlist[]
  nickname?: string
  onSelectTrack: (track: Track, queue?: Track[]) => void
  currentTrack?: Track | null
  playHistory?: Record<number, number>
  playingTrackId?: number | null
  isPlaying?: boolean
  onPlayToggle?: () => void
  onOpenNowPlaying?: () => void
  /* Текущая позиция для полоски прогресса в карточке — читается сама, без перерисовки всей страницы */
  getPlayback?: () => { time: number; duration: number }
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
)
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
)
const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
)
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
)
const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

/* ===== Прогресс в карточке: обновляется через rAF и пишет прямо в DOM ===== */
function HeroProgress({ getPlayback }: { getPlayback: () => { time: number; duration: number } }) {
  const fillRef = useRef<HTMLDivElement>(null)
  const curRef = useRef<HTMLSpanElement>(null)
  const durRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let lastSec = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const { time, duration } = getPlayback()
      if (fillRef.current) fillRef.current.style.width = `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%`
      const sec = Math.floor(time)
      if (sec !== lastSec) {
        lastSec = sec
        if (curRef.current) curRef.current.textContent = fmt(time)
        if (durRef.current) durRef.current.textContent = fmt(duration)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayback])
  return (
    <div className="home-hero-progress">
      <span ref={curRef} className="home-hero-time">0:00</span>
      <div className="home-hero-bar"><div ref={fillRef} className="home-hero-bar-fill" /></div>
      <span ref={durRef} className="home-hero-time">0:00</span>
    </div>
  )
}

/* ===== Карточка в ряду «Недавно прослушанные» ===== */
interface CardProps {
  track: Track
  index: number
  queue: Track[]
  onSelectTrack: (t: Track, q?: Track[]) => void
  playing?: boolean
  leaving?: boolean
  cardRef?: (el: HTMLDivElement | null) => void
  onContextMenu?: (e: React.MouseEvent, trackId: number) => void
}
function TrackCard({ track, index, queue, onSelectTrack, playing, leaving, cardRef, onContextMenu }: CardProps) {
  return (
    <div
      ref={cardRef}
      className={`home-card ${playing ? 'playing' : ''} ${leaving ? 'leaving' : ''}`}
      style={leaving ? undefined : { animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={() => !leaving && onSelectTrack(track, queue)}
      onContextMenu={(e) => !leaving && onContextMenu?.(e, track.id)}
    >
      <div className="home-card-cover">
        {track.cover ? <img src={track.cover} alt="" loading="lazy" decoding="async" /> : <MusicIcon />}
        <div className="home-card-play"><PlayIcon /></div>
        {playing && (
          <div className="home-card-eq" aria-hidden="true"><span /><span /><span /></div>
        )}
      </div>
      <div className="home-card-title">{track.title}</div>
      <div className="home-card-artist">{track.artist}</div>
    </div>
  )
}

function useRowScroll(tracksLen: number) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const sync = () => {
    const row = rowRef.current
    if (!row) return
    const sl = row.scrollLeft
    const max = row.scrollWidth - row.clientWidth
    setCanLeft(sl > 3)
    setCanRight(sl < max - 3)
  }
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    sync()
    row.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    return () => {
      row.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [tracksLen])
  useLayoutEffect(() => { sync() })
  const scrollStep = (dir: number) => {
    const row = rowRef.current
    if (row) row.scrollBy({ left: dir * Math.max(240, row.clientWidth * 0.7), behavior: 'smooth' })
  }
  return { rowRef, canLeft, canRight, scrollStep, sync }
}

function RecentlyPlayedRow({ tracks, onSelectTrack, playingTrackId, allTracks, onContextMenu }: {
  tracks: Track[]
  onSelectTrack: (t: Track, q?: Track[]) => void
  playingTrackId?: number | null
  allTracks: Track[]
  onContextMenu?: (e: React.MouseEvent, trackId: number) => void
}) {
  const { t } = useI18n()
  const { rowRef, canLeft, canRight, scrollStep, sync } = useRowScroll(tracks.length)
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const prevLefts = useRef(new Map<number, number>())
  const prevIdsRef = useRef<number[]>([])
  const byIdRef = useRef(new Map<number, Track>())
  const [leaving, setLeaving] = useState<Track[]>([])
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { allTracks.forEach((tr) => byIdRef.current.set(tr.id, tr)) }, [allTracks])

  /* FLIP: при смене порядка карточки плавно переезжают на новые места */
  const idsKey = tracks.map((tr) => tr.id).join(',')
  useLayoutEffect(() => {
    const cur = tracks.map((tr) => tr.id)
    const gone = prevIdsRef.current.filter((id) => !cur.includes(id))
    if (gone.length > 0) {
      const goneTracks = gone.map((id) => byIdRef.current.get(id)).filter(Boolean) as Track[]
      setLeaving(goneTracks)
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = setTimeout(() => setLeaving([]), 500)
    }
    prevIdsRef.current = cur
    const newLefts = new Map<number, number>()
    cardRefs.current.forEach((el, id) => {
      if (el) newLefts.set(id, el.getBoundingClientRect().left)
    })
    newLefts.forEach((left, id) => {
      const prev = prevLefts.current.get(id)
      const el = cardRefs.current.get(id)
      if (!el || prev === undefined) return
      const dx = prev - left
      if (Math.abs(dx) > 2) {
        el.style.transition = 'none'
        el.style.transform = `translateX(${dx}px)`
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)'
          el.style.transform = ''
          setTimeout(() => { el.style.transition = ''; el.style.transform = '' }, 500)
        })
      }
    })
    prevLefts.current = newLefts
    sync()
  }, [idsKey])

  return (
    <section className="home-section">
      <div className="home-section-head">
        <h2 className="home-section-title">{t('views.home.recentlyPlayed')}</h2>
        {tracks.length > 0 && (
          <div className="home-scroll-btns">
            <button className="icon-btn" disabled={!canLeft} onClick={() => scrollStep(-1)} title={t('views.home.back')}><ChevronLeft /></button>
            <button className="icon-btn" disabled={!canRight} onClick={() => scrollStep(1)} title={t('views.home.forward')}><ChevronRight /></button>
          </div>
        )}
      </div>
      {tracks.length === 0 ? (
        <div className="home-section-empty">{t('views.home.emptyPlayed')}</div>
      ) : (
        <div className={`home-row-wrap ${canLeft ? 'fade-left' : ''} ${canRight ? 'fade-right' : ''}`}>
          <div className="home-row" ref={rowRef}>
            {tracks.map((track, i) => (
              <TrackCard
                key={track.id}
                track={track}
                index={i}
                queue={tracks}
                onSelectTrack={onSelectTrack}
                playing={playingTrackId === track.id}
                onContextMenu={onContextMenu}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(track.id, el)
                  else cardRefs.current.delete(track.id)
                }}
              />
            ))}
            {leaving.map((track) => (
              <TrackCard key={`leave-${track.id}`} track={track} index={0} queue={tracks} onSelectTrack={onSelectTrack} leaving />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function greetingKey(hour: number) {
  if (hour >= 5 && hour < 12) return 'views.home.morning'
  if (hour >= 12 && hour < 18) return 'views.home.afternoon'
  if (hour >= 18 && hour < 23) return 'views.home.evening'
  return 'views.home.night'
}

/* ===== Меню копирования названия/исполнителя (как у мини-плеера) ===== */
const TEXT_MENU_W = 260
const TEXT_MENU_H = 130

function TextCopyMenu({ target, onClose }: { target: { x: number; y: number; track: Track } | null; onClose: () => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const { mounted, closing } = usePresence(target !== null)
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)

  useEffect(() => {
    if (!target) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [target, onClose])

  if (!mounted || !shown) return null
  const pos = computeMenuPosition(shown.x, shown.y, TEXT_MENU_W, TEXT_MENU_H)
  const copy = (text: string) => {
    onClose()
    navigator.clipboard.writeText(text).catch(() => {})
  }
  const tr = shown.track

  return createPortal(
    <div ref={ref} className={`player-context-menu ${closing ? 'closing' : ''}`} style={{ left: pos.x, top: pos.y }}>
      <button className="player-context-item" onClick={() => copy(tr.title)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
        {t('layout.playerbar.copyTitle')}
      </button>
      <button className="player-context-item" onClick={() => copy(tr.artist)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        {t('layout.playerbar.copyArtist')}
      </button>
      <button className="player-context-item" onClick={() => copy(`${tr.title} — ${tr.artist}`)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></svg>
        {t('layout.playerbar.copyBoth')}
      </button>
    </div>,
    document.body
  )
}

export default function HomeView({
  tracks, nickname, onSelectTrack, currentTrack = null, playHistory = {},
  playingTrackId = null, isPlaying = false, onPlayToggle, onOpenNowPlaying, getPlayback,
  playlists = [], ...actions
}: HomeViewProps) {
  const { t } = useI18n()
  const trackMenu = useContextMenu<number>()
  const [coverMenu, setCoverMenu] = useState<CoverMenuTarget | null>(null)
  const [textMenu, setTextMenu] = useState<{ x: number; y: number; track: Track } | null>(null)
  const closeCoverMenu = useCallback(() => setCoverMenu(null), [])
  const closeTextMenu = useCallback(() => setTextMenu(null), [])

  const openTrackMenu = (e: React.MouseEvent, trackId: number) => {
    setCoverMenu(null)
    setTextMenu(null)
    trackMenu.open(e, trackId)
  }

  const recentlyPlayed = useMemo(
    () =>
      tracks
        .filter((tr) => playHistory[tr.id])
        .sort((a, b) => (playHistory[b.id] || 0) - (playHistory[a.id] || 0))
        .slice(0, 14),
    [tracks, playHistory]
  )
  const recentAdded = useMemo(
    () => [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 8),
    [tracks]
  )
  const likedCount = useMemo(() => tracks.filter((tr) => tr.liked).length, [tracks])

  /* Карточка: то, что играет сейчас; иначе последнее прослушанное; иначе последнее добавленное */
  const heroTrack = currentTrack ?? recentlyPlayed[0] ?? recentAdded[0] ?? null
  const isCurrent = !!heroTrack && playingTrackId === heroTrack.id
  const heroLabel = isCurrent
    ? isPlaying ? t('views.home.nowPlaying') : t('views.home.paused')
    : recentlyPlayed[0]?.id === heroTrack?.id
      ? t('views.home.continue')
      : t('views.home.startWith')
  const tint = useCoverColor(heroTrack?.cover)

  const handleHeroPlay = () => {
    if (!heroTrack) return
    if (isCurrent) onPlayToggle?.()
    else onSelectTrack(heroTrack, recentlyPlayed.some((tr) => tr.id === heroTrack.id) ? recentlyPlayed : tracks)
  }

  const handleOpenNowPlaying = () => {
    /* Если ничего не играет, сначала включаем трек из карточки — иначе в расширенном режиме будет пусто */
    if (!currentTrack && heroTrack) onSelectTrack(heroTrack, recentlyPlayed.length ? recentlyPlayed : tracks)
    onOpenNowPlaying?.()
  }

  const greeting = t(greetingKey(new Date().getHours()))

  return (
    <div className="home" id="view-home">
      <header className="home-header">
        <div className="home-greeting">
          <div className="home-greeting-sub">{greeting}</div>
          <h1 className="home-greeting-title">
            {nickname ? <span className="home-nick">{nickname}</span> : t('views.home.title')}
          </h1>
        </div>
        {tracks.length > 0 && (
          <div className="home-stats">
            <div className="home-stat">
              <span className="home-stat-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              </span>
              <span className="home-stat-value">{tracks.length}</span>
              <span className="home-stat-label">{t('views.home.statTracks', { n: tracks.length })}</span>
            </div>
            <div className="home-stat liked">
              <span className="home-stat-icon">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
              </span>
              <span className="home-stat-value">{likedCount}</span>
              <span className="home-stat-label">{t('views.home.statLiked', { n: likedCount })}</span>
            </div>
          </div>
        )}
      </header>

      {tracks.length === 0 || !heroTrack ? (
        <div className="home-empty">
          <div className="home-empty-icon"><MusicIcon /></div>
          <div className="home-empty-title">{t('views.home.emptyTitle')}</div>
          <div className="home-empty-text">{t('views.home.emptyText')}</div>
        </div>
      ) : (
        <>
          <section
            className={`home-hero ${isCurrent && isPlaying ? 'playing' : ''}`}
            style={tint ? ({ '--hero-tint': tint } as CSSProperties) : undefined}
          >
            <div className="home-hero-backdrop" aria-hidden="true">
              {heroTrack.cover && <img src={heroTrack.cover} alt="" />}
            </div>
            <div
              className="home-hero-cover"
              key={heroTrack.id}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setTextMenu(null)
                if (heroTrack.cover) {
                  setCoverMenu({ x: e.clientX, y: e.clientY, cover: heroTrack.cover, name: `${heroTrack.artist} - ${heroTrack.title}` })
                }
              }}
            >
              {heroTrack.cover ? <img src={heroTrack.cover} alt="" /> : <MusicIcon />}
            </div>
            <div className="home-hero-info" key={`i${heroTrack.id}`}>
              <div className="home-hero-label">
                {isCurrent && isPlaying && <span className="home-live-dot" />}
                {heroLabel}
              </div>
              <div
                className="home-hero-names"
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCoverMenu(null)
                  setTextMenu({ x: e.clientX, y: e.clientY, track: heroTrack })
                }}
              >
                <div className="home-hero-title" title={heroTrack.title}>{heroTrack.title}</div>
                <div className="home-hero-artist">{heroTrack.artist}</div>
              </div>
              {isCurrent && getPlayback ? (
                <HeroProgress getPlayback={getPlayback} />
              ) : (
                <div className="home-hero-hint">{heroTrack.album || heroTrack.duration}</div>
              )}
              <div className="home-hero-actions">
                <button
                  className="home-hero-play"
                  onClick={handleHeroPlay}
                  title={isCurrent && isPlaying ? t('layout.playerbar.pause') : t('layout.playerbar.play')}
                >
                  {isCurrent && isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button className="btn btn-glass" onClick={handleOpenNowPlaying}>
                  <ExpandIcon />
                  {t('views.home.expanded')}
                </button>
              </div>
            </div>
          </section>

          <RecentlyPlayedRow
            tracks={recentlyPlayed}
            onSelectTrack={onSelectTrack}
            playingTrackId={playingTrackId}
            allTracks={tracks}
            onContextMenu={openTrackMenu}
          />

          <section className="home-section">
            <div className="home-section-head">
              <h2 className="home-section-title">{t('views.home.recentlyAdded')}</h2>
            </div>
            <div className="home-list">
              {recentAdded.map((track, i) => (
                <button
                  key={track.id}
                  className={`home-list-item ${playingTrackId === track.id ? 'playing' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}
                  onClick={() => onSelectTrack(track, recentAdded)}
                  onContextMenu={(e) => openTrackMenu(e, track.id)}
                >
                  <span className="home-list-cover">
                    {track.cover ? <img src={track.cover} alt="" loading="lazy" decoding="async" /> : <MusicIcon />}
                    <span className="home-list-play"><PlayIcon /></span>
                  </span>
                  <span className="home-list-text">
                    <span className="home-list-title">{track.title}</span>
                    <span className="home-list-artist">{track.artist}</span>
                  </span>
                  <span className="home-list-dur">{track.duration}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      <TrackActions menu={trackMenu} tracks={tracks} playlists={playlists} {...actions} />
      <CoverMenu target={coverMenu} onClose={closeCoverMenu} />
      <TextCopyMenu target={textMenu} onClose={closeTextMenu} />
    </div>
  )
}
