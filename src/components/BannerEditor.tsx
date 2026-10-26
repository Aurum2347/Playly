import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { BannerBlur, CoverPick, Playlist, PlaylistBanner } from '../App'
import { useI18n } from '../i18n'
import { FramePreview, ZoomControl } from './FrameEditor'
import { BannerLayers } from './PlaylistBanner'
import DiceIcon from './DiceIcon'
import { sliderPercent } from './views/settings/helpers'
import { DEFAULT_FRAME } from '../lib/imageFrame'
import { randomGradient } from '../lib/gradients'
import './ProfileLookEditor.css'

const BANNER_DEFAULTS: Omit<PlaylistBanner, 'file' | 'url'> = {
  frame: DEFAULT_FRAME,
  blur: 'left',
  blurAmount: 14,
  blurSize: 55,
  dim: 0.35,
}

type BannerMode = 'image' | 'gradient'

interface BannerEditorProps {
  /* null — окно закрыто */
  playlist: Playlist | null
  onClose: () => void
  onSave: (playlistId: number, banner: PlaylistBanner | null) => void
  onPickFile: () => Promise<CoverPick | null>
}

const BLUR_MODES: BannerBlur[] = ['none', 'left', 'right', 'both', 'all']
const MODES: BannerMode[] = ['image', 'gradient']

function Range({ label, value, min, max, display, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  display: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className={`banner-editor-field ${disabled ? 'disabled' : ''}`}>
      <div className="banner-editor-label">
        <span>{label}</span>
        <span>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        style={{ '--val': `${sliderPercent(value, min, max)}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export default function BannerEditor({ playlist, onClose, onSave, onPickFile }: BannerEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<PlaylistBanner | null>(playlist?.banner ?? null)
  const [mode, setMode] = useState<BannerMode>(playlist?.banner?.mode === 'gradient' ? 'gradient' : 'image')
  const [openedFor, setOpenedFor] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)

  const id = playlist?.id ?? null
  if (id !== openedFor) {
    setOpenedFor(id)
    setDraft(playlist?.banner ?? null)
    setMode(playlist?.banner?.mode === 'gradient' ? 'gradient' : 'image')
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
        mode: 'image',
        frame: BANNER_DEFAULTS.frame,
        file: file.coverFile,
        url: file.coverUrl,
      }))
      setMode('image')
    } finally {
      setPicking(false)
    }
  }

  const patch = (p: Partial<PlaylistBanner>) => setDraft((prev) => (prev ? { ...prev, ...p } : prev))

  /* Градиент: при первом переключении сразу предлагаем случайный — пустой экран не нужен */
  const switchMode = (m: BannerMode) => {
    setMode(m)
    if (m === 'gradient' && !draft?.gradient) {
      setDraft((prev) => ({ ...BANNER_DEFAULTS, ...(prev ?? { file: '' }), gradient: randomGradient() }))
    }
  }

  const shuffle = () => setDraft((prev) => ({ ...BANNER_DEFAULTS, ...(prev ?? { file: '' }), gradient: randomGradient() }))

  /* Что увидит плейлист с текущим режимом */
  const shown: PlaylistBanner | null = draft ? { ...draft, mode } : null
  const hasImage = mode === 'image' && !!draft?.url
  const hasGradient = mode === 'gradient' && !!draft?.gradient
  const blurLabel = (m: BannerBlur) => t(`banner.blur_${m}`)
  const blurOff = !draft || draft.blur === 'none'
  const g = draft?.gradient

  const save = () => {
    let result: PlaylistBanner | null = null
    /* Картинка от прежнего баннера больше не нужна — очистка кеша её уберёт */
    if (draft && mode === 'gradient' && draft.gradient) result = { ...draft, mode: 'gradient', file: '', url: null }
    else if (draft && mode === 'image' && draft.url) result = { ...draft, mode: 'image' }
    onSave(playlist.id, result)
    onClose()
  }

  const sample = (
    <div className="banner-editor-sample">
      <small>{t('views.playlist.label')}</small>
      <strong>{playlist.name}</strong>
    </div>
  )

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame-modal wide">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('banner.title')}</div>
          <div className="frame-modal-sub">{t('banner.subtitle')}</div>
        </div>

        <div className="segmented">
          {MODES.map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => switchMode(m)}>
              {t(`banner.mode_${m}`)}
            </button>
          ))}
        </div>

        {hasImage && shown ? (
          <FramePreview
            src={draft?.url as string}
            frame={draft!.frame}
            onChange={(frame) => patch({ frame })}
            className="banner-editor-preview"
            image={<BannerLayers banner={shown} />}
          >
            {sample}
          </FramePreview>
        ) : hasGradient && shown ? (
          <div className="banner-editor-preview frame-box banner-editor-gradient">
            <BannerLayers banner={shown} />
            {sample}
          </div>
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

        {hasImage && draft && (
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

              <Range label={t('banner.blurAmount')} value={draft.blurAmount} min={1} max={40} display={`${draft.blurAmount}px`} disabled={blurOff} onChange={(blurAmount) => patch({ blurAmount })} />
              <Range label={t('banner.blurSize')} value={draft.blurSize} min={10} max={100} display={`${draft.blurSize}%`} disabled={blurOff || draft.blur === 'all'} onChange={(blurSize) => patch({ blurSize })} />
              <Range label={t('banner.dim')} value={Math.round(draft.dim * 100)} min={0} max={80} display={`${Math.round(draft.dim * 100)}%`} onChange={(v) => patch({ dim: v / 100 })} />

              <div className="banner-editor-field">
                <div className="banner-editor-label"><span>{t('banner.image')}</span></div>
                <div className="banner-editor-file">
                  <button className="btn" onClick={pick} disabled={picking}>
                    {picking ? t('common.loading') : t('banner.change')}
                  </button>
                  <button className="btn btn-danger" onClick={() => setDraft((prev) => (prev ? { ...prev, url: null, file: '' } : prev))}>
                    {t('banner.remove')}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {hasGradient && draft && g && (
          <div className="banner-editor-grid">
            <div className="banner-editor-field full">
              <div className="look-editor-gradient">
                <label className="look-editor-color">
                  <span className="look-editor-swatch" style={{ background: g.from }}>
                    <input type="color" value={g.from} onChange={(e) => patch({ gradient: { ...g, from: e.target.value } })} />
                  </span>
                  {t('look.gradientFrom')}
                </label>
                <label className="look-editor-color">
                  <span className="look-editor-swatch" style={{ background: g.to }}>
                    <input type="color" value={g.to} onChange={(e) => patch({ gradient: { ...g, to: e.target.value } })} />
                  </span>
                  {t('look.gradientTo')}
                </label>
                <button className="btn look-editor-random" onClick={shuffle} title={t('look.randomDesc')}>
                  <DiceIcon />
                  {t('look.random')}
                </button>
              </div>
            </div>
            <Range label={t('look.angle')} value={g.angle} min={0} max={360} display={`${g.angle}°`} onChange={(angle) => patch({ gradient: { ...g, angle } })} />
            <Range label={t('banner.dim')} value={Math.round(draft.dim * 100)} min={0} max={80} display={`${Math.round(draft.dim * 100)}%`} onChange={(v) => patch({ dim: v / 100 })} />
          </div>
        )}

        <div className="frame-modal-actions">
          {(hasImage || hasGradient) && (
            <>
              <button className="btn btn-ghost" onClick={() => setDraft(null)}>{t('banner.remove')}</button>
              <span className="spacer" />
            </>
          )}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
