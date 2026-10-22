import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Playlist, Track } from '../App'
import { useI18n } from '../i18n'
import { usePresence } from './views/shared'
import './AddTracksModal.css'

interface AddTracksModalProps {
  open: boolean
  playlist: Playlist
  tracks: Track[]
  onClose: () => void
  onAdd: (trackIds: number[]) => void
  /* Импорт файлов в библиотеку; возвращает id треков из выбранных файлов */
  onImport?: () => Promise<number[]>
}

const PAGE_SIZE = 50

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
)

export default function AddTracksModal({ open, playlist, tracks, onClose, onAdd, onImport }: AddTracksModalProps) {
  const { t } = useI18n()
  const presence = usePresence(open, 220)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<number | null>(null)

  /* Каждое открытие — с чистого листа */
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setPage(1)
      setSelected(new Set())
      setImported(null)
    }
  }

  const inPlaylist = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    return q ? list.filter((tr) => tr.title.toLowerCase().includes(q) || tr.artist.toLowerCase().includes(q)) : list
  }, [tracks, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageTracks = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const selectable = pageTracks.filter((tr) => !inPlaylist.has(tr.id))
  const allPageSelected = selectable.length > 0 && selectable.every((tr) => selected.has(tr.id))

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!presence.mounted) return null

  const toggle = (id: number) => {
    if (inPlaylist.has(id)) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) selectable.forEach((tr) => next.delete(tr.id))
      else selectable.forEach((tr) => next.add(tr.id))
      return next
    })
  }

  const handleImport = async () => {
    if (!onImport || importing) return
    setImporting(true)
    try {
      const ids = await onImport()
      const fresh = ids.filter((id) => !inPlaylist.has(id))
      if (fresh.length > 0) onAdd(fresh)
      setImported(fresh.length)
    } finally {
      setImporting(false)
    }
  }

  const handleAdd = () => {
    const ids = [...selected].filter((id) => !inPlaylist.has(id))
    if (ids.length > 0) onAdd(ids)
    onClose()
  }

  return createPortal(
    <div
      className={`atm-overlay ${presence.closing ? 'closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="atm-modal" role="dialog" aria-modal="true">
        <header className="atm-head">
          <div className="atm-head-text">
            <div className="atm-title">{t('addTracks.title')}</div>
            <div className="atm-sub">{playlist.name}</div>
          </div>
          <button className="atm-close" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>

        {/* ===== Новые файлы ===== */}
        {onImport && (
          <div className="atm-import">
            <div className="atm-import-main">
              <div className="atm-import-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="atm-import-text">
                <div className="atm-import-title">{t('addTracks.importTitle')}</div>
                <div className={`atm-import-sub ${imported !== null ? 'done' : ''}`}>
                  {imported !== null ? t('addTracks.imported', { n: imported }) : t('upload.formats')}
                </div>
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? t('common.loading') : t('addTracks.chooseFiles')}
            </button>
          </div>
        )}

        {/* ===== Библиотека ===== */}
        <div className="atm-library-head">
          <div className="atm-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={query}
              placeholder={t('addTracks.search')}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              autoFocus
            />
          </div>
          <button className="btn btn-ghost" onClick={togglePage} disabled={selectable.length === 0}>
            {allPageSelected ? t('addTracks.unselectPage') : t('addTracks.selectPage')}
          </button>
        </div>

        <div className="atm-list" key={`${query}-${safePage}`}>
          {pageTracks.length === 0 ? (
            <div className="atm-empty">{tracks.length === 0 ? t('addTracks.libraryEmpty') : t('addTracks.notFound')}</div>
          ) : (
            pageTracks.map((tr, i) => {
              const already = inPlaylist.has(tr.id)
              const checked = already || selected.has(tr.id)
              return (
                <button
                  key={tr.id}
                  className={`atm-row ${checked ? 'checked' : ''} ${already ? 'already' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 12, 240)}ms` }}
                  onClick={() => toggle(tr.id)}
                  disabled={already}
                >
                  <span className="atm-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <span className="atm-cover">
                    {tr.cover ? <img src={tr.cover} alt="" loading="lazy" decoding="async" /> : <MusicIcon />}
                  </span>
                  <span className="atm-text">
                    <span className="atm-row-title">{tr.title}</span>
                    <span className="atm-row-artist">{tr.artist}</span>
                  </span>
                  {already ? <span className="atm-badge">{t('addTracks.already')}</span> : <span className="atm-dur">{tr.duration}</span>}
                </button>
              )
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="atm-pages">
            <button className="icon-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label={t('views.home.back')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span>{safePage} / {totalPages}</span>
            <button className="icon-btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} aria-label={t('views.home.forward')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        )}

        <footer className="atm-foot">
          <span className="atm-count">{t('addTracks.selected', { n: selected.size })}</span>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={selected.size === 0}>
            {selected.size > 0 ? t('addTracks.addN', { n: selected.size }) : t('common.add')}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
