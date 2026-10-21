import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../../App'
import TrackEditModal from './TrackEditModal'
import type { TrackUpdates } from './TrackEditModal'
import { useI18n } from '../../i18n'
import TrackDetailsModal from './TrackDetailsModal'
import { cx, inlineInput, inlineRow, parseDuration, useContextMenu } from './shared'
import styles from './TracksView.module.css'

type SortOption = 'name-az' | 'name-za' | 'dur-desc' | 'dur-asc' | 'date-new' | 'date-old'

interface TracksViewProps {
  tracks: Track[]
  playlists: Playlist[]
  onSelectTrack: (track: Track, queue?: Track[]) => void
  playingTrackId?: number | null
  onToggleLike?: (trackId: number, liked: boolean) => void
  onDeleteTracks?: (trackIds: number[]) => void
  onAddToPlaylist?: (trackIds: number[], playlistId: number) => void
  onCreatePlaylist?: (name: string) => number | void
  onEditTrack?: (trackId: number, updates: TrackUpdates) => void
  onAddTracks?: () => void
  onCopyTitle?: (trackId: number) => void
  onCopyArtist?: (trackId: number) => void
  onCopyPath?: (trackId: number) => void
  onRevealInDir?: (trackId: number) => void
}

const PAGE_SIZE = 100

export default function TracksView({
  tracks, playlists, onSelectTrack, playingTrackId = null,
  onToggleLike, onDeleteTracks, onAddToPlaylist, onCreatePlaylist, onEditTrack, onAddTracks,
  onCopyTitle, onCopyArtist, onCopyPath, onRevealInDir,
}: TracksViewProps) {
  const { t } = useI18n()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<number>>(new Set())
  const [currentSort, setCurrentSort] = useState<SortOption>('date-new')
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
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
  const [animatingLikeId, setAnimatingLikeId] = useState<number | null>(null)
  const [animatingCheckboxId, setAnimatingCheckboxId] = useState<number | null>(null)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [detailsTrackId, setDetailsTrackId] = useState<number | null>(null)
  const [flashingTrackId, setFlashingTrackId] = useState<number | null>(null)

  const contextMenu = useContextMenu<number>()
  const sortMenuRef = useRef<HTMLDivElement>(null)

  const sortedTracks = useMemo(() => {
    const arr = [...tracks]
    switch (currentSort) {
      case 'name-az': arr.sort((a, b) => a.title.localeCompare(b.title)); break
      case 'name-za': arr.sort((a, b) => b.title.localeCompare(a.title)); break
      case 'dur-desc': arr.sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration)); break
      case 'dur-asc': arr.sort((a, b) => parseDuration(a.duration) - parseDuration(b.duration)); break
      case 'date-new': arr.sort((a, b) => (b.fileModifiedAt || 0) - (a.fileModifiedAt || 0)); break
      case 'date-old': arr.sort((a, b) => (a.fileModifiedAt || 0) - (b.fileModifiedAt || 0)); break
    }
    return arr
  }, [tracks, currentSort])

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedTracks
    return sortedTracks.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
  }, [sortedTracks, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE))
  /* Если треков стало меньше (удаление, поиск) — не уходим за последнюю страницу */
  const safePage = Math.min(currentPage, totalPages)

  const pageTracks = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredTracks.slice(start, start + PAGE_SIZE)
  }, [filteredTracks, safePage])

  const selectedCount = selectedTrackIds.size
  const contextTrack = contextMenu.target !== null ? tracks.find((t) => t.id === contextMenu.target) ?? null : null
  /* Берём актуальную версию трека из props, чтобы после редактирования/лайка детали не устаревали */
  const detailsTrack = detailsTrackId !== null ? tracks.find((t) => t.id === detailsTrackId) ?? null : null

  const toggleLike = (trackId: number) => {
    const track = tracks.find((t) => t.id === trackId)
    if (!track) return
    setAnimatingLikeId(trackId)
    window.setTimeout(() => setAnimatingLikeId((cur) => (cur === trackId ? null : cur)), 320)
    onToggleLike?.(trackId, !track.liked)
  }

  const toggleSelection = (trackId: number) => {
    const next = new Set(selectedTrackIds)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    setSelectedTrackIds(next)
    if (next.size === 0) setSelectionMode(false)
    setAnimatingCheckboxId(trackId)
    window.setTimeout(() => setAnimatingCheckboxId((cur) => (cur === trackId ? null : cur)), 240)
  }

  const enterSelectionMode = (trackId: number) => { setSelectionMode(true); setSelectedTrackIds(new Set([trackId])) }
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedTrackIds(new Set()) }

  const deleteTracks = (ids: number[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const rest = new Set([...selectedTrackIds].filter((id) => !idSet.has(id)))
    setSelectedTrackIds(rest)
    if (rest.size === 0) setSelectionMode(false)
    onDeleteTracks?.(ids)
  }

  const handleDeleteSelected = () => {
    if (selectedCount === 0) return
    if (window.confirm(t('views.tracks.confirmDeleteMany', { n: selectedCount }))) {
      deleteTracks(Array.from(selectedTrackIds))
      exitSelectionMode()
    }
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setCurrentPage(1)
  }

  const handleSortChange = (sort: SortOption) => {
    setCurrentSort(sort)
    setIsSortMenuOpen(false)
    setCurrentPage(1)
  }

  const openContextMenu = (e: React.MouseEvent, trackId: number) => {
    setIsSortMenuOpen(false)
    contextMenu.open(e, trackId)
  }
  const closeContextMenu = contextMenu.close

  const handleEditSave = (trackId: number, updates: TrackUpdates) => {
    if (Object.keys(updates).length === 0) return
    onEditTrack?.(trackId, updates)
    setFlashingTrackId(trackId)
    window.setTimeout(() => setFlashingTrackId((cur) => (cur === trackId ? null : cur)), 750)
  }

  const handleContextAction = (action: 'select' | 'edit' | 'playlist' | 'delete' | 'details' | 'like') => {
    const id = contextMenu.target
    closeContextMenu()
    if (id === null) return
    switch (action) {
      case 'select':
        enterSelectionMode(id)
        break
      case 'edit':
        setEditingTrack(tracks.find((t) => t.id === id) ?? null)
        break
      case 'playlist':
        openPlaylistModal([id])
        break
      case 'delete':
        if (window.confirm(t('views.tracks.confirmDeleteOne'))) deleteTracks([id])
        break
      case 'details':
        setDetailsTrackId(id)
        break
      case 'like':
        toggleLike(id)
        break
    }
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
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (contextMenuRef.current && !contextMenuRef.current.contains(target)) closeContextMenu()
      if (sortMenuRef.current && !sortMenuRef.current.contains(target)) setIsSortMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isPlaylistModalOpen) setIsPlaylistModalOpen(false)
      else if (isContextMenuOpen) closeContextMenu()
      else if (isSortMenuOpen) setIsSortMenuOpen(false)
      else if (selectionMode || selectedCount > 0) { setSelectionMode(false); setSelectedTrackIds(new Set()) }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isPlaylistModalOpen, isContextMenuOpen, isSortMenuOpen, selectionMode, selectedCount, closeContextMenu, contextMenuRef])

  const paginationItems = useMemo(() => {
    const items: Array<number | 'ellipsis'> = []
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) items.push(i) }
    else {
      items.push(1)
      if (safePage > 3) items.push('ellipsis')
      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) items.push(i)
      if (safePage < totalPages - 2) items.push('ellipsis')
      items.push(totalPages)
    }
    return items
  }, [safePage, totalPages])

  const musicIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  )

  return (
    <div className={styles.tracksView}>
      <div className={styles.viewHeader}>
        <h1 className={styles.pageTitle}>{t('views.tracks.title')}</h1>
        <div className={styles.headerActions}>
          <div className={cx(styles.selectionActions, selectedCount > 0 && styles.visible)}>
            <button className={cx(styles.btn, styles.btnDanger)} onClick={handleDeleteSelected}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              {t('views.tracks.deleteSelected', { n: selectedCount })}
            </button>
            <button className={styles.btn} onClick={() => openPlaylistModal(Array.from(selectedTrackIds))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
              </svg>
              {t('views.tracks.addToPlaylist')}
            </button>
          </div>

          <div className={styles.dropdown} ref={sortMenuRef}>
            <button className={styles.btn} onClick={() => setIsSortMenuOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="14" y2="6" /><line x1="4" y1="12" x2="11" y2="12" />
                <line x1="4" y1="18" x2="8" y2="18" /><polyline points="16 15 19 18 22 15" />
                <line x1="19" y1="6" x2="19" y2="18" />
              </svg>
              {t('views.tracks.sort')}
            </button>
            <div className={cx(styles.dropdownMenu, isSortMenuOpen && styles.open)}>
              <button className={cx(styles.dropdownItem, currentSort === 'name-az' && styles.active)} onClick={() => handleSortChange('name-az')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h13M3 12h9M3 18h5" /></svg>
                {t('sort.nameAz')}
              </button>
              <button className={cx(styles.dropdownItem, currentSort === 'name-za' && styles.active)} onClick={() => handleSortChange('name-za')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 6H8M21 12h-9M21 18h-5" /></svg>
                {t('sort.nameZa')}
              </button>
              <div className={styles.dropdownDivider} />
              <button className={cx(styles.dropdownItem, currentSort === 'dur-desc' && styles.active)} onClick={() => handleSortChange('dur-desc')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {t('sort.durDesc')}
              </button>
              <button className={cx(styles.dropdownItem, currentSort === 'dur-asc' && styles.active)} onClick={() => handleSortChange('dur-asc')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {t('sort.durAsc')}
              </button>
              <div className={styles.dropdownDivider} />
              <button className={cx(styles.dropdownItem, currentSort === 'date-new' && styles.active)} onClick={() => handleSortChange('date-new')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                {t('sort.dateNew')}
              </button>
              <button className={cx(styles.dropdownItem, currentSort === 'date-old' && styles.active)} onClick={() => handleSortChange('date-old')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                {t('sort.dateOld')}
              </button>
            </div>
          </div>

          {onAddTracks && (
            <button className={cx(styles.btn, styles.btnPrimary)} onClick={onAddTracks}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('views.tracks.addTrack')}
            </button>
          )}
        </div>
      </div>

      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={t('views.tracks.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {searchQuery && (
          <>
            <span key={filteredTracks.length} className={styles.searchCount}>{filteredTracks.length}</span>
            <button className={styles.searchClear} onClick={() => handleSearchChange('')} title={t('common.clear')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </>
        )}
      </div>

      <div
        key={`search-${searchQuery}-page-${safePage}`}
        className={cx(styles.trackListContainer, selectionMode && styles.selecting)}
        onScroll={() => isContextMenuOpen && closeContextMenu()}
      >
        {sortedTracks.length === 0 ? (
          <div className={styles['empty-state']}>{t('views.tracks.empty')}</div>
        ) : filteredTracks.length === 0 ? (
          <div className={styles['empty-state']}>{t('views.tracks.notFound', { q: searchQuery })}</div>
        ) : (
          pageTracks.map((track, idx) => {
            const globalIdx = (safePage - 1) * PAGE_SIZE + idx
            const speed = track.playbackRate ?? 1
            return (
              <div
                key={track.id}
                style={{ animationDelay: `${Math.min(idx * 20, 300)}ms` }}
                className={cx(
                  styles.trackRow,
                  selectedTrackIds.has(track.id) && styles.selected,
                  playingTrackId === track.id && styles.playing,
                  flashingTrackId === track.id && styles.flash
                )}
                onClick={() => (selectionMode ? toggleSelection(track.id) : onSelectTrack(track, sortedTracks))}
                onContextMenu={(e) => openContextMenu(e, track.id)}
              >
                <span className={cx(styles.trPlayingBar, playingTrackId === track.id && styles.active)} aria-hidden="true" />
                <span className={styles.trNum}>{globalIdx + 1}</span>
                <div className={cx(styles.trCheckbox, selectedTrackIds.has(track.id) && styles.checked, animatingCheckboxId === track.id && styles.pop)} onClick={(e) => { e.stopPropagation(); toggleSelection(track.id) }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div className={styles.trInfo}>
                  <div className={styles.trCover}>
                    {track.cover ? <img src={track.cover} alt="" loading="lazy" decoding="async" /> : musicIconSVG}
                  </div>
                  <div className={styles.trText}>
                    <div className={styles.trTitle}>{track.title}</div>
                    <div className={styles.trArtist}>{track.artist}</div>
                  </div>
                </div>
                <span className={styles.trDur}>
                  {speed !== 1 && <span className={styles.speedBadge}>{String(Math.round(speed * 100) / 100)}×</span>}
                  {track.duration}
                </span>
                <button className={cx(styles.trLikeBtn, track.liked && styles.liked, animatingLikeId === track.id && styles.pop)} onClick={(e) => { e.stopPropagation(); toggleLike(track.id) }} title={track.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}>
                  {track.liked ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
                  )}
                </button>
                <button className={styles.trMenuBtn} onClick={(e) => openContextMenu(e, track.id)} title={t('common.more')}>
                  <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
                </button>
              </div>
            )
          })
        )}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={safePage === 1} onClick={() => setCurrentPage(Math.max(1, safePage - 1))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          {paginationItems.map((item, i) =>
            item === 'ellipsis' ? (
              <span key={`e${i}`} className={styles.pageEllipsis}>…</span>
            ) : (
              <button key={item} className={cx(styles.pageBtn, safePage === item && styles.pageBtnActive)} onClick={() => setCurrentPage(item)}>{item}</button>
            )
          )}
          <button className={styles.pageBtn} disabled={safePage === totalPages} onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          <div className={styles.pageInfo}>
            {searchQuery
              ? t('views.tracks.pageInfo', { found: filteredTracks.length, total: sortedTracks.length })
              : t('views.tracks.totalTracks', { n: sortedTracks.length })}
          </div>
        </div>
      )}

      {createPortal(
        <div 
          ref={contextMenuRef} 
          className={cx(styles.contextMenu, isContextMenuOpen && styles.open, contextMenu.isMeasuring && styles.measuring)}
          style={{ left: contextMenu.pos.x, top: contextMenu.pos.y }}
        >
          <button className={styles.contextItem} onClick={() => handleContextAction('select')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            {t('views.tracks.ctxSelect')}
          </button>
          <button className={styles.contextItem} onClick={() => handleContextAction('edit')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            {t('common.edit')}
          </button>
          <button className={styles.contextItem} onClick={() => handleContextAction('playlist')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
            {t('views.tracks.addToPlaylist')}
          </button>
          <div className={styles.dropdownDivider} />
          <button className={styles.contextItem} onClick={() => handleContextAction('details')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            {t('common.details')}
          </button>
          <div className={styles.dropdownDivider} />
          <button className={styles.contextItem} onClick={() => handleContextAction('like')}>
            {contextTrack?.liked ? (
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
            )}
            {contextTrack?.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}
          </button>
          <div className={styles.dropdownDivider} />
          <button className={cx(styles.contextItem, styles.danger)} onClick={() => handleContextAction('delete')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            {t('common.delete')}
          </button>
        </div>,
        document.body
      )}

    {isPlaylistModalOpen && createPortal(
      <div className={cx(styles.modalOverlay, styles.open)} onClick={(e) => e.target === e.currentTarget && closePlaylistModal()}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalTitle}>{t('views.tracks.playlistModalTitle')}</div>
          <div className={styles.modalSubtitle}>{t('views.tracks.playlistModalSubtitle')}</div>
          <div className={`${styles.playlistListWrapper} ${playlistScrollPos === 'top' ? styles.scrolledTop : ''} ${playlistScrollPos === 'bottom' ? styles.scrolledBottom : ''}`}>
            <div className={styles.playlistListFadeTop} />
            <div className={styles.playlistList} style={{ position: 'relative' }} onScroll={handlePlaylistScroll}>
              {playlists.length === 0 ? (
                <div className={styles['empty-state']}>{t('views.tracks.noPlaylists')}</div>
              ) : (
                playlists.map((pl) => (
                  <div key={pl.id} className={cx(styles.playlistItem, selectedPlaylistId === pl.id && styles.selected)} onClick={() => setSelectedPlaylistId(pl.id)}>
                    <div className={styles.playlistCover}>
                      {pl.cover ? <img src={pl.cover} alt="" /> : musicIconSVG}
                    </div>
                    <div className={styles.playlistInfo}>
                      <div className={styles.playlistName}>{pl.name}</div>
                      <div className={styles.playlistCount}>{t('views.tracks.totalTracks', { n: pl.trackIds.length })}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className={styles.playlistListFadeBottom} />
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
              <button className={styles.btn} onClick={createAndSelect} disabled={!newPlaylistName.trim()}>{t('common.create')}</button>
            </div>
          )}
          <div className={styles.modalActions}>
            <button className={styles.btn} onClick={closePlaylistModal}>{t('common.cancel')}</button>
            <button
              className={cx(styles.btn, styles.btnPrimary)}
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

      <TrackEditModal track={editingTrack} onClose={() => setEditingTrack(null)} onSave={handleEditSave} tracks={tracks} />
      
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