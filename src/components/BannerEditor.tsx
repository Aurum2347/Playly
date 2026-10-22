import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { BannerBlur, CoverPick, Playlist, PlaylistBanner } from '../App'
import { useI18n } from '../i18n'
import { FramePreview, ZoomControl } from './FrameEditor'
import { BannerLayers } from './PlaylistBanner'
import { sliderPercent } from './views/settings/helpers'
import { DEFAULT_FRAME } from '../lib/imageFrame'

const BANNER_DEFAULTS: Omit<PlaylistBanner, 'file' | 'url'> = {
  frame: DEFAULT_FRAME,
  blur: 'left',
  blurAmount: 14,
  blurSize: 55,
  dim: 0.35,
}

interface BannerEditorProps {
  /* null — окно закрыто */
  playlist: Playlist | null
  onClose: () => void
  onSave: (playlistId: number, banner: PlaylistBanner | null) => void
  onPickFile: () => Promise<CoverPick | null>
}

const BLUR_MODES: BannerBlur[] = ['none', 'left', 'right', 'both', 'all']

export default function BannerEditor({ playlist, onClose, onSave, onPickFile }: BannerEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<PlaylistBanner | null>(playlist?.banner ?? null)
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)

  const id = playlist?.id ?? null
  if (id !== openedFor) {
    setOpenedFor(id)
    setDraft(playlist?.banner ?? null)
  }

  useEffect(() => {
    if (id === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, onClose])

  if (!playlist) return null

  const pick = async () => {
    if (picking) return
    setPicking(true)
    try {
      const file = await onPickFile()
      if (!file) return
      /* Новая картинка — новый кадр, а настройки размытия сохраняем */
      setDraft((prev) => ({
        ...BANNER_DEFAULTS,
        ...(prev ?? {}),
        frame: BANNER_DEFAULTS.frame,
        file: file.coverFile,
        url: file.coverUrl,
      }))
    } finally {
      setPicking(false)
    }
  }

  const patch = (p: Partial<PlaylistBanner>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev))

  const blurLabel = (m: BannerBlur) => t(`banner.blur_${m}`)
  const blurOff = !draft || draft.blur === 'none'

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame-modal wide">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('banner.title')}</div>
          <div className="frame-modal-sub">{t('banner.subtitle')}</div>
        </div>

        {draft?.url ? (
          <FramePreview
            src={draft.url}
            frame={draft.frame}
            onChange={(frame) => patch({ frame })}
            className="banner-editor-preview"
            image={<BannerLayers banner={draft} />}
          >
            <div className="banner-editor-sample">
              <small>{t('views.playlist.label')}</small>
              <strong>{playlist.name}</strong>
            </div>
          </FramePreview>
        ) : (
          <div className="banner-editor-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><polyline points="21 16 15 11 5 19" />
            </svg>
            {t('banner.empty')}
            <button className="btn btn-primary" onClick={pick} disabled={picking}>
              {picking ? t('common.loading') : t('banner.choose')}
            </button>
          </div>
        )}

        {draft?.url && (
          <>
            <div className="frame-modal-sub">{t('frame.hint')}</div>
            <div className="banner-editor-grid">
              <div className="banner-editor-field full">
                <div className="banner-editor-label"><span>{t('banner.zoom')}</span></div>
                <ZoomControl frame={draft.frame} onChange={(frame) => patch({ frame })} />
              </div>

              <div className="banner-editor-field full">
                <div className="banner-editor-label"><span>{t('banner.blur')}</span></div>
                <div className="segmented">
                  {BLUR_MODES.map((m) => (
                    <button key={m} className={draft.blur === m ? 'active' : ''} onClick={() => patch({ blur: m })}>
                      {blurLabel(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`banner-editor-field ${blurOff ? 'disabled' : ''}`}>
                <div className="banner-editor-label">
                  <span>{t('banner.blurAmount')}</span>
                  <span>{draft.blurAmount}px</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={draft.blurAmount}
                  style={{ '--val': `${sliderPercent(draft.blurAmount, 1, 40)}%` } as CSSProperties}
                  onChange={(e) => patch({ blurAmount: Number(e.target.value) })}
                />
              </div>

              <div className={`banner-editor-field ${blurOff || draft.blur === 'all' ? 'disabled' : ''}`}>
                <div className="banner-editor-label">
                  <span>{t('banner.blurSize')}</span>
                  <span>{draft.blurSize}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={draft.blurSize}
                  style={{ '--val': `${sliderPercent(draft.blurSize, 10, 100)}%` } as CSSProperties}
                  onChange={(e) => patch({ blurSize: Number(e.target.value) })}
                />
              </div>

              <div className="banner-editor-field">
                <div className="banner-editor-label">
                  <span>{t('banner.dim')}</span>
                  <span>{Math.round(draft.dim * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={Math.round(draft.dim * 100)}
                  style={{ '--val': `${sliderPercent(draft.dim * 100, 0, 80)}%` } as CSSProperties}
                  onChange={(e) => patch({ dim: Number(e.target.value) / 100 })}
                />
              </div>

              <div className="banner-editor-field">
                <div className="banner-editor-label"><span>{t('banner.image')}</span></div>
                <div className="banner-editor-file">
                  <button className="btn" onClick={pick} disabled={picking}>
                    {picking ? t('common.loading') : t('banner.change')}
                  </button>
                  <button className="btn btn-danger" onClick={() => setDraft(null)}>{t('banner.remove')}</button>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="frame-modal-actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(playlist.id, draft ? { ...draft } : null)
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
