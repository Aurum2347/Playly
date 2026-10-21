import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import CoverMenu from '../CoverMenu'
import type { CoverMenuTarget } from '../CoverMenu'
import { usePresence } from '../views/shared'
import './PlayerBar.css'

interface PlayerBarProps {
  track: Track | null
  isPlaying: boolean
  onPlayToggle: () => void
  currentTime?: number
  duration?: number
  volume?: number
  isMuted?: boolean
  onVolumeChange?: (v: number) => void
  onMuteToggle?: () => void
  onSeek?: (t: number) => void
  onNext?: () => void
  onPrev?: () => void
  isShuffle?: boolean
  repeatMode?: 'off' | 'all' | 'one'
  onShuffleToggle?: () => void
  onRepeatToggle?: () => void
  isLiked?: boolean
  onToggleLike?: (id: number, liked: boolean) => void
  onCopyTitle?: () => void
  onCopyArtist?: () => void
  onCopyTitleArtist?: () => void
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function PlayerBar({
  track,
  isPlaying,
  onPlayToggle,
  currentTime = 0,
  duration = 0,
  volume = 100,
  isMuted = false,
  onVolumeChange,
  onMuteToggle,
  onSeek,
  onNext,
  onPrev,
  isShuffle = false,
  repeatMode = 'off',
  onShuffleToggle,
  onRepeatToggle,
  isLiked = false,
  onToggleLike,
  onCopyTitle,
  onCopyArtist,
  onCopyTitleArtist,
}: PlayerBarProps) {
  const { t } = useI18n()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  /* Последняя позиция меню остаётся, пока проигрывается анимация закрытия */
  const [ctxShown, setCtxShown] = useState(ctxMenu)
  if (ctxMenu && ctxMenu !== ctxShown) setCtxShown(ctxMenu)
  const ctxPresence = usePresence(ctxMenu !== null)
  const [coverMenu, setCoverMenu] = useState<CoverMenuTarget | null>(null)
  const closeCoverMenu = useCallback(() => setCoverMenu(null), [])
  const ctxRef = useRef<HTMLDivElement>(null)
  const progressWrapRef = useRef<HTMLDivElement>(null)
  const volWrapRef = useRef<HTMLDivElement>(null)
  const [dragProgress, setDragProgress] = useState(false)
  const [dragVolume, setDragVolume] = useState(false)

  const [shownTrack, setShownTrack] = useState<Track | null>(track)
  const [leavingTrack, setLeavingTrack] = useState<Track | null>(null)
  const shownRef = useRef<Track | null>(track)
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!track) {
      shownRef.current = null
      setShownTrack(null)
      setLeavingTrack(null)
      return
    }
    const prev = shownRef.current
    if (prev && prev.id !== track.id) {
      setLeavingTrack(prev)
      if (swapTimerRef.current) clearTimeout(swapTimerRef.current)
      swapTimerRef.current = setTimeout(() => setLeavingTrack(null), 340)
    }
    shownRef.current = track
    setShownTrack(track)
  }, [track])

  useEffect(() => {
    return () => {
      if (swapTimerRef.current) clearTimeout(swapTimerRef.current)
    }
  }, [])

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  useEffect(() => {
    if (!ctxMenu) return
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const openCtx = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    /* В поле громкости оставляем системное меню (вставка и т.п.) */
    if (target.tagName === 'INPUT') return
    e.preventDefault()
    e.stopPropagation()
    if (target.closest('.p-cover')) {
      setCtxMenu(null)
      if (shownTrack?.cover) {
        setCoverMenu({ x: e.clientX, y: e.clientY, cover: shownTrack.cover, name: `${shownTrack.artist} - ${shownTrack.title}` })
      }
      return
    }
    if (!target.classList.contains('p-name') && !target.classList.contains('p-artist')) return
    setCoverMenu(null)
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 140),
    })
  }

  /* ===== Drag прогресса ===== */
  const seekToX = useCallback(
    (clientX: number) => {
      const wrap = progressWrapRef.current
      if (!wrap || !onSeek || duration <= 0) return
      const rect = wrap.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
      onSeek((x / rect.width) * duration)
    },
    [onSeek, duration]
  )


  const volumeToX = useCallback(
    (clientX: number) => {
      const wrap = volWrapRef.current
      if (!wrap || !onVolumeChange) return
      const rect = wrap.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
      onVolumeChange(Math.max(0, Math.min(100, Math.round((x / rect.width) * 100))))
    },
    [onVolumeChange]
  )

  const handleProgressDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || duration <= 0) return
    e.preventDefault()
    seekToX(e.clientX)
    setDragProgress(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {

    }
  }

  const handleVolumeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onVolumeChange) return
    e.preventDefault()
    volumeToX(e.clientX)
    setDragVolume(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {

    }
  }

  useEffect(() => {
    if (!dragProgress && !dragVolume) return
    const onMove = (e: PointerEvent) => {
      if (dragProgress) seekToX(e.clientX)
      if (dragVolume) volumeToX(e.clientX)
    }
    const onUp = () => {
      setDragProgress(false)
      setDragVolume(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragProgress, dragVolume, seekToX, volumeToX])

  const volIcon =
    isMuted || volume === 0 ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        {volume > 50 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
      </svg>
    )


  const renderLayer = (tr: Track) => (
    <>
      <div className="p-cover">
        {tr.cover ? (
          <img src={tr.cover} alt="" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
      </div>
      <div className="p-info">
        <div className="p-name">{tr.title}</div>
        <div className="p-artist">{tr.artist}</div>
      </div>
    </>
  )


  if (!track) {
    return (
      <div className="player empty">
        <div className="p-track">
          <div className="p-track-layer">
            <div className="p-cover">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div className="p-info">
              <div className="p-name empty">{t('layout.playerbar.nothingPlaying')}</div>
              <div className="p-artist">{t('layout.playerbar.chooseTrack')}</div>
            </div>
          </div>
        </div>
        <div className="p-center">
          <div className="p-controls">
            <button className="p-btn" disabled title={t('layout.playerbar.shuffle')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"> <polyline points="16 3 21 3 21 8" /> <line x1="4" y1="20" x2="21" y2="3" /> <polyline points="21 16 21 21 16 21" /> <line x1="15" y1="15" x2="21" y2="21" /> <line x1="4" y1="4" x2="9" y2="9" /> </svg>
            </button>
            <button className="p-btn" disabled title={t('layout.playerbar.prev')}>
              <svg viewBox="0 0 24 24" fill="currentColor"> <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /> </svg>
            </button>
            <button className="p-play" disabled title={t('layout.playerbar.play')}>
              <svg viewBox="0 0 24 24" fill="currentColor"> <polygon points="5 3 19 12 5 21" /> </svg>
            </button>
            <button className="p-btn" disabled title={t('layout.playerbar.next')}>
              <svg viewBox="0 0 24 24" fill="currentColor"> <path d="M16 6h2v12h-2zm-3.5 6L4 6v12z" /> </svg>
            </button>
            <button className="p-btn" disabled title={t('layout.playerbar.repeat')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"> <polyline points="17 1 21 5 17 9" /> <path d="M3 11V9a4 4 0 0 1 4-4h14" /> <polyline points="7 23 3 19 7 15" /> <path d="M21 13v2a4 4 0 0 1-4 4H3" /> </svg>
            </button>
          </div>
          <div className="p-progress">
            <span className="p-time">0:00</span>
            <div className="p-bar-wrapper disabled">
              <div className="p-bar">
                <div className="p-bar-fill" style={{ width: '0%' }}>
                  <div className="p-bar-thumb"></div>
                </div>
              </div>
            </div>
            <span className="p-time">0:00</span>
          </div>
        </div>
        <div className="p-right">
          <button className="p-like-btn" disabled title={t('layout.playerbar.likeAdd')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <div className="p-vol">
            <button
              className="p-vol-btn"
              onClick={onMuteToggle}
              title={isMuted ? t('layout.playerbar.muteOff') : t('layout.playerbar.muteOn')}
            >
              {volIcon}
            </button>
            <div className="p-vol-bar-wrapper disabled">
              <div className="p-vol-bar">
                <div className="p-vol-fill" style={{ width: `${isMuted ? 0 : volume}%` }}>
                  <div className="p-vol-thumb"></div>
                </div>
              </div>
            </div>
            <input
              type="number"
              className="p-vol-input"
              min={0}
              max={100}
              value={isMuted ? 0 : volume}
              disabled
              title={t('layout.playerbar.volume')}
            />
          </div>
        </div>
      </div>
    )
  }


  return (
    <div className="player" onContextMenu={openCtx}>
      <div className="p-track">
        {leavingTrack && (
          <div className="p-track-layer out">{renderLayer(leavingTrack)}</div>
        )}
        <div className="p-track-layer in" key={shownTrack?.id ?? 'none'}>
          {shownTrack ? renderLayer(shownTrack) : null}
        </div>
        <div className={`eq-mini ${isPlaying ? '' : 'paused'}`}>
          <div className="eq-mini-bar"></div>
          <div className="eq-mini-bar"></div>
          <div className="eq-mini-bar"></div>
          <div className="eq-mini-bar"></div>
        </div>
      </div>
      <div className="p-center">
        <div className="p-controls">
          <button className={`p-btn ${isShuffle ? 'active' : ''}`} onClick={onShuffleToggle} title={t('layout.playerbar.shuffle')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"> <polyline points="16 3 21 3 21 8" /> <line x1="4" y1="20" x2="21" y2="3" /> <polyline points="21 16 21 21 16 21" /> <line x1="15" y1="15" x2="21" y2="21" /> <line x1="4" y1="4" x2="9" y2="9" /> </svg>
          </button>
          <button className="p-btn" onClick={onPrev} title={t('layout.playerbar.prev')}>
            <svg viewBox="0 0 24 24" fill="currentColor"> <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /> </svg>
          </button>
          <button className="p-play" onClick={onPlayToggle} title={isPlaying ? t('layout.playerbar.pause') : t('layout.playerbar.play')}>
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor"> <rect x="6" y="4" width="4" height="16" /> <rect x="14" y="4" width="4" height="16" /> </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor"> <polygon points="5 3 19 12 5 21" /> </svg>
            )}
          </button>
          <button className="p-btn" onClick={onNext} title={t('layout.playerbar.next')}>
            <svg viewBox="0 0 24 24" fill="currentColor"> <path d="M16 6h2v12h-2zm-3.5 6L4 6v12z" /> </svg>
          </button>
          <button className={`p-btn ${repeatMode !== 'off' ? 'active' : ''}`} onClick={onRepeatToggle} title={t('layout.playerbar.repeat')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"> <polyline points="17 1 21 5 17 9" /> <path d="M3 11V9a4 4 0 0 1 4-4h14" /> <polyline points="7 23 3 19 7 15" /> <path d="M21 13v2a4 4 0 0 1-4 4H3" /> </svg>
            {repeatMode === 'one' && (
              <span style={{ position: 'absolute', fontSize: 8, color: '#fff', fontWeight: 700 }}>1</span>
            )}
          </button>
        </div>
        <div className="p-progress">
          <span className="p-time">{fmt(currentTime)}</span>
          <div
            ref={progressWrapRef}
            className={`p-bar-wrapper ${dragProgress ? 'dragging' : ''}`}
            onPointerDown={handleProgressDown}
          >
            <div className="p-bar">
              <div className="p-bar-fill" style={{ width: `${progress}%` }}>
                <div className="p-bar-thumb"></div>
              </div>
            </div>
          </div>
          <span className="p-time">{fmt(duration)}</span>
        </div>
      </div>
      <div className="p-right">
        <button
          className={`p-like-btn ${isLiked ? 'liked' : ''}`}
          onClick={() => onToggleLike?.(track.id, !isLiked)}
          title={isLiked ? t('layout.playerbar.likeRemove') : t('layout.playerbar.likeAdd')}
        >
          <svg viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
        <div className="p-vol">
          <button
            className="p-vol-btn"
            onClick={onMuteToggle}
            title={isMuted ? t('layout.playerbar.muteOff') : t('layout.playerbar.muteOn')}
          >
            {volIcon}
          </button>
          <div
            ref={volWrapRef}
            className={`p-vol-bar-wrapper ${dragVolume ? 'dragging' : ''}`}
            onPointerDown={handleVolumeDown}
          >
            <div className="p-vol-bar">
              <div className="p-vol-fill" style={{ width: `${isMuted ? 0 : volume}%` }}>
                <div className="p-vol-thumb"></div>
              </div>
            </div>
          </div>
          <input
            type="number"
            className="p-vol-input"
            min={0}
            max={100}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return
              const v = Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
              onVolumeChange?.(v)
            }}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                onVolumeChange?.(Math.min(100, volume + 5))
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                onVolumeChange?.(Math.max(0, volume - 5))
              }
            }}
            title={t('layout.playerbar.volume')}
          />
        </div>
      </div>
      <CoverMenu target={coverMenu} onClose={closeCoverMenu} />
      {ctxPresence.mounted && ctxShown &&
        createPortal(
          <div
            ref={ctxRef}
            className={`player-context-menu ${ctxPresence.closing ? 'closing' : ''}`}
            style={{ left: ctxShown.x, top: ctxShown.y }}
          >
            <button
              className="player-context-item"
              onClick={() => {
                onCopyTitle?.()
                setCtxMenu(null)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /> <rect x="9" y="3" width="6" height="4" rx="1" /> </svg>
              {t('layout.playerbar.copyTitle')}
            </button>
            <button
              className="player-context-item"
              onClick={() => {
                onCopyArtist?.()
                setCtxMenu(null)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /> </svg>
              {t('layout.playerbar.copyArtist')}
            </button>
            <button
              className="player-context-item"
              onClick={() => {
                onCopyTitleArtist?.()
                setCtxMenu(null)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <rect x="8" y="2" width="8" height="4" rx="1" /> <line x1="9" y1="12" x2="15" y2="12" /> <line x1="9" y1="16" x2="13" y2="16" /> </svg>
              {t('layout.playerbar.copyBoth')}
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}