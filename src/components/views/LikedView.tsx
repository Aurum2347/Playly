import { useState, useRef, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../../App'
import TrackEditModal from './TrackEditModal'
import type { TrackUpdates } from './TrackEditModal'
import { useI18n } from '../../i18n'
import './LikedView.css'

interface LikedViewProps {
  tracks: Track[]
  playlists: Playlist[]
  onSelectTrack: (track: Track, queue?: Track[]) => void
  playingTrackId?: number | null
  onToggleLike?: (trackId: number, liked: boolean) => void
  onDeleteTracks?: (trackIds: number[]) => void
  onAddToPlaylist?: (trackIds: number[], playlistId: number) => void
  onCreatePlaylist?: (name: string) => number | void
  onEditTrack?: (trackId: number, updates: TrackUpdates) => void
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

const inlineRow: CSSProperties = { display: 'flex', gap: 8, marginBottom: 16 }
const inlineInput: CSSProperties = {
  flex: 1, minWidth: 0, padding: '9px 12px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, color: '#f0f0f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
}

export default function LikedView({
  tracks, playlists, onSelectTrack, playingTrackId = null,
  onToggleLike, onDeleteTracks, onAddToPlaylist, onCreatePlaylist, onEditTrack,
}: LikedViewProps) {
  const { t, lang } = useI18n()

  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set())
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [currentSort, setCurrentSort] = useState('date-new')
  const [shuffleActive, setShuffleActive] = useState(false)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackId: number | null }>({ x: 0, y: 0, trackId: null })
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [playlistTargetIds, setPlaylistTargetIds] = useState<number[]>([])
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [animatingLikeId, setAnimatingLikeId] = useState<number | null>(null)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [flashingTrackId, setFlashingTrackId] = useState<number | null>(null)

  const sortMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const parseDuration = (dur: string) => {
    const parts = dur.split(':')
    return parseInt(parts[0]) * 60 + parseInt(parts[1])
  }

  const formatTotalDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return t('views.liked.durHMin', { h, m })
    return t('views.liked.durM', { m })
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return t('views.liked.justNow')
    if (diff < 3600000) return t('views.liked.minAgo', { n: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('views.liked.hAgo', { n: Math.floor(diff / 3600000) })
    if (diff < 604800000) return t('views.liked.dAgo', { n: Math.floor(diff / 86400000) })
    return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })
  }

  const likedTracks = tracks.filter((t) => !deletedIds.has(t.id))
  const totalSec = likedTracks.reduce((sum, t) => sum + parseDuration(t.duration), 0)
  const latest = likedTracks.length
    ? likedTracks.reduce((max, t) => ((t.likedAt || 0) > (max.likedAt || 0) ? t : max))
    : null

 
  const sortedTracks = useMemo(() => {
    const arr = [...likedTracks]
    if (shuffleActive) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }
    switch (currentSort) {
      case 'name-az': arr.sort((a, b) => a.title.localeCompare(b.title)); break
      case 'name-za': arr.sort((a, b) => b.title.localeCompare(a.title)); break
      case 'dur-desc': arr.sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration)); break
      case 'dur-asc': arr.sort((a, b) => parseDuration(a.duration) - parseDuration(b.duration)); break
      case 'date-new': arr.sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0)); break
      case 'date-old': arr.sort((a, b) => (a.likedAt || 0) - (b.likedAt || 0)); break
    }
    return arr
    
  }, [likedTracks, shuffleActive, currentSort])

  const q = searchQuery.trim().toLowerCase()
  const filteredTracks = q
    ? sortedTracks.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
    : sortedTracks

  const applyLike = (trackId: number, next: boolean) => {
    setAnimatingLikeId(trackId)
    window.setTimeout(() => setAnimatingLikeId((cur) => (cur === trackId ? null : cur)), 320)
    onToggleLike?.(trackId, next)
  }

  const unlikeAnimated = (trackId: number) => {
    if (removingIds.has(trackId)) return
    setRemovingIds((prev) => new Set(prev).add(trackId))
    window.setTimeout(() => {
      applyLike(trackId, false)
      setRemovingIds((prev) => { const n = new Set(prev); n.delete(trackId); return n })
    }, 220)
  }

  const toggleSelection = (trackId: number) => {
    setSelectedTrackIds((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      if (selectionMode && next.size === 0) setSelectionMode(false)
      return next
    })
  }

  const enterSelectionMode = (trackId: number) => { setSelectionMode(true); setSelectedTrackIds(new Set([trackId])) }
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedTrackIds(new Set()) }

  const handleUnlikeSelected = () => {
    if (selectedTrackIds.size === 0) return
    Array.from(selectedTrackIds).forEach((id) => unlikeAnimated(id))
    exitSelectionMode()
  }

  const deleteTracks = (ids: number[]) => {
    if (ids.length === 0) return
    setDeletedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n })
    onDeleteTracks?.(ids)
  }

  const handleSort = (sort: string) => { setCurrentSort(sort); setShuffleActive(false); setIsSortMenuOpen(false) }
  const handleShuffle = () => { setShuffleActive(!shuffleActive); setCurrentSort(!shuffleActive ? 'shuffle' : 'date-new') }

  const openContextMenu = (e: React.MouseEvent, trackId: number) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 220)
    const y = Math.min(e.clientY, window.innerHeight - 240)
    setContextMenu({ x, y, trackId })
    setIsContextMenuOpen(true)
  }
  const closeContextMenu = () => { setIsContextMenuOpen(false); setContextMenu({ x: 0, y: 0, trackId: null }) }

  const handleEditSave = (trackId: number, updates: TrackUpdates) => {
    if (Object.keys(updates).length === 0) return
    onEditTrack?.(trackId, updates)
    setFlashingTrackId(trackId)
    window.setTimeout(() => setFlashingTrackId((cur) => (cur === trackId ? null : cur)), 750)
  }

  const openPlaylistModal = (ids: number[]) => {
    if (ids.length === 0) return
    setPlaylistTargetIds(ids)
    setSelectedPlaylistId(null)
    setNewPlaylistName('')
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

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (sortMenuRef.current && !sortMenuRef.current.contains(target)) setIsSortMenuOpen(false)
      if (contextMenuRef.current && !contextMenuRef.current.contains(target)) closeContextMenu()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isPlaylistModalOpen) closePlaylistModal()
      else if (isContextMenuOpen) closeContextMenu()
      else if (isSortMenuOpen) setIsSortMenuOpen(false)
      else if (selectionMode) exitSelectionMode()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isPlaylistModalOpen, isContextMenuOpen, isSortMenuOpen, selectionMode])

  const heartFilledSVG = (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  )

  const musicIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" />
    </svg>
  )

  return (
    <div className="liked-view-container">
      <div className="hero">
        <div className="hero-top">
          <div className="hero-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </div>
          <div className="hero-info">
            <div className="hero-label">{t('views.liked.collection')}</div>
            <h1 className="hero-title">{t('views.liked.title')}</h1>
            <div className="hero-meta">
              <div className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">  <path d="M9 18V5l12-2v13" />  <circle cx="6" cy="18" r="3" />  <circle cx="18" cy="16" r="3" />  </svg>
                <span key={`c${likedTracks.length}`} className="meta-anim">{t('views.tracks.totalTracks', { n: likedTracks.length })}</span>
              </div>
              <div className="hero-meta-dot"></div>
              <div className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">  <circle cx="12" cy="12" r="10" />  <polyline points="12 6 12 12 16 14" />  </svg>
                <span key={`d${totalSec}`} className="meta-anim">{formatTotalDuration(totalSec)}</span>
              </div>
              <div className="hero-meta-dot"></div>
              <div className="hero-meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">  <rect x="3" y="4" width="18" height="18" rx="2" />  <line x1="16" y1="2" x2="16" y2="6" />  <line x1="8" y1="2" x2="8" y2="6" />  <line x1="3" y1="10" x2="21" y2="10" />  </svg>
                <span key={`u${latest?.likedAt || 0}`} className="meta-anim">{latest ? formatDate(latest.likedAt || 0) : t('views.liked.notAdded')}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <button className="btn-play-all" onClick={() => sortedTracks.length > 0 && onSelectTrack(sortedTracks[0], sortedTracks)}>
            <svg viewBox="0 0 24 24" fill="currentColor">  <polygon points="6,3 20,12 6,21" />  </svg>
            {t('views.liked.playAll')}
          </button>
          <button className={`btn-shuffle ${shuffleActive ? 'active' : ''}`} onClick={handleShuffle} title={t('views.liked.shuffle')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="16 3 21 3 21 8" />  <line x1="4" y1="20" x2="21" y2="3" />  <polyline points="21 16 21 21 16 21" />  <line x1="15" y1="15" x2="21" y2="21" />  <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>
        </div>
      </div>

      <div className="view-header">
        <div className="header-actions">
          {selectedTrackIds.size > 0 && (
            <div className="selection-actions visible">
              <button className="btn btn-danger" onClick={handleUnlikeSelected}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                </svg>
                {t('views.liked.unlikeSelected', { n: selectedTrackIds.size })}
              </button>
              <button className="btn" onClick={() => openPlaylistModal(Array.from(selectedTrackIds))}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                {t('views.liked.toPlaylist')}
              </button>
            </div>
          )}
          <div className="dropdown" ref={sortMenuRef}>
            <button className="btn" onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="14" y2="6" /><line x1="4" y1="12" x2="11" y2="12" /><line x1="4" y1="18" x2="8" y2="18" /><polyline points="16 15 19 18 22 15" /><line x1="19" y1="6" x2="19" y2="18" />
              </svg>
              {t('views.liked.sort')}
            </button>
            {isSortMenuOpen && (
              <div className="dropdown-menu open">
                <button className={`dropdown-item ${!shuffleActive && currentSort === 'date-new' ? 'active' : ''}`} onClick={() => handleSort('date-new')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  {t('sort.addedNew')}
                </button>
                <button className={`dropdown-item ${currentSort === 'date-old' ? 'active' : ''}`} onClick={() => handleSort('date-old')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  {t('sort.addedOld')}
                </button>
                <div className="dropdown-divider"></div>
                <button className={`dropdown-item ${currentSort === 'name-az' ? 'active' : ''}`} onClick={() => handleSort('name-az')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h13M3 12h9M3 18h5" /></svg>
                  {t('sort.nameAz')}
                </button>
                <button className={`dropdown-item ${currentSort === 'name-za' ? 'active' : ''}`} onClick={() => handleSort('name-za')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 6H8M21 12h-9M21 18h-5" /></svg>
                  {t('sort.nameZa')}
                </button>
                <div className="dropdown-divider"></div>
                <button className={`dropdown-item ${currentSort === 'dur-desc' ? 'active' : ''}`} onClick={() => handleSort('dur-desc')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {t('sort.durDesc')}
                </button>
                <button className={`dropdown-item ${currentSort === 'dur-asc' ? 'active' : ''}`} onClick={() => handleSort('dur-asc')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {t('sort.durAsc')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`search-wrap ${searchQuery ? 'active' : ''}`}>
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="search-input"
          type="text"
          placeholder={t('views.liked.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <>
            <span key={filteredTracks.length} className="search-count">{filteredTracks.length}</span>
            <button className="search-clear" onClick={() => setSearchQuery('')} title={t('common.clear')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </>
        )}
      </div>

      <div className={`track-list-container ${selectionMode ? 'selecting' : ''}`} onScroll={() => isContextMenuOpen && closeContextMenu()}>
        {sortedTracks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
            </div>
            <div className="empty-title">{t('views.liked.emptyTitle')}</div>
            <div className="empty-text">{t('views.liked.emptyText')}</div>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">{t('views.liked.notFound')}</div>
            <div className="empty-text">{t('views.liked.notFoundQuery', { q: searchQuery })}</div>
          </div>
        ) : (
          filteredTracks.map((track, idx) => {
            const speed = track.playbackRate ?? 1
            return (
              <div
                key={track.id}
                className={cx(
                  'track-row',
                  selectedTrackIds.has(track.id) && 'selected',
                  playingTrackId === track.id && 'playing',
                  removingIds.has(track.id) && 'removing',
                  flashingTrackId === track.id && 'flash'
                )}
                style={{ animationDelay: `${Math.min(idx * 25, 400)}ms` }}
                onClick={() => (selectionMode ? toggleSelection(track.id) : onSelectTrack(track, sortedTracks))}
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
                <button className={cx('tr-like-btn', 'liked', animatingLikeId === track.id && 'pop')} onClick={(e) => { e.stopPropagation(); unlikeAnimated(track.id) }} title={t('views.liked.ctxUnlike')}>
                  {heartFilledSVG}
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
          <button className="context-item" onClick={() => { enterSelectionMode(contextMenu.trackId!); closeContextMenu() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            {t('views.liked.ctxSelect')}
          </button>
          <button className="context-item" onClick={() => { const id = contextMenu.trackId; closeContextMenu(); if (id !== null) setEditingTrack(tracks.find((t) => t.id === id) ?? null) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            {t('common.edit')}
          </button>
          <button className="context-item" onClick={() => { openPlaylistModal([contextMenu.trackId!]); closeContextMenu() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
            {t('views.tracks.addToPlaylist')}
          </button>
          <div className="dropdown-divider"></div>
          <button className="context-item" onClick={() => { unlikeAnimated(contextMenu.trackId!); closeContextMenu() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
            {t('views.liked.ctxUnlike')}
          </button>
          <div className="dropdown-divider"></div>
          <button className="context-item danger" onClick={() => { if (window.confirm(t('views.tracks.confirmDeleteOne'))) deleteTracks([contextMenu.trackId!]); closeContextMenu() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            {t('common.delete')}
          </button>
        </div>,
        document.body
      )}

      {isPlaylistModalOpen && createPortal(
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && closePlaylistModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('views.tracks.playlistModalTitle')}</div>
            <div className="modal-subtitle">{t('views.tracks.playlistModalSubtitle')}</div>
            <div className="playlist-list">
              {playlists.length === 0 ? (
                <div className="empty-state">{t('views.tracks.noPlaylists')}</div>
              ) : (
                playlists.map((pl) => (
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
            {onCreatePlaylist && (
              <div style={inlineRow}>
                <input
                  style={inlineInput}
                  placeholder={t('views.tracks.newPlaylist')}
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createAndSelect() } }}
                />
                <button className="btn" onClick={createAndSelect} disabled={!newPlaylistName.trim()}>{t('common.create')}</button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={closePlaylistModal}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handlePlaylistConfirm}
                disabled={playlists.length === 0 || selectedPlaylistId === null}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <TrackEditModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={handleEditSave} />
    </div>
  )
}