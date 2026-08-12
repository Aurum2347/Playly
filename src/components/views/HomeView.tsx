import { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import './HomeView.css'

interface HomeViewProps {
  tracks: Track[]
  nickname?: string
  onSelectTrack: (track: Track, queue?: Track[]) => void
  lastPlayed?: Track | null
  playHistory?: Record<number, number>
  playingTrackId?: number | null
  isPlaying?: boolean
  onPlayToggle?: () => void
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" />
  </svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"> <polygon points="5 3 19 12 5 21" /> </svg>
)
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"> <rect x="6" y="4" width="4" height="16" /> <rect x="14" y="4" width="4" height="16" /> </svg>
)
const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <polyline points="15 18 9 12 15 6" /> </svg>
)
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <polyline points="9 18 15 12 9 6" /> </svg>
)

interface CardProps {
  track: Track
  index: number
  queue: Track[]
  onSelectTrack: (t: Track, q?: Track[]) => void
  playing?: boolean
  leaving?: boolean
  cardRef?: (el: HTMLDivElement | null) => void
}
function TrackCard({ track, index, queue, onSelectTrack, playing, leaving, cardRef }: CardProps) {
  return (
    <div
      ref={cardRef}
      className={`album-card ${playing ? 'playing' : ''} ${leaving ? 'leaving' : ''}`}
      style={leaving ? undefined : { animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={() => !leaving && onSelectTrack(track, queue)}
    >
      <div className="album-cover">
        {track.cover ? <img src={track.cover} alt="" /> : <MusicIcon />}
        <div className="album-cover-play"> <PlayIcon /> </div>
      </div>
      <div className="album-name">{track.title}</div>
      <div className="album-sub">{track.artist}</div>
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
    rowRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' })
  }
  return { rowRef, canLeft, canRight, scrollStep, sync }
}

function SectionHeader({ title, canLeft, canRight, onLeft, onRight, showButtons }: {
  title: string; canLeft: boolean; canRight: boolean; onLeft: () => void; onRight: () => void; showButtons: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="section-header">
      <div className="section-title">{title}</div>
      {showButtons && (
        <div className="scroll-buttons">
          <button className="scroll-btn" disabled={!canLeft} onClick={onLeft} title={t('views.home.back')}> <ChevronLeft /> </button>
          <button className="scroll-btn" disabled={!canRight} onClick={onRight} title={t('views.home.forward')}> <ChevronRight /> </button>
        </div>
      )}
    </div>
  )
}

interface PlayedRowProps {
  tracks: Track[]
  onSelectTrack: (t: Track, q?: Track[]) => void
  playingTrackId?: number | null
  allTracks: Track[]
}
function RecentlyPlayedRow({ tracks, onSelectTrack, playingTrackId, allTracks }: PlayedRowProps) {
  const { t } = useI18n()
  const { rowRef, canLeft, canRight, scrollStep, sync } = useRowScroll(tracks.length)
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const prevLefts = useRef(new Map<number, number>())
  const prevIdsRef = useRef<number[]>([])
  const byIdRef = useRef(new Map<number, Track>())
  const [leaving, setLeaving] = useState<Track[]>([])
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { allTracks.forEach((tr) => byIdRef.current.set(tr.id, tr)) }, [allTracks])

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
    <>
      <SectionHeader
        title={t('views.home.recentlyPlayed')}
        canLeft={canLeft} canRight={canRight}
        onLeft={() => scrollStep(-1)} onRight={() => scrollStep(1)}
        showButtons={tracks.length > 0}
      />
      {tracks.length === 0 ? (
        <div className="section-empty">{t('views.home.emptyPlayed')}</div>
      ) : (
        <div className={`row-wrapper ${!canLeft ? 'fade-left' : ''} ${!canRight ? 'fade-right' : ''}`}>
          <div className="albums-row" ref={rowRef}>
            {tracks.map((track, i) => (
              <TrackCard
                key={track.id}
                track={track} index={i} queue={tracks}
                onSelectTrack={onSelectTrack}
                playing={playingTrackId === track.id}
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
    </>
  )
}

interface SimpleRowProps {
  title: string
  tracks: Track[]
  onSelectTrack: (t: Track, q?: Track[]) => void
  playingTrackId?: number | null
}
function ScrollableRow({ title, tracks, onSelectTrack, playingTrackId }: SimpleRowProps) {
  const { t } = useI18n()
  const { rowRef, canLeft, canRight, scrollStep } = useRowScroll(tracks.length)
  return (
    <>
      <SectionHeader
        title={title}
        canLeft={canLeft} canRight={canRight}
        onLeft={() => scrollStep(-1)} onRight={() => scrollStep(1)}
        showButtons={tracks.length > 0}
      />
      {tracks.length === 0 ? (
        <div className="section-empty">{t('views.home.emptyRow')}</div>
      ) : (
        <div className={`row-wrapper ${!canLeft ? 'fade-left' : ''} ${!canRight ? 'fade-right' : ''}`}>
          <div className="albums-row" ref={rowRef}>
            {tracks.map((track, i) => (
              <TrackCard
                key={track.id}
                track={track} index={i} queue={tracks}
                onSelectTrack={onSelectTrack}
                playing={playingTrackId === track.id}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export default function HomeView({
  tracks, nickname, onSelectTrack, lastPlayed = null, playHistory = {},
  playingTrackId = null, isPlaying = false, onPlayToggle,
}: HomeViewProps) {
  const { t } = useI18n()

  const recentlyPlayed = useMemo(
    () =>
      tracks
        .filter((tr) => playHistory[tr.id])
        .sort((a, b) => (playHistory[b.id] || 0) - (playHistory[a.id] || 0))
        .slice(0, 10),
    [tracks, playHistory]
  )
  const recentAdded = useMemo(
    () => [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, 10),
    [tracks]
  )

  const isCurrentLast = !!lastPlayed && playingTrackId === lastPlayed.id
  const handleLastPlayClick = () => {
    if (!lastPlayed) return
    if (isCurrentLast) onPlayToggle?.()
    else onSelectTrack(lastPlayed, tracks)
  }

  const welcomeTpl = t('views.home.welcome', { name: '@@NAME@@' })
  const [welcomePre, welcomePost] = welcomeTpl.split('@@NAME@@')

  return (
    <div className="view active" id="view-home">
      <div className="page-title">
        {nickname ? (
          <>{welcomePre}<span style={{ color: '#a0a0ff' }}>{nickname}</span>{welcomePost}</>
        ) : (
          t('views.home.title')
        )}
      </div>
      {tracks.length === 0 ? (
        <div className="home-empty">
          <MusicIcon />
          <div className="home-empty-title">{t('views.home.emptyTitle')}</div>
          <div className="home-empty-text">{t('views.home.emptyText')}</div>
        </div>
      ) : (
        <>
          <div className="last-played">
            <div className="last-cover">
              {lastPlayed?.cover ? <img src={lastPlayed.cover} alt="" /> : <MusicIcon />}
            </div>
            <div className="last-info">
              <div className="last-label">{t('views.home.lastPlayed')}</div>
              <div className="last-title">{lastPlayed ? lastPlayed.title : t('views.home.nothingPlayed')}</div>
              <div className="last-artist">{lastPlayed ? lastPlayed.artist : t('views.home.chooseStart')}</div>
            </div>
            {lastPlayed && (
              <button
                className={`last-play-btn ${isCurrentLast && isPlaying ? 'playing' : ''}`}
                onClick={handleLastPlayClick}
                title={isCurrentLast && isPlaying ? t('layout.playerbar.pause') : t('layout.playerbar.play')}
              >
                {isCurrentLast && isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
            )}
          </div>
          <RecentlyPlayedRow
            tracks={recentlyPlayed}
            onSelectTrack={onSelectTrack}
            playingTrackId={playingTrackId}
            allTracks={tracks}
          />
          <ScrollableRow
            title={t('views.home.recentlyAdded')}
            tracks={recentAdded}
            onSelectTrack={onSelectTrack}
            playingTrackId={playingTrackId}
          />
        </>
      )}
    </div>
  )
}