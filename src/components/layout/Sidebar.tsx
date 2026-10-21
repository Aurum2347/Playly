import { useState, useRef, useEffect } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readFile, readTextFile } from '@tauri-apps/plugin-fs'
import type { ViewType, Playlist, CoverPick, Track } from '../../App'
import { copyCover } from '../../lib/trackLoader'
import CoverPicker from '../CoverPicker'
import { usePresence } from '../views/shared'
import { useI18n } from '../../i18n'
import './Sidebar.css'

type AvatarShape = 'circle' | 'square'

interface SidebarProps {
  currentView: ViewType
  onViewChange: (view: ViewType) => void
  nickname: string
  playlists: Playlist[]
  avatarUrl?: string | null
  avatarShape?: AvatarShape
  onCreatePlaylist: (name: string, cover?: CoverPick | null) => number
  onRenamePlaylist: (id: number, name: string) => void
  onUpdatePlaylist: (id: number, patch: Partial<Pick<Playlist, 'cover' | 'coverFile' | 'color'>>) => void
  tracks: Track[]
  onDeletePlaylist: (id: number) => void
  onChangePlaylistCover: (id: number) => void
  onPickImage: () => Promise<CoverPick | null>
  onOpenPlaylist: (id: number) => void
  onReorderPlaylists: (fromIndex: number, toIndex: number) => void
}

interface LocalProfileSettings {
  avatarFile?: string
  avatarShape?: AvatarShape
}

function imageMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''

  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
)

interface DragState {
  el: HTMLElement
  id: number
  startY: number
  grabOffset: number
  moved: boolean
  settling: boolean
  items: HTMLElement[]
  count: number
  slotH: number
  baseTop: number
  fromIndex: number
  naturalTop: number
  currentIndex: number
}

export default function Sidebar({
  currentView,
  onViewChange,
  nickname,
  playlists,
  avatarUrl,
  avatarShape,
  onCreatePlaylist,
  onRenamePlaylist,
  onUpdatePlaylist,
  tracks,
  onDeletePlaylist,
  onChangePlaylistCover,
  onPickImage,
  onOpenPlaylist,
  onReorderPlaylists,
}: SidebarProps) {
  const { t } = useI18n()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCover, setCreateCover] = useState<CoverPick | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: number } | null>(null)
  const [editState, setEditState] = useState<{ id: number; name: string; color: string | null } | null>(null)
  /* Куда отдать обложку, выбранную из трека: в форму создания или в редактируемый плейлист */
  const [borrowFor, setBorrowFor] = useState<'create' | 'edit' | null>(null)
  /* Последняя позиция меню остаётся, пока проигрывается анимация закрытия */
  const [ctxShown, setCtxShown] = useState(ctxMenu)
  if (ctxMenu && ctxMenu !== ctxShown) setCtxShown(ctxMenu)
  const ctxPresence = usePresence(ctxMenu !== null)
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null)

  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null)
  const [localAvatarShape, setLocalAvatarShape] = useState<AvatarShape>('circle')

  const ctxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const reorderRef = useRef(onReorderPlaylists)
  const localAvatarUrlRef = useRef<string | null>(null)

  useEffect(() => {
    reorderRef.current = onReorderPlaylists
  }, [onReorderPlaylists])

  const ctxPlaylist = ctxMenu ? playlists.find((p) => p.id === ctxMenu.id) ?? null : null
  const editPlaylist = editState ? playlists.find((p) => p.id === editState.id) ?? null : null

  const shouldLoadLocalProfile = avatarUrl === undefined || avatarShape === undefined

  useEffect(() => {
    if (!shouldLoadLocalProfile) return

    let cancelled = false

    const loadProfile = async () => {
      try {
        const appDir = await appDataDir()
        const playlyDir = await join(appDir, 'playly')
        const profileDir = await join(playlyDir, 'profile')
        const profileFile = await join(profileDir, 'profile.json')

        if (!(await exists(profileFile))) return

        const raw = await readTextFile(profileFile)
        const data = JSON.parse(raw) as LocalProfileSettings

        if (!cancelled) {
          setLocalAvatarShape(data.avatarShape === 'square' ? 'square' : 'circle')
        }

        if (data.avatarFile) {
          const filePath =
            data.avatarFile.includes('/') || data.avatarFile.includes('\\')
              ? data.avatarFile
              : await join(profileDir, data.avatarFile)

          if (await exists(filePath)) {
            const bytes = await readFile(filePath)

            if (!cancelled) {
              if (localAvatarUrlRef.current) {
                URL.revokeObjectURL(localAvatarUrlRef.current)
              }

              const url = URL.createObjectURL(
                new Blob([bytes as unknown as BlobPart], { type: imageMime(filePath) })
              )

              localAvatarUrlRef.current = url
              setLocalAvatarUrl(url)
            }
          }
        }
      } catch (e) {
        console.error('Ошибка загрузки профиля в сайдбаре:', e)
      }
    }

    const handleProfileUpdated = () => {
      loadProfile()
    }

    loadProfile()
    window.addEventListener('playly-profile-updated', handleProfileUpdated)

    return () => {
      cancelled = true
      window.removeEventListener('playly-profile-updated', handleProfileUpdated)

      if (localAvatarUrlRef.current) {
        URL.revokeObjectURL(localAvatarUrlRef.current)
        localAvatarUrlRef.current = null
      }
    }
  }, [shouldLoadLocalProfile])

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

  const openCreate = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCreateName('')
    setCreateCover(null)
    setIsCreateOpen(true)
  }

  const handleCreate = () => {
    const name = createName.trim()
    if (!name) return

    onCreatePlaylist(name, createCover)
    setIsCreateOpen(false)
  }

  const openCtx = (e: React.MouseEvent, id: number) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 160),
      id,
    })
  }

  const handleEditSave = () => {
    if (!editState) return

    const name = editState.name.trim()
    if (!name) return

    onRenamePlaylist(editState.id, name)
    onUpdatePlaylist(editState.id, { color: editState.color })
    setEditState(null)
  }

  const handleBorrowCover = async (source: Track) => {
    const target = borrowFor
    const editId = editState?.id
    setBorrowFor(null)
    if (!source.coverFile) return
    const copied = await copyCover(target === 'edit' && editId ? `pl-${editId}` : 'pl-new', source.coverFile)
    if (!copied) return
    if (target === 'create') setCreateCover(copied)
    else if (target === 'edit' && editId) onUpdatePlaylist(editId, { cover: copied.coverUrl, coverFile: copied.coverFile })
  }

  const requestDelete = (pl: Playlist) => {
    if (pl.trackIds.length > 0) setDeleteTarget(pl)
    else onDeletePlaylist(pl.id)
  }

  const beginDrag = (d: DragState) => {
    const list = listRef.current
    if (!list) return

    const els = Array.from(list.children) as HTMLElement[]
    if (els.length === 0) return

    const cs = getComputedStyle(list)
    const gap = parseFloat(cs.rowGap || cs.gap) || 0

    d.items = els
    d.count = els.length
    d.slotH = els[0].offsetHeight + gap
    d.baseTop = els[0].getBoundingClientRect().top
    d.fromIndex = els.indexOf(d.el)
    d.naturalTop = d.fromIndex * d.slotH
    d.currentIndex = d.fromIndex
    d.moved = true

    d.el.classList.add('dragging')
    list.classList.add('zone-active')
    document.body.classList.add('is-dragging')
  }

  const applyShifts = (d: DragState) => {
    d.items.forEach((el, i) => {
      if (el === d.el) return

      let shift = 0

      if (d.fromIndex < d.currentIndex && i > d.fromIndex && i <= d.currentIndex) {
        shift = -d.slotH
      } else if (d.fromIndex > d.currentIndex && i >= d.currentIndex && i < d.fromIndex) {
        shift = d.slotH
      }

      el.style.transform = shift ? `translateY(${shift}px)` : ''
    })
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (dragRef.current) return

    const grip = (e.target as HTMLElement).closest('.sb-grip')
    if (!grip) return

    const item = grip.closest('.playlist-item') as HTMLElement | null
    if (!item) return

    if (e.pointerType === 'mouse' && e.button !== 0) return

    const rect = item.getBoundingClientRect()

    dragRef.current = {
      el: item,
      id: e.pointerId,
      startY: e.clientY,
      grabOffset: e.clientY - rect.top,
      moved: false,
      settling: false,
      items: [],
      count: 0,
      slotH: 0,
      baseTop: 0,
      fromIndex: 0,
      naturalTop: 0,
      currentIndex: 0,
    }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.settling || e.pointerId !== d.id) return

      if (!d.moved) {
        if (Math.abs(e.clientY - d.startY) < 4) return
        beginDrag(d)
      }

      e.preventDefault()

      let desired = e.clientY - d.grabOffset - d.baseTop
      const maxTop = (d.count - 1) * d.slotH
      desired = Math.max(0, Math.min(maxTop, desired))

      d.el.style.transform = `translateY(${desired - d.naturalTop}px) scale(1.02)`

      const idx = Math.max(0, Math.min(d.count - 1, Math.round(desired / d.slotH)))

      if (idx !== d.currentIndex) {
        d.currentIndex = idx
        applyShifts(d)
      }
    }

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d || d.settling) return

      if (e.pointerId !== undefined && e.pointerId !== d.id) return

      if (!d.moved) {
        dragRef.current = null
        return
      }

      d.settling = true
      suppressClickRef.current = true

      document.body.classList.remove('is-dragging')
      listRef.current?.classList.remove('zone-active')

      d.el.classList.remove('dragging')
      d.el.classList.add('dropping')
      d.el.style.transform = `translateY(${(d.currentIndex - d.fromIndex) * d.slotH}px) scale(1)`

      window.setTimeout(() => {
        const list = listRef.current
        const from = d.fromIndex
        const to = d.currentIndex

        if (from !== to) {
          flushSync(() => reorderRef.current(from, to))
        }

        if (list) {
          const els = Array.from(list.children) as HTMLElement[]

          els.forEach((el) => {
            el.style.transition = 'none'
            el.style.transform = ''
            el.classList.remove('dragging', 'dropping')
          })

          void list.offsetWidth

          els.forEach((el) => {
            el.style.transition = ''
          })
        }

        dragRef.current = null
      }, 290)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const displayAvatarUrl = avatarUrl !== undefined ? avatarUrl : localAvatarUrl
  const displayAvatarShape = avatarShape !== undefined ? avatarShape : localAvatarShape

  return (
    <>
      <aside className="sidebar">
        <div className="profile-card">
          <div
            className="profile-avatar"
            style={{
              borderRadius: displayAvatarShape === 'square' ? '12px' : '50%',
              overflow: 'hidden',
            }}
          >
            {displayAvatarUrl ? (
              <img
                src={displayAvatarUrl}
                alt="Avatar"
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  borderRadius: 'inherit',
                }}
              />
            ) : null}
          </div>

          <div className="profile-info">
            <div className="profile-nickname">{nickname}</div>

            <button className="profile-edit-btn" onClick={() => onViewChange('settings')}>
              <svg viewBox="0 0 24 24">
                <path className="edit-icon" d="M12 20h9" />
                <path
                  className="edit-icon"
                  d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                />
              </svg>
              {t('layout.sidebar.edit')}
            </button>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${currentView === 'home' ? 'active' : ''}`}
            onClick={() => onViewChange('home')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {t('layout.sidebar.home')}
          </button>

          <button
            className={`nav-item ${currentView === 'tracks' ? 'active' : ''}`}
            onClick={() => onViewChange('tracks')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            {t('layout.sidebar.tracks')}
          </button>

          <button
            className={`nav-item ${currentView === 'liked' ? 'active' : ''}`}
            onClick={() => onViewChange('liked')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            {t('layout.sidebar.liked')}
          </button>

          <button
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => onViewChange('settings')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1-1.51H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001.51-1V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            {t('layout.sidebar.settings')}
          </button>
        </nav>

        <div className="playlists-section">
          <div className="playlists-header">
            <span className="playlists-title">{t('layout.sidebar.playlists')}</span>
            <button className="playlists-add-btn" onClick={openCreate} title={t('layout.sidebar.createTitle')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          <div
            ref={listRef}
            className="playlists-list"
            onPointerDown={handlePointerDown}
            onDragStart={(e) => e.preventDefault()}
          >
            {playlists.length === 0 ? (
              <div className="playlists-empty">
                <MusicIcon />
                <span>{t('layout.sidebar.empty')}</span>
              </div>
            ) : (
              playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="playlist-item"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('.sb-grip')) return
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    onOpenPlaylist(pl.id)
                  }}
                  onContextMenu={(e) => openCtx(e, pl.id)}
                  title={pl.name}
                >
                  <div className="playlist-cover">
                    {pl.cover ? <img src={pl.cover} alt="" draggable={false} /> : <MusicIcon />}
                  </div>

                  <div className="playlist-info">
                    <div className="playlist-name">{pl.name}</div>
                    <div className="playlist-count">
                      {t('layout.sidebar.tracksCount', { n: pl.trackIds.length })}
                    </div>
                  </div>

                  <div className="sb-grip" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {ctxPresence.mounted && ctxShown &&
        createPortal(
          <div ref={ctxRef} className={`sb-context-menu ${ctxPresence.closing ? 'closing' : ''}`} style={{ left: ctxShown.x, top: ctxShown.y }}>
            <button
              className="sb-context-item"
              onClick={() => {
                setEditState({ id: ctxShown.id, name: ctxPlaylist?.name ?? '', color: ctxPlaylist?.color ?? null })
                setCtxMenu(null)
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              {t('layout.sidebar.edit')}
            </button>

            <div className="sb-context-divider" />

            <button
              className="sb-context-item sb-context-danger"
              onClick={() => {
                const pl = ctxPlaylist
                setCtxMenu(null)
                if (pl) requestDelete(pl)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              {t('common.delete')}
            </button>
          </div>,
          document.body
        )}

      {isCreateOpen &&
        createPortal(
          <div
            className="sb-modal-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsCreateOpen(false)
            }}
          >
            <div
              className="sb-modal"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sb-modal-header">
                <h3 className="sb-modal-title">{t('layout.sidebar.createTitle')}</h3>
                <button className="sb-modal-close" onClick={() => setIsCreateOpen(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="sb-modal-body">
                <div className="sb-edit-cover-row">
                  <div className="sb-edit-cover">
                    {createCover ? <img src={createCover.coverUrl} alt="" /> : <MusicIcon />}
                  </div>

                  <button
                    className="sb-modal-btn sb-modal-btn-cancel"
                    onClick={async () => {
                      const c = await onPickImage()
                      if (c) setCreateCover(c)
                    }}
                  >
                    {t('layout.sidebar.chooseCover')}
                  </button>
                  <button className="sb-modal-btn sb-modal-btn-cancel" onClick={() => setBorrowFor('create')}>
                    {t('coverPicker.fromTrack')}
                  </button>
                </div>

                <input
                  type="text"
                  className="sb-modal-input"
                  placeholder={t('layout.sidebar.namePlaceholder')}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreate()
                    }
                    if (e.key === 'Escape') setIsCreateOpen(false)
                  }}
                  autoFocus
                />
              </div>

              <div className="sb-modal-footer">
                <button className="sb-modal-btn sb-modal-btn-cancel" onClick={() => setIsCreateOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="sb-modal-btn sb-modal-btn-primary"
                  onClick={handleCreate}
                  disabled={!createName.trim()}
                >
                  {t('common.create')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {editState &&
        createPortal(
          <div
            className="sb-modal-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setEditState(null)
            }}
          >
            <div
              className="sb-modal"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sb-modal-header">
                <h3 className="sb-modal-title">{t('layout.sidebar.editTitle')}</h3>
                <button className="sb-modal-close" onClick={() => setEditState(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="sb-modal-body">
                <div className="sb-edit-cover-row">
                  <div className="sb-edit-cover">
                    {editPlaylist?.cover ? <img src={editPlaylist.cover} alt="" /> : <MusicIcon />}
                  </div>

                  <button
                    className="sb-modal-btn sb-modal-btn-cancel"
                    onClick={() => onChangePlaylistCover(editState.id)}
                  >
                    {t('layout.sidebar.changeCover')}
                  </button>
                  <button className="sb-modal-btn sb-modal-btn-cancel" onClick={() => setBorrowFor('edit')}>
                    {t('coverPicker.fromTrack')}
                  </button>
                </div>

                <div className="sb-color-row">
                  <span className="sb-color-label">{t('layout.sidebar.bgColor')}</span>
                  <label className="sb-color-swatch" style={{ background: editState.color ?? 'var(--element-strong)' }}>
                    <input
                      type="color"
                      value={editState.color ?? '#808080'}
                      onChange={(e) => setEditState({ ...editState, color: e.target.value })}
                    />
                  </label>
                  <button
                    className="sb-modal-btn sb-modal-btn-cancel"
                    onClick={() => setEditState({ ...editState, color: null })}
                    disabled={!editState.color}
                  >
                    {t('layout.sidebar.resetColor')}
                  </button>
                </div>

                <input
                  type="text"
                  className="sb-modal-input"
                  placeholder={t('layout.sidebar.namePlaceholderShort')}
                  value={editState.name}
                  onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleEditSave()
                    }
                  }}
                  autoFocus
                />
              </div>

              <div className="sb-modal-footer">
                <button className="sb-modal-btn sb-modal-btn-cancel" onClick={() => setEditState(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="sb-modal-btn sb-modal-btn-primary"
                  onClick={handleEditSave}
                  disabled={!editState.name.trim()}
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <CoverPicker
        open={borrowFor !== null}
        tracks={tracks}
        onPick={handleBorrowCover}
        onClose={() => setBorrowFor(null)}
      />

      {deleteTarget &&
        createPortal(
          <div
            className="confirm-overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDeleteTarget(null)
            }}
          >
            <div className="confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="confirm-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </div>

              <h3 className="confirm-title">
                {t('layout.sidebar.deleteTitle', { name: deleteTarget.name })}
              </h3>
              <p className="confirm-text">{t('layout.sidebar.deleteText')}</p>

              <div className="confirm-meta">
                <div className="confirm-meta-row">
                  <span>{t('layout.sidebar.tracksInside')}</span>
                  <span>{deleteTarget.trackIds.length}</span>
                </div>
              </div>

              <div className="confirm-hint">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  <strong>{t('layout.sidebar.hintStrong')}</strong>
                  {t('layout.sidebar.hint')}
                </span>
              </div>

              <div className="confirm-actions">
                <button className="confirm-btn confirm-btn-cancel" onClick={() => setDeleteTarget(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="confirm-btn confirm-btn-danger"
                  onClick={() => {
                    onDeletePlaylist(deleteTarget.id)
                    setDeleteTarget(null)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}