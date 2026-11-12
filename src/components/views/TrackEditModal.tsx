import LyricsEditor from '../LyricsEditor'
import SafeImage from '../SafeImage'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { copyCover, loadCoverUrl, saveCoverFromBytes } from '../../lib/trackLoader'
import { isVideoPath, pickVisual, requestVideoGif } from '../../lib/media'
import CoverPicker from '../CoverPicker'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import { invoke } from '@tauri-apps/api/core'
import { reportError } from '../../lib/feedback'
import EqEditorModal from '../EqEditorModal'
import { FLAT_GAINS, normalizeGains } from '../../lib/equalizer'
import './TrackEditModal.css'

export interface TrackUpdates {
  album?: string
  genre?: string
  eqGains?: number[] | null
  title?: string
  artist?: string
  cover?: string | null
  coverFile?: string | null
  playbackRate?: number
  animCoverFile?: string | null
  discordHidden?: boolean
  /* Длительность, когда её не удалось прочитать из тегов (например, у видео) */
  duration?: string
}

interface TrackEditModalProps {
  track: Track | null
  onClose: () => void
  onSave: (trackId: number, updates: TrackUpdates) => void
  /* Библиотека — чтобы можно было взять обложку у другого трека */
  tracks?: Track[]
}

const fmtSpeed = (v: number) => String(Math.round(v * 100) / 100) + '×'
const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2]

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
)

export default function TrackEditModal({ track, onClose, onSave, tracks }: TrackEditModalProps) {
  if (!track) return null
  /* key сбрасывает форму при открытии другого трека — состояние инициализируется сразу, без мигания */
  return <TrackEditForm key={track.id} track={track} onClose={onClose} onSave={onSave} tracks={tracks} />
}

function TrackEditForm({ track, onClose, onSave, tracks }: TrackEditModalProps & { track: Track }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [album, setAlbum] = useState(track.album)
  const [genre, setGenre] = useState(track.genre)
  const [saving, setSaving] = useState(false)
  const [eqGains, setEqGains] = useState(track.eqGains ?? null)
  const [eqOpen, setEqOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [cover, setCover] = useState<string | null>(track.cover ?? null)
  const [coverFile, setCoverFile] = useState<string | null>(track.coverFile ?? null)
  const [speed, setSpeed] = useState(track.playbackRate ?? 1)
  /* Анимированная обложка: видна, пока трек играет; в списках — статичная cover */
  const [animFile, setAnimFile] = useState<string | null>(track.animCoverFile ?? null)
  const [animUrl, setAnimUrl] = useState<string | null>(null)
  const [discordHidden, setDiscordHidden] = useState(track.discordHidden === true)
  const [isMakingGif, setIsMakingGif] = useState(false)
  const [isPickingCover, setIsPickingCover] = useState(false)
  const [isBorrowOpen, setIsBorrowOpen] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /* Превью анимации: файл уже лежит в covers, читаем его как blob */
  useEffect(() => {
    let alive = true
    let url: string | null = null
    loadCoverUrl(animFile).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      url = u
      setAnimUrl(u)
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [animFile])

  /* GIF и заставка из него сохраняются как пара: анимация + статичная обложка */
  const applyVisual = async (bytes: Uint8Array, ext: string, poster?: Uint8Array) => {
    const stamp = Date.now()
    if (ext === 'gif' && poster) {
      const [gif, still] = await Promise.all([
        saveCoverFromBytes(`tra-${track.id}-${stamp}`, bytes, 'gif'),
        saveCoverFromBytes(`tr-${track.id}-${stamp}`, poster, 'jpg'),
      ])
      if (!gif || !still || !mountedRef.current) return
      setCover(still.coverUrl)
      setCoverFile(still.coverFile)
      setAnimFile(gif.coverFile)
    } else {
      const saved = await saveCoverFromBytes(`tr-${track.id}-${stamp}`, bytes, ext)
      if (!saved || !mountedRef.current) return
      setCover(saved.coverUrl)
      setCoverFile(saved.coverFile)
      setAnimFile(null)
    }
  }

  const makeFromTrackVideo = async () => {
    if (isMakingGif) return
    setIsMakingGif(true)
    try {
      const result = await requestVideoGif(track.filePath, 'track')
      if (result) await applyVisual(result.gif, 'gif', result.poster)
    } finally {
      if (mountedRef.current) setIsMakingGif(false)
    }
  }

  /* Capture-фаза на window: Escape закрывает только модалку и не доходит до списка треков */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.player-dialog-overlay:not(.closing)')) return
      if (saving || eqOpen || lyricsOpen || e.key !== 'Escape' || isBorrowOpen || isMakingGif || isPickingCover) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, isBorrowOpen, isMakingGif, isPickingCover, saving, eqOpen, lyricsOpen])

  const pickCover = async () => {
    if (isPickingCover) return
    setIsPickingCover(true)
    try {
      /* Видео сразу открывает окно «Анимация из видео», GIF становится анимацией с заставкой */
      const picked = await pickVisual({ filterName: t('settings.profile.imagesFilter'), purpose: 'track', maxBytes: 5 * 1024 * 1024 })
      if (picked) await applyVisual(picked.bytes, picked.ext, picked.poster)
    } catch (e) {
      console.error('Ошибка выбора обложки:', e)
    } finally {
      if (mountedRef.current) setIsPickingCover(false)
    }
  }

  const borrowCover = async (source: Track) => {
    setIsBorrowOpen(false)
    if (!source.coverFile) return
    const copied = await copyCover(`tr-${track.id}`, source.coverFile)
    if (copied && mountedRef.current) { setCover(copied.coverUrl); setCoverFile(copied.coverFile); setAnimFile(null) }
  }

  const handleSave = async () => {
    if (saving) return
    const t2 = title.trim()
    if (!t2) return
    const updates: TrackUpdates = { eqGains }
    if (t2 !== track.title) updates.title = t2
    const a = artist.trim()
    if (a !== track.artist) updates.artist = a
    if (album.trim() !== track.album) updates.album = album.trim()
    if (genre.trim() !== track.genre) updates.genre = genre.trim()
    if (cover !== (track.cover ?? null)) { updates.cover = cover; updates.coverFile = coverFile }
    if (speed !== (track.playbackRate ?? 1)) updates.playbackRate = speed
    if (animFile !== (track.animCoverFile ?? null)) updates.animCoverFile = animFile
    if (discordHidden !== (track.discordHidden === true)) updates.discordHidden = discordHidden
    setSaving(true)
    try {
      if (updates.title !== undefined || updates.artist !== undefined || updates.album !== undefined || updates.genre !== undefined) {
        await invoke('write_track_tags', { path: track.filePath, title: t2, artist: a, album: album.trim(), genre: genre.trim() })
      }
      onSave(track.id, updates)
      onClose()
    } catch (error) {
      reportError('tagsSave', error)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const pct = ((speed - 0.5) / 1.5) * 100

  return createPortal(
    <div className="tem-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="tem-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tem-head">
          <div>
            <div className="tem-title">{t('views.trackEdit.title')}</div>
            <div className="tem-subtitle">{t('views.trackEdit.subtitle')}</div>
          </div>
          <button className="tem-close" disabled={saving} onClick={onClose} title={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="tem-cover-row">
          <div className="tem-cover" key={(animUrl ?? cover) ?? 'none'}>
            {animUrl ? <SafeImage src={animUrl} alt="" /> : cover ? <SafeImage src={cover} alt="" /> : <MusicIcon />}
            {animFile && <span className="tem-gif-badge">GIF</span>}
          </div>
          <div className="tem-cover-actions">
            <button className="tem-btn" onClick={pickCover} disabled={isPickingCover}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
              {t('views.trackEdit.chooseCover')}
            </button>
            {tracks && (
              <button className="tem-btn" onClick={() => setIsBorrowOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                {t('coverPicker.fromTrack')}
              </button>
            )}
            {isVideoPath(track.filePath) && (
              <button className="tem-btn" onClick={makeFromTrackVideo} disabled={isMakingGif}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="15" height="14" rx="2" /><polygon points="22 7 17 11 17 13 22 17 22 7" /></svg>
                {t('views.trackEdit.fromVideo')}
              </button>
            )}
            {animFile && (
              <button className="tem-btn" onClick={() => setAnimFile(null)}>
                {t('views.trackEdit.removeAnim')}
              </button>
            )}
            <button className="tem-btn" onClick={() => { setCover(null); setCoverFile(null); setAnimFile(null) }} disabled={!cover && !animFile}>
              {t('views.trackEdit.removeCover')}
            </button>
            <div className="tem-hint">{t(animFile ? 'views.trackEdit.animHint' : 'views.trackEdit.hint')}</div>
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

        <label className="tem-label" htmlFor="temAlbum">{t('views.trackEdit.albumLabel')}</label>
        <input id="temAlbum" className="tem-input" value={album} onChange={(e) => setAlbum(e.target.value)} />
        <label className="tem-label" htmlFor="temGenre">{t('views.trackEdit.genreLabel')}</label>
        <input id="temGenre" className="tem-input" value={genre} onChange={(e) => setGenre(e.target.value)} />
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

        <label className="tem-switch">
          <span className="tem-switch-text">
            <span className="tem-label">{t('views.trackEdit.discordHidden')}</span>
            <span className="tem-hint">{t('views.trackEdit.discordHiddenDesc')}</span>
          </span>
          <span className="toggle">
            <input type="checkbox" checked={discordHidden} onChange={(e) => setDiscordHidden(e.target.checked)} />
            <span className="toggle-slider"></span>
          </span>
        </label>

        <div className="tem-section-title">{t('views.trackEdit.extraTitle')}</div>
        <div className="tem-extra">
          <button type="button" className="tem-tile" onClick={() => setLyricsOpen(true)}>
            <span className="tem-tile-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h10M4 18h7" /><path d="M17 14v6" /><circle cx="15.5" cy="20" r="1.5" /><path d="M17 14l3 -1" /></svg>
            </span>
            <span className="tem-tile-text">
              <span className="tem-tile-title">{t('views.trackEdit.lyricsEdit')}</span>
              <span className="tem-tile-sub">{t('views.trackEdit.lyricsHint')}</span>
            </span>
            <svg className="tem-tile-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>

          <div className={`tem-tile tem-tile-eq ${eqGains ? 'is-custom' : ''}`}>
            <button type="button" className="tem-tile-main" onClick={() => setEqOpen(true)}>
              <span className="tem-tile-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 4v16M12 4v16M18 4v16" /><circle cx="6" cy="14" r="2" fill="currentColor" /><circle cx="12" cy="8" r="2" fill="currentColor" /><circle cx="18" cy="16" r="2" fill="currentColor" /></svg>
              </span>
              <span className="tem-tile-text">
                <span className="tem-tile-title">
                  {t('views.trackEdit.trackEq')}
                  {eqGains && <span className="tem-tile-dot" aria-hidden="true" />}
                </span>
                <span className="tem-tile-sub">{t(eqGains ? 'views.trackEdit.eqCustom' : 'views.trackEdit.eqGlobal')}</span>
              </span>
              {!eqGains && (
                <svg className="tem-tile-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              )}
            </button>
            {eqGains && (
              <button type="button" className="tem-tile-reset" onClick={() => setEqGains(null)} title={t('views.trackEdit.globalEq')}>
                {t('views.trackEdit.eqReset')}
              </button>
            )}
          </div>
        </div>
        <LyricsEditor path={lyricsOpen ? track.filePath : null} onClose={() => setLyricsOpen(false)} />
        <EqEditorModal
          target={eqOpen ? { id: 'track', name: title, gains: eqGains ? normalizeGains(eqGains) : FLAT_GAINS } : null}
          onCancel={() => setEqOpen(false)}
          onSave={(preset) => {
            setEqGains(preset.gains)
            setEqOpen(false)
          }}
          onPreview={() => {}}
        />
        <div className="tem-actions">
          <button className="tem-btn" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
          <button className="tem-btn tem-btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>{t('common.save')}</button>
        </div>
      </div>
      {tracks && (
        <CoverPicker
          open={isBorrowOpen}
          tracks={tracks}
          excludeId={track.id}
          onPick={borrowCover}
          onClose={() => setIsBorrowOpen(false)}
        />
      )}
    </div>,
    document.body
  )
}