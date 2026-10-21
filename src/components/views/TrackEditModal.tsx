import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { saveCoverFromFile } from '../../lib/trackLoader'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import './TrackEditModal.css'

export interface TrackUpdates {
  title?: string
  artist?: string
  cover?: string | null
  coverFile?: string | null
  playbackRate?: number
}

interface TrackEditModalProps {
  track: Track | null
  onClose: () => void
  onSave: (trackId: number, updates: TrackUpdates) => void
}

const fmtSpeed = (v: number) => String(Math.round(v * 100) / 100) + '×'
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2]

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
)

export default function TrackEditModal({ track, onClose, onSave }: TrackEditModalProps) {
  if (!track) return null
  /* key сбрасывает форму при открытии другого трека — состояние инициализируется сразу, без мигания */
  return <TrackEditForm key={track.id} track={track} onClose={onClose} onSave={onSave} />
}

function TrackEditForm({ track, onClose, onSave }: TrackEditModalProps & { track: Track }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [cover, setCover] = useState<string | null>(track.cover ?? null)
  const [coverFile, setCoverFile] = useState<string | null>(track.coverFile ?? null)
  const [speed, setSpeed] = useState(track.playbackRate ?? 1)
  const [isPickingCover, setIsPickingCover] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /* Capture-фаза на window: Escape закрывает только модалку и не доходит до списка треков */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pickCover = async () => {
    if (isPickingCover) return
    setIsPickingCover(true)
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: t('settings.profile.imagesFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      })
      if (!selected || Array.isArray(selected)) return
      const saved = await saveCoverFromFile(`tr-${track.id}`, selected)
      if (saved && mountedRef.current) { setCover(saved.coverUrl); setCoverFile(saved.coverFile) }
    } catch (e) {
      console.error('Ошибка выбора обложки:', e)
    } finally {
      if (mountedRef.current) setIsPickingCover(false)
    }
  }

  const handleSave = () => {
    const t2 = title.trim()
    if (!t2) return
    const updates: TrackUpdates = {}
    if (t2 !== track.title) updates.title = t2
    const a = artist.trim()
    if (a && a !== track.artist) updates.artist = a
    if (cover !== (track.cover ?? null)) { updates.cover = cover; updates.coverFile = coverFile }
    if (speed !== (track.playbackRate ?? 1)) updates.playbackRate = speed
    onSave(track.id, updates)
    onClose()
  }

  const pct = ((speed - 0.5) / 1.5) * 100

  return createPortal(
    <div className="tem-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tem-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tem-head">
          <div>
            <div className="tem-title">{t('views.trackEdit.title')}</div>
            <div className="tem-subtitle">{t('views.trackEdit.subtitle')}</div>
          </div>
          <button className="tem-close" onClick={onClose} title={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="tem-cover-row">
          <div className="tem-cover" key={cover ?? 'none'}>
            {cover ? <img src={cover} alt="" /> : <MusicIcon />}
          </div>
          <div className="tem-cover-actions">
            <button className="tem-btn" onClick={pickCover} disabled={isPickingCover}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
              {t('views.trackEdit.chooseCover')}
            </button>
            <button className="tem-btn" onClick={() => { setCover(null); setCoverFile(null) }} disabled={!cover}>
              {t('views.trackEdit.removeCover')}
            </button>
            <div className="tem-hint">{t('views.trackEdit.hint')}</div>
          </div>
        </div>

        <label className="tem-label" htmlFor="temTitle">{t('views.trackEdit.nameLabel')}</label>
        <input
          id="temTitle" className="tem-input" type="text" placeholder={t('views.trackEdit.namePlaceholder')}
          value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
          autoFocus
        />

        <label className="tem-label" htmlFor="temArtist">{t('views.trackEdit.artistLabel')}</label>
        <input
          id="temArtist" className="tem-input" type="text" placeholder={t('views.trackEdit.artistPlaceholder')}
          value={artist} onChange={(e) => setArtist(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
        />

        <div className="tem-speed-head">
          <span className="tem-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            {t('views.trackEdit.speed')}
          </span>
          <span className="tem-speed-value">{fmtSpeed(speed)}</span>
        </div>
        <input
          type="range" className="tem-slider" min="0.5" max="2" step="0.05" value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--element-strong) ${pct}%)` }}
        />
        <div className="tem-presets">
          {PRESETS.map((p) => (
            <button key={p} className={`tem-preset ${Math.abs(speed - p) < 0.001 ? 'active' : ''}`} onClick={() => setSpeed(p)}>
              {fmtSpeed(p)}
            </button>
          ))}
        </div>

        <div className="tem-actions">
          <button className="tem-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="tem-btn tem-btn-primary" onClick={handleSave} disabled={!title.trim()}>{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}