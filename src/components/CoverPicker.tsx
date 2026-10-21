import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../App'
import { useI18n } from '../i18n'
import { usePresence } from './views/shared'
import './CoverPicker.css'

interface CoverPickerProps {
  open: boolean
  tracks: Track[]
  /* Трек, который не нужно показывать (например, сам редактируемый) */
  excludeId?: number
  onPick: (track: Track) => void
  onClose: () => void
}

/* Окно выбора обложки из уже существующих треков, с поиском */
export default function CoverPicker({ open, tracks, excludeId, onPick, onClose }: CoverPickerProps) {
  const { t } = useI18n()
  const { mounted, closing } = usePresence(open, 180)
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setQuery('')
  }

  /* Одинаковые обложки (один альбом) показываем один раз */
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const seen = new Set<string>()
    return tracks.filter((tr) => {
      if (!tr.cover || !tr.coverFile || tr.id === excludeId) return false
      if (q && !tr.title.toLowerCase().includes(q) && !tr.artist.toLowerCase().includes(q)) return false
      if (seen.has(tr.coverFile)) return false
      seen.add(tr.coverFile)
      return true
    })
  }, [tracks, excludeId, query])

  /* Capture-фаза: Escape закрывает только это окно, а не модалку под ним */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className={`cp-overlay ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cp-modal">
        <div className="cp-head">
          <div className="cp-title">{t('coverPicker.title')}</div>
          <button className="cp-close" onClick={onClose} title={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="cp-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="text"
            placeholder={t('coverPicker.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="cp-grid">
          {items.length === 0 ? (
            <div className="cp-empty">{t('coverPicker.empty')}</div>
          ) : (
            items.map((tr) => (
              <button key={tr.id} className="cp-item" onClick={() => onPick(tr)} title={`${tr.artist} — ${tr.title}`}>
                <img src={tr.cover!} alt="" loading="lazy" decoding="async" />
                <span className="cp-item-title">{tr.title}</span>
                <span className="cp-item-artist">{tr.artist}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
