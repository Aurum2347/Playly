import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Track, Playlist } from '../App'
import { useI18n } from '../i18n'
import TrackEditModal, { type TrackUpdates } from './views/TrackEditModal'
import TrackDetailsModal from './views/TrackDetailsModal'
import { cx, inlineButton, inlineInput, inlineRow, type ContextMenuApi } from './views/shared'

export interface TrackActionHandlers {
  onToggleLike?: (trackId: number, liked: boolean) => void
  onDeleteTracks?: (trackIds: number[]) => void
  onAddToPlaylist?: (trackIds: number[], playlistId: number) => void
  onCreatePlaylist?: (name: string) => number | void
  onEditTrack?: (trackId: number, updates: TrackUpdates) => void
  onCopyTitle?: (trackId: number) => void
  onCopyArtist?: (trackId: number) => void
  onCopyPath?: (trackId: number) => void
  onRevealInDir?: (trackId: number) => void
}

interface TrackActionsProps extends TrackActionHandlers {
  menu: ContextMenuApi<number>
  tracks: Track[]
  playlists: Playlist[]
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
)

const HEART = 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z'

/**
 * Стандартное меню трека (как на страницах треков) вместе со всеми окнами, которые из него
 * открываются. Страница без своего списка (например, главная) просто подключает этот слой.
 */
export default function TrackActions({
  menu, tracks, playlists,
  onToggleLike, onDeleteTracks, onAddToPlaylist, onCreatePlaylist, onEditTrack,
  onCopyTitle, onCopyArtist, onCopyPath, onRevealInDir,
}: TrackActionsProps) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [detailsId, setDetailsId] = useState<number | null>(null)
  const [playlistTarget, setPlaylistTarget] = useState<number | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  const { ref: menuRef, isOpen, close } = menu
  const target = menu.target !== null ? tracks.find((x) => x.id === menu.target) ?? null : null
  const editingTrack = editingId !== null ? tracks.find((x) => x.id === editingId) ?? null : null
  const detailsTrack = detailsId !== null ? tracks.find((x) => x.id === detailsId) ?? null : null

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onScroll = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [isOpen, close, menuRef])

  useEffect(() => {
    if (playlistTarget === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlaylistTarget(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [playlistTarget])

  const run = (action: (id: number) => void) => {
    const id = menu.target
    close()
    if (id !== null) action(id)
  }

  const openPlaylistModal = (id: number) => {
    setPlaylistTarget(id)
    setSelectedPlaylistId(null)
    setNewPlaylistName('')
  }

  const createAndSelect = () => {
    const name = newPlaylistName.trim()
    if (!name || !onCreatePlaylist) return
    const id = onCreatePlaylist(name)
    if (typeof id === 'number') setSelectedPlaylistId(id)
    setNewPlaylistName('')
  }

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          className={cx('context-menu', isOpen && 'open', menu.isMeasuring && 'measuring')}
          style={{ left: menu.pos.x, top: menu.pos.y }}
        >
          {onEditTrack && (
            <button className="context-item" onClick={() => run(setEditingId)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
              {t('common.edit')}
            </button>
          )}
          {onAddToPlaylist && (
            <button className="context-item" onClick={() => run(openPlaylistModal)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
              {t('views.tracks.addToPlaylist')}
            </button>
          )}
          <div className="dropdown-divider" />
          <button className="context-item" onClick={() => run(setDetailsId)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            {t('common.details')}
          </button>
          {onToggleLike && (
            <>
              <div className="dropdown-divider" />
              <button className="context-item" onClick={() => run((id) => onToggleLike(id, !target?.liked))}>
                {target?.liked ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" style={{ color: 'var(--danger)' }}><path d={HEART} /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={HEART} /></svg>
                )}
                {target?.liked ? t('views.tracks.likeRemove') : t('views.tracks.likeAdd')}
              </button>
            </>
          )}
          {onDeleteTracks && (
            <>
              <div className="dropdown-divider" />
              <button
                className="context-item danger"
                onClick={() => run((id) => { if (window.confirm(t('views.tracks.confirmDeleteOne'))) onDeleteTracks([id]) })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                {t('common.delete')}
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {playlistTarget !== null && createPortal(
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setPlaylistTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('views.tracks.playlistModalTitle')}</div>
            <div className="modal-subtitle">{t('views.tracks.playlistModalSubtitle')}</div>
            <div className="playlist-list" style={{ position: 'relative' }}>
              {playlists.length === 0 ? (
                <div className="empty-state">{t('views.tracks.noPlaylists')}</div>
              ) : (
                playlists.map((pl) => (
                  <div
                    key={pl.id}
                    className={`playlist-item ${selectedPlaylistId === pl.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPlaylistId(pl.id)}
                  >
                    <div className="playlist-cover">{pl.cover ? <img src={pl.cover} alt="" /> : <MusicIcon />}</div>
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
                <button style={inlineButton} onClick={createAndSelect} disabled={!newPlaylistName.trim()}>
                  {t('common.create')}
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setPlaylistTarget(null)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                disabled={selectedPlaylistId === null}
                onClick={() => {
                  if (selectedPlaylistId === null) return
                  onAddToPlaylist?.([playlistTarget], selectedPlaylistId)
                  setPlaylistTarget(null)
                }}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <TrackEditModal
        track={editingTrack}
        onClose={() => setEditingId(null)}
        onSave={(id, updates) => { if (Object.keys(updates).length) onEditTrack?.(id, updates) }}
        tracks={tracks}
      />
      <TrackDetailsModal
        track={detailsTrack}
        onClose={() => setDetailsId(null)}
        onCopyTitle={onCopyTitle}
        onCopyArtist={onCopyArtist}
        onCopyPath={onCopyPath}
        onRevealInDir={onRevealInDir}
      />
    </>
  )
}
