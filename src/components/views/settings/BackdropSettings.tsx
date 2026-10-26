import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../i18n'
import { FramePreview, ZoomControl } from '../../FrameEditor'
import { BackdropLayers } from '../../AppBackdrop'
import { sliderPercent } from './helpers'
import { DEFAULT_FRAME } from '../../../lib/imageFrame'
import { pickVisual } from '../../../lib/media'
import {
  BACKDROP_DEFAULTS,
  removeBackdropImage,
  saveBackdropImage,
  type AppBackdrop,
  type BackdropMode,
} from '../../../lib/appearance'
import '../../PlaylistBanner.css'
import '../../AppBackdrop.css'

const MODES: BackdropMode[] = ['none', 'image', 'cover']
const MAX_BYTES = 40 * 1024 * 1024

interface BackdropSettingsProps {
  backdrop: AppBackdrop
  onChange: (b: AppBackdrop) => void
  /* Картинка фона (blob-url) и обложка играющего трека — для предпросмотра */
  imageUrl: string | null
  coverUrl: string | null
}

/** Строка в «Внешний вид»: миниатюра фона и кнопка «Настроить» */
export default function BackdropSettings({ backdrop, onChange, imageUrl, coverUrl }: BackdropSettingsProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const shown = { ...backdrop, url: imageUrl }

  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-name">{t('settings.appearance.backdrop')}</div>
        <div className="setting-desc">{t('settings.appearance.backdropDesc')}</div>
      </div>
      <div className="setting-control look-setting">
        <button className="look-thumb is-banner backdrop-thumb" onClick={() => setOpen(true)} title={t(`backdrop.mode_${backdrop.mode}`)}>
          {backdrop.mode === 'none' ? (
            <span className="backdrop-thumb-none">{t('backdrop.mode_none')}</span>
          ) : (
            <BackdropLayers backdrop={shown} coverUrl={coverUrl} />
          )}
        </button>
        <button className="btn" onClick={() => setOpen(true)}>{t('settings.profile.customize')}</button>
      </div>
      {open && (
        <BackdropEditor
          initial={shown}
          coverUrl={coverUrl}
          onClose={() => setOpen(false)}
          onSave={(b) => {
            onChange(b)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

interface RangeProps {
  label: string
  value: number
  min: number
  max: number
  display: string
  onChange: (v: number) => void
}

function Range({ label, value, min, max, display, onChange }: RangeProps) {
  return (
    <div className="banner-editor-field">
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

/* Схематичный интерфейс поверх фона в предпросмотре: видно, насколько читаются панели */
function MockUi({ alpha }: { alpha: number }) {
  return (
    <div className="bd-mock" style={{ '--ui-alpha': alpha } as CSSProperties} aria-hidden="true">
      <div className="bd-mock-top" />
      <div className="bd-mock-side">
        <i /><i /><i /><i />
      </div>
      <div className="bd-mock-main">
        <div className="bd-mock-card" />
        <div className="bd-mock-row"><i /><i /><i /></div>
      </div>
      <div className="bd-mock-player"><i /><b /></div>
    </div>
  )
}

interface EditorProps {
  initial: AppBackdrop
  coverUrl: string | null
  onClose: () => void
  onSave: (b: AppBackdrop) => void
}

function BackdropEditor({ initial, coverUrl, onClose, onSave }: EditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<AppBackdrop>(initial)
  const [pending, setPending] = useState<{ bytes: Uint8Array; ext: string; url: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickError, setPickError] = useState(false)

  useEffect(() => {
    if (!pending) return
    return () => URL.revokeObjectURL(pending.url)
  }, [pending])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const patch = (p: Partial<AppBackdrop>) => setDraft((d) => ({ ...d, ...p }))

  const pick = async () => {
    if (picking) return
    setPicking(true)
    setPickError(false)
    try {
      const picked = await pickVisual({ filterName: t('settings.profile.imagesFilter'), purpose: 'background', maxBytes: MAX_BYTES })
      if (!picked) return
      const url = URL.createObjectURL(new Blob([picked.bytes as unknown as BlobPart], { type: picked.ext === 'gif' ? 'image/gif' : 'image/*' }))
      setPending({ bytes: picked.bytes, ext: picked.ext, url })
      setDraft((d) => ({ ...d, mode: 'image', url, frame: DEFAULT_FRAME }))
    } catch (e) {
      console.error('Не удалось открыть картинку фона:', e)
      setPickError(true)
    } finally {
      setPicking(false)
    }
  }

  const setMode = (mode: BackdropMode) => {
    /* У обложки и своей картинки разные удачные значения эффектов — подставляем их при переключении */
    if (mode !== 'none' && mode !== draft.mode) patch({ mode, ...BACKDROP_DEFAULTS[mode] })
    else patch({ mode })
    if (mode === 'image' && !draft.url) void pick()
  }

  const resetEffects = () => {
    if (draft.mode !== 'none') patch(BACKDROP_DEFAULTS[draft.mode])
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      let next: AppBackdrop = { ...draft }
      if (next.mode === 'image' && pending) {
        next.file = await saveBackdropImage(pending.bytes, pending.ext, initial.file)
      } else if (next.mode !== 'image' && initial.file) {
        /* Картинка больше не нужна — не оставляем её лежать на диске */
        await removeBackdropImage(initial.file)
        next.file = null
      }
      if (next.mode === 'image' && !next.file) next = { ...next, mode: 'none' }
      onSave(next)
    } catch (e) {
      console.error('Не удалось сохранить фон:', e)
    } finally {
      setSaving(false)
    }
  }

  const hasImage = draft.mode === 'image' && !!draft.url
  const layers = <BackdropLayers backdrop={draft} coverUrl={coverUrl} />
  let preview: ReactNode
  if (hasImage) {
    preview = (
      <FramePreview src={draft.url as string} frame={draft.frame} onChange={(frame) => patch({ frame })} className="bd-preview" image={layers}>
        <MockUi alpha={draft.uiOpacity} />
      </FramePreview>
    )
  } else {
    preview = (
      <div className="bd-preview frame-box">
        {draft.mode !== 'none' && layers}
        <MockUi alpha={draft.mode === 'none' ? 1 : draft.uiOpacity} />
      </div>
    )
  }

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame-modal wide look-editor">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('backdrop.title')}</div>
          <div className="frame-modal-sub">{t('backdrop.subtitle')}</div>
        </div>

        <div className="look-editor-stage is-banner">{preview}</div>
        {hasImage && <div className="frame-modal-sub look-editor-hint">{t('frame.hint')}</div>}
        {draft.mode === 'cover' && (
          <div className="frame-modal-sub look-editor-hint">{coverUrl ? t('backdrop.coverHint') : t('backdrop.coverEmpty')}</div>
        )}
        {pickError && <div className="look-editor-error">{t('look.pickError')}</div>}

        <div className="banner-editor-grid">
          <div className="banner-editor-field full">
            <div className="banner-editor-label"><span>{t('look.mode')}</span></div>
            <div className="segmented">
              {MODES.map((m) => (
                <button key={m} className={draft.mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                  {t(`backdrop.mode_${m}`)}
                </button>
              ))}
            </div>
          </div>

          {draft.mode === 'image' && (
            <>
              {hasImage && (
                <div className="banner-editor-field full">
                  <div className="banner-editor-label"><span>{t('banner.zoom')}</span></div>
                  <ZoomControl frame={draft.frame} onChange={(frame) => patch({ frame })} />
                </div>
              )}
              <div className="banner-editor-field full">
                <div className="banner-editor-label"><span>{t('look.image')}</span></div>
                <div className="banner-editor-file">
                  <button className="btn" onClick={pick} disabled={picking}>
                    {picking ? t('common.loading') : hasImage ? t('look.change') : t('look.choose')}
                  </button>
                </div>
              </div>
            </>
          )}

          {draft.mode !== 'none' && (
            <>
              <Range label={t('backdrop.blur')} value={draft.blur} min={0} max={80} display={`${draft.blur}px`} onChange={(blur) => patch({ blur })} />
              <Range label={t('look.dim')} value={Math.round(draft.dim * 100)} min={0} max={90} display={`${Math.round(draft.dim * 100)}%`} onChange={(v) => patch({ dim: v / 100 })} />
              <Range label={t('backdrop.vignette')} value={Math.round(draft.vignette * 100)} min={0} max={100} display={`${Math.round(draft.vignette * 100)}%`} onChange={(v) => patch({ vignette: v / 100 })} />
              <Range label={t('backdrop.saturation')} value={draft.saturation} min={0} max={200} display={`${draft.saturation}%`} onChange={(saturation) => patch({ saturation })} />
              <Range label={t('backdrop.brightness')} value={draft.brightness} min={40} max={160} display={`${draft.brightness}%`} onChange={(brightness) => patch({ brightness })} />
              <Range label={t('backdrop.uiOpacity')} value={Math.round(draft.uiOpacity * 100)} min={20} max={100} display={`${Math.round(draft.uiOpacity * 100)}%`} onChange={(v) => patch({ uiOpacity: v / 100 })} />
            </>
          )}
        </div>

        <div className="frame-modal-actions">
          {draft.mode !== 'none' && (
            <>
              <button className="btn btn-ghost" onClick={resetEffects}>{t('backdrop.resetEffects')}</button>
              <span className="spacer" />
            </>
          )}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
