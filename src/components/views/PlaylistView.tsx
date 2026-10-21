import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../../App'
import TrackEditModal from './TrackEditModal'
import TrackDetailsModal from './TrackDetailsModal'
import type { TrackUpdates } from './TrackEditModal'
import { useI18n } from '../../i18n'
import { cx, inlineButton, inlineInput, inlineRow, parseDuration, useContextMenu } from './shared'
import './LikedView.css'
import './PlaylistView.css'

interface PlaylistViewProps {
  playlist: Playlist | null
  tracks: Track[]
  playlists: Playlist[]
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
  onAddToPlaylist?: (trackIds: number[], playlistId: number) => void
  onCreatePlaylist?: (name: string) => number | void
}

export default function PlaylistView({
  playlist, playlists, tracks, onSelectTrack, playingTrackId = null, onToggleLike, onRemoveFromPlaylist,
  onEditTrack, onCopyTitle, onCopyArtist, onCopyPath, onRevealInDir,
  onAddToPlaylist, onCreatePlaylist,
}: PlaylistViewProps) {
  const { t } = useI18n()
  const contextMenu = useContextMenu<number>()
  const [animatingLikeId, setAnimatingLikeId] = useState<number | null>(null)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [detailsTrackId, setDetailsTrackId] = useState<number | null>(null)
  const [flashingTrackId, setFlashingTrackId] = useState<number | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set())

  const items = useMemo(() => {
    if (!playlist) return []
    const map = new Map(tracks.map((t) => [t.id, t]))
    return playlist.trackIds.map((id) => map.get(id)).filter(Boolean) as Track[]
  }, [playlist, tracks])

  const totalSec = useMemo(() => items.reduce((sum, t) => sum + parseDuration(t.duration), 0), [items])

  const formatTotal = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? t('views.liked.durHMin', { h, m }) : t('views.liked.durM', { m })
  }

  const contextTrack = contextMenu.target !== null ? tracks.find((x) => x.id === contextMenu.target) ?? null : null
  const detailsTrack = detailsTrackId !== null ? tracks.find((x) => x.id === detailsTrackId) ?? null : null
  /* Добавлять трек в тот же плейлист, где он уже лежит, бессмысленно */
  const otherPlaylists = playlists.filter((pl) => pl.id !== playlist?.id)

  const openContextMenu = contextMenu.open
  const closeContextMenu = contextMenu.close

  const runContextAction = (action: (id: number) => void) => {
    const id = contextMenu.target
    closeContextMenu()
    if (id !== null) action(id)
  }

  const toggleLike = (trackId: number) => {
    const tr = tracks.find((x) => x.id === trackId)
    if (!tr) return
    setAnimatingLikeId(trackId)
    window.setTimeout(() => setAnimatingLikeId((cur) => (cur === trackId ? null : cur)), 320)
    onToggleLike?.(trackId, !tr.liked)
  }

  const toggleSelection = (trackId: number) => {
    const next = new Set(selectedTrackIds)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    setSelectedTrackIds(next)
    if (next.size === 0) setSelectionMode(false)
  }
  const enterSelectionMode = (trackId: number) => { setSelectionMode(true); setSelectedTrackIds(new Set([trackId])) }
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedTrackIds(new Set()) }

  const handleEditSave = (trackId: number, updates: TrackUpdates) => {
    if (Object.keys(updates).length === 0) return
    onEditTrack?.(trackId, updates)
    setFlashingTrackId(trackId)
    window.setTimeout(() => setFlashingTrackId((cur) => (cur === trackId ? null : cur)), 750)
  }

  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [playlistTargetIds, setPlaylistTargetIds] = useState<number[]>([])
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [playlistScrollPos, setPlaylistScrollPos] = useState<'top' | 'middle' | 'bottom'>('top')
  const handlePlaylistScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atTop = el.scrollTop <= 0
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    setPlaylistScrollPos(atTop ? 'top' : atBottom ? 'bottom' : 'middle')
  }

  const openPlaylistModal = (ids: number[]) => {
    if (ids.length === 0) return
    setPlaylistTargetIds(ids)
    setSelectedPlaylistId(null)
    setNewPlaylistName('')
    setPlaylistScrollPos('top')
    setIsPlaylistModalOpen(true)
  }
  const closePlaylistModal = () => setIsPlaylistModalOpen(false)
  const createAndSelect = () => {
    const name = newPlaylistName.trim()
    if (!name || !onCreatePlaylist) return
    const id = onCreatePlaylist(name)
    if (typeof id === 'number') setSelectedPlaylistId(id)
    setNewPlaylistName('')
  }
  const handlePlaylistConfirm = () => {
    if (selectedPlaylistId === null) return
    onAddToPlaylist?.(playlistTargetIds, selectedPlaylistId)
    closePlaylistModal()
    if (selectionMode) exitSelectionMode()
  }

  const { ref: contextMenuRef, isOpen: isContextMenuOpen } = contextMenu
  const selectedCount = selectedTrackIds.size
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) closeContextMenu() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isPlaylistModalOpen) setIsPlaylistModalOpen(false)
      else if (isContextMenuOpen) closeContextMenu()
      else if (selectionMode || selectedCount > 0) { setSelectionMode(false); setSelectedTrackIds(new Set()) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [isPlaylistModalOpen, isContextMenuOpen, selectionMode, selectedCount, closeContextMenu, contextMenuRef])

  const heartSVG = (filled: boolean) => filled ? (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  )

  const musicIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" > <path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" /> </svg>
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
          {playlist.cover ? <img className="hero-cover-img" src={playlist.cover} alt="" /> : <div className="hero-icon">{musicIconSVG}</div>}
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
          <div className={`selection-actions ${selectedTrackIds.size > 0 ? 'visible' : ''}`}>
            <button className="btn btn-danger" onClick={() => { if (playlist) { onRemoveFromPlaylist?.(playlist.id, Array.from(selectedTrackIds)); exitSelectionMode() } }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
              {t('views.tracks.deleteSelected', { n: selectedTrackIds.size })}
            </button>
            <button className="btn" onClick={() => { openPlaylistModal(Array.from(selectedTrackIds)); exitSelectionMode() }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
              {t('views.tracks.addToPlaylist')}
            </button>
          </div>
        </div>
      </div>
      <div className={`track-list-container ${selectionMode ? 'selecting' : ''}`}>
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
                className={cx('track-row', selectedTrackIds.has(track.id) && 'selected', playingTrackId === track.id && 'playing', flashingTrackId === track.id && 'flash')}
                style={{ animationDelay: `${Math.min(idx * 25, 400)}ms` }}
                onClick={() => (selectionMode ? toggleSelection(track.id) : onSelectTrack(track, items))}
                onContextMenu={(e) => openContextMenu(e, track.id)}
              >
                <span className={`tr-playing-bar ${playingTrackId === track.id ? 'active' : ''}`} aria-hidden="true" />
                <span className="tr-num">{idx + 1}</span>
                <div className={`tr-checkbox ${selectedTrackIds.has(track.id) ? 'checked' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelection(track.id) }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div className="tr-info">
                  <div className="tr-cover">{track.cover ? <img src={track.cover} alt="" /> : musicIconSVG}</div>
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
      {createPortal(
        <div ref={contextMenuRef} className={cx('context-menu', isContextMenuOpen && 'open', contextMenu.isMeasuring && 'measuring')} style={{ left: contextMenu.pos.x, top: contextMenu.pos.y }}>
          <button className="context-item" onClick={() => runContextAction(enterSelectionMode)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            {t('views.tracks.ctxSelect')}
          </button>
          <button className="context-item" onClick={() => runContextAction((id) => setEditingTrack(tracks.find((x) => x.id === id) ?? null))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            {t('common.edit')}
          </button>
          <button className="context-item" onClick={() => runContextAction((id) => openPlaylistModal([id]))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
            {t('views.tracks.addToPlaylist')}
          </button>
          <div className="dropdown-divider"></div>
          
          {/* ЕДИНСТВЕННАЯ КНОПКА "ПОДРОБНЕЕ" */}
          <button className="context-item" onClick={() => runContextAction(setDetailsTrackId)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            {t('common.details')}
          </button>
          
          <div className="dropdown-divider"></div>
          <button className="context-item" onClick={() => runContextAction(toggleLike)}>
            {heartSVG(!!contextTrack?.liked)}
            {contextTrack?.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}
          </button>
          <div className="dropdown-divider"></div>
          <button className="context-item danger" onClick={() => runContextAction((id) => onRemoveFromPlaylist?.(playlist.id, [id]))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            {t('views.playlist.remove')}
          </button>
        </div>,
        document.body
      )}

      {isPlaylistModalOpen && createPortal(
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && closePlaylistModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('views.tracks.playlistModalTitle')}</div>
            <div className="modal-subtitle">{t('views.tracks.playlistModalSubtitle')}</div>
            <div className={`playlist-list-wrapper ${playlistScrollPos === 'top' ? 'scrolled-top' : ''} ${playlistScrollPos === 'bottom' ? 'scrolled-bottom' : ''}`}>
              <div className="playlist-list-fade-top" />
              <div className="playlist-list" style={{ position: 'relative' }} onScroll={handlePlaylistScroll}>
                {otherPlaylists.length === 0 ? (
                  <div className="empty-state">{t('views.tracks.noPlaylists')}</div>
                ) : (
                  otherPlaylists.map((pl) => (
                    <div key={pl.id} className={`playlist-item ${selectedPlaylistId === pl.id ? 'selected' : ''}`} onClick={() => setSelectedPlaylistId(pl.id)}>
                      <div className="playlist-cover">{pl.cover ? <img src={pl.cover} alt="" /> : musicIconSVG}</div>
                      <div className="playlist-info">
                        <div className="playlist-name">{pl.name}</div>
                        <div className="playlist-count">{t('views.tracks.totalTracks', { n: pl.trackIds.length })}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="playlist-list-fade-bottom" />
            </div>
            {onCreatePlaylist && (
              <div style={inlineRow}>
                <input
                  style={inlineInput}
                  placeholder={t('views.tracks.newPlaylist')}
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createAndSelect() } }}
                />
                <button
                  style={inlineButton}
                  onClick={createAndSelect}
                  disabled={!newPlaylistName.trim()}
                >
                  {t('common.create')}
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={closePlaylistModal}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handlePlaylistConfirm}
                disabled={selectedPlaylistId === null}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      <TrackEditModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={handleEditSave} />
      
      <TrackDetailsModal 
        track={detailsTrack} 
        onClose={() => setDetailsTrackId(null)}
        onCopyTitle={onCopyTitle}
        onCopyArtist={onCopyArtist}
        onCopyPath={onCopyPath}
        onRevealInDir={onRevealInDir}
      />
    </div>
  )
}