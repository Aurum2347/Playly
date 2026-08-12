import { useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../../App'
import TrackEditModal from './TrackEditModal'
import type { TrackUpdates } from './TrackEditModal'
import { useI18n } from '../../i18n'
import './LikedView.css'
import './PlaylistView.css'

interface PlaylistViewProps {
  playlist: Playlist | null
  tracks: Track[]
  onSelectTrack: (track: Track, queue?: Track[]) => void
  playingTrackId?: number | null
  onToggleLike?: (trackId: number, liked: boolean) => void
  onRemoveFromPlaylist?: (playlistId: number, trackIds: number[]) => void
  onEditTrack?: (trackId: number, updates: TrackUpdates) => void
  onCopyTitle?: (trackId: number) => void
  onCopyArtist?: (trackId: number) => void
  onCopyTitleArtist?: (trackId: number) => void
  onCopyPath?: (trackId: number) => void
  onRevealInDir?: (trackId: number) => void
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export default function PlaylistView({
  playlist, tracks, onSelectTrack, playingTrackId = null, onToggleLike, onRemoveFromPlaylist,
  onEditTrack, onCopyTitle, onCopyArtist, onCopyTitleArtist, onCopyPath, onRevealInDir,
}: PlaylistViewProps) {
  const { t } = useI18n()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: number | null }>({ x: 0, y: 0, trackId: null })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [animatingLikeId, setAnimatingLikeId] = useState<number | null>(null)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [flashingTrackId, setFlashingTrackId] = useState<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    if (!playlist) return []
    const map = new Map(tracks.map((t) => [t.id, t]))
    return playlist.trackIds.map((id) => map.get(id)).filter(Boolean) as Track[]
  }, [playlist, tracks])

  const totalSec = useMemo(() => items.reduce((sum, t) => {
    const parts = t.duration.split(':')
    return sum + (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0)
  }, 0), [items])

  const formatTotal = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? t('views.liked.durHMin', { h, m }) : t('views.liked.durM', { m })
  }

  const openContextMenu = (e: React.MouseEvent, trackId: number) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320), trackId })
    setIsContextMenuOpen(true)
  }
  const closeContextMenu = () => { setIsContextMenuOpen(false); setContextMenu({ x: 0, y: 0, trackId: null }) }

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) closeContextMenu() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [])

  const toggleLike = (trackId: number) => {
    const tr = tracks.find((x) => x.id === trackId)
    if (!tr) return
    setAnimatingLikeId(trackId)
    window.setTimeout(() => setAnimatingLikeId((cur) => (cur === trackId ? null : cur)), 320)
    onToggleLike?.(trackId, !tr.liked)
  }

  const handleEditSave = (trackId: number, updates: TrackUpdates) => {
    if (Object.keys(updates).length === 0) return
    onEditTrack?.(trackId, updates)
    setFlashingTrackId(trackId)
    window.setTimeout(() => setFlashingTrackId((cur) => (cur === trackId ? null : cur)), 750)
  }

  const heartSVG = (filled: boolean) => filled ? (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  )

  const musicIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  )

  if (!playlist) {
    return (
      <div className="liked-view-container playlist-view">
        <div className="empty-state">
          <div className="empty-title">{t('views.playlist.notFound')}</div>
          <div className="empty-text">{t('views.playlist.notFoundText')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="liked-view-container playlist-view">
      <div className="hero">
        <div className="hero-top">
          {playlist.cover ? <img className="hero-cover-img" src={playlist.cover} alt="" /> : <div className="hero-icon">{musicIcon}</div>}
          <div className="hero-info">
            <div className="hero-label">{t('views.playlist.label')}</div>
            <h1 className="hero-title">{playlist.name}</h1>
            <div className="hero-meta">
              <div className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                <span>{t('views.tracks.totalTracks', { n: items.length })}</span>
              </div>
              <div className="hero-meta-dot"></div>
              <div className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span>{formatTotal(totalSec)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn-play-all" onClick={() => items.length > 0 && onSelectTrack(items[0], items)}>
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
            {t('views.playlist.playAll')}
          </button>
        </div>
      </div>
      <div className="track-list-container">
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">{t('views.playlist.emptyTitle')}</div>
            <div className="empty-text">{t('views.playlist.emptyText')}</div>
          </div>
        ) : (
          items.map((track, idx) => {
            const speed = track.playbackRate ?? 1
            return (
              <div
                key={track.id}
                className={cx('track-row', playingTrackId === track.id && 'playing', flashingTrackId === track.id && 'flash')}
                style={{ animationDelay: `${Math.min(idx * 25, 400)}ms` }}
                onClick={() => onSelectTrack(track, items)}
                onContextMenu={(e) => openContextMenu(e, track.id)}
              >
                <span className={`tr-playing-bar ${playingTrackId === track.id ? 'active' : ''}`} aria-hidden="true" />
                <span className="tr-num">{idx + 1}</span>
                <div className="tr-info">
                  <div className="tr-cover">{track.cover ? <img src={track.cover} alt="" /> : musicIcon}</div>
                  <div className="tr-text">
                    <div className="tr-title">{track.title}</div>
                    <div className="tr-artist">{track.artist}</div>
                  </div>
                </div>
                <span className="tr-dur">
                  {speed !== 1 && <span className="speed-badge">{String(Math.round(speed * 100) / 100)}×</span>}
                  {track.duration}
                </span>
                <button
                  className={cx('tr-like-btn', track.liked && 'liked', animatingLikeId === track.id && 'pop')}
                  onClick={(e) => { e.stopPropagation(); toggleLike(track.id) }}
                  title={track.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}
                >
                  {heartSVG(!!track.liked)}
                </button>
                <button className="tr-menu-btn" onClick={(e) => openContextMenu(e, track.id)} title={t('common.more')}>
                  <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                </button>
              </div>
            )
          })
        )}
      </div>
      {isContextMenuOpen && createPortal(
        <div ref={contextMenuRef} className="context-menu open" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) setEditingTrack(tracks.find((x) => x.id === id) ?? null) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            {t('common.edit')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) onCopyTitle?.(id) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
            {t('layout.playerbar.copyTitle')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) onCopyArtist?.(id) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            {t('layout.playerbar.copyArtist')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) onCopyTitleArtist?.(id) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></svg>
            {t('layout.playerbar.copyBoth')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) onCopyPath?.(id) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
            {t('views.playlist.copyPath')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) onRevealInDir?.(id) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
            {t('views.playlist.reveal')}
          </button>
          <div className="dropdown-divider"></div>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) toggleLike(id) }}>
            {heartSVG(false)}
            {contextMenu.trackId !== null && tracks.find((x) => x.id === contextMenu.trackId)?.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}
          </button>
          <div className="dropdown-divider"></div>
          <button className="context-item danger" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null && playlist) onRemoveFromPlaylist?.(playlist.id, [id]) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            {t('views.playlist.remove')}
          </button>
        </div>,
        document.body
      )}
      <TrackEditModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={handleEditSave} />
    </div>
  )
}