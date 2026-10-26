import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../i18n'
import { ParticleCanvas, type ParticleLayer } from '../../AppBackdrop'
import { sliderPercent } from './helpers'
import { pickVisual } from '../../../lib/media'
import {
  customKind,
  PARTICLE_MOTIONS,
  PARTICLE_SHAPES,
  removeParticleImage,
  saveParticleImage,
  type CustomParticle,
  type ParticleBehavior,
  type ParticleMotion,
  type ParticleShape,
} from '../../../lib/appearance'

interface CustomParticleEditorProps {
  initial: CustomParticle
  isNew: boolean
  onClose: () => void
  onSave: (p: CustomParticle) => void
  onDelete: (p: CustomParticle) => void
}

/* Быстрые направления потока */
const DIRECTIONS: Array<{ deg: number; icon: string }> = [
  { deg: 0, icon: '↓' },
  { deg: 45, icon: '↘' },
  { deg: 90, icon: '→' },
  { deg: 180, icon: '↑' },
  { deg: -90, icon: '←' },
  { deg: -45, icon: '↙' },
]

const SHAPE_ICONS: Record<ParticleShape, ReactNode> = {
  dot: <circle cx="12" cy="12" r="6" />,
  glow: (
    <>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="8.5" opacity="0.35" />
    </>
  ),
  star: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" />,
  heart: <path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z" />,
  note: <path d="M10 17.5a2.5 2.5 0 1 1-1-2V5l9-2v10.5a2.5 2.5 0 1 1-1-2V6.2l-7 1.6z" />,
  square: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
}

function Range({ label, value, min, max, step = 1, display, onChange, disabled }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display: string
  onChange: (v: number) => void
  disabled?: boolean
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
        step={step}
        value={value}
        style={{ '--val': `${sliderPercent(value, min, max)}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** Два ползунка «от — до» для разброса значений */
function RangePair({ label, min, max, step = 1, lo, hi, unit, onChange }: {
  label: string
  min: number
  max: number
  step?: number
  lo: number
  hi: number
  unit: string
  onChange: (lo: number, hi: number) => void
}) {
  const fmt = (v: number) => (step < 1 ? v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(v)))
  return (
    <div className="banner-editor-field cp-pair">
      <div className="banner-editor-label">
        <span>{label}</span>
        <span>{fmt(lo)}–{fmt(hi)} {unit}</span>
      </div>
      <div className="cp-pair-sliders">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          style={{ '--val': `${sliderPercent(lo, min, max)}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange(v, Math.max(v, hi))
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          style={{ '--val': `${sliderPercent(hi, min, max)}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value)
            onChange(Math.min(lo, v), v)
          }}
        />
      </div>
    </div>
  )
}

export default function CustomParticleEditor({ initial, isNew, onClose, onSave, onDelete }: CustomParticleEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<CustomParticle>(initial)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState(false)
  /* Картинки, загруженные в этом окне: если его закрыть без сохранения, они не нужны */
  const [uploaded, setUploaded] = useState<string[]>([])

  const cancel = () => {
    uploaded.forEach((f) => void removeParticleImage(f))
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      uploaded.forEach((f) => void removeParticleImage(f))
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, uploaded])

  const b = draft.behavior
  const setB = (p: Partial<ParticleBehavior>) => setDraft((d) => ({ ...d, behavior: { ...d.behavior, ...p } }))

  const pick = async () => {
    if (picking) return
    setPicking(true)
    setPickError(false)
    try {
      const picked = await pickVisual({ filterName: t('settings.profile.imagesFilter'), purpose: 'cover', maxBytes: 8 * 1024 * 1024 })
      if (!picked) return
      const file = await saveParticleImage(picked.bytes, picked.ext)
      setUploaded((u) => [...u, file])
      setDraft((d) => ({
        ...d,
        source: { type: 'image', file, smoothing: d.source.type === 'image' ? d.source.smoothing : 'smooth' },
      }))
    } catch (e) {
      console.error('Не удалось загрузить картинку частицы:', e)
      setPickError(true)
    } finally {
      setPicking(false)
    }
  }

  const save = () => {
    /* Удаляем загруженные, но в итоге не выбранные картинки, и прежнюю, если её заменили */
    const keep = draft.source.type === 'image' ? draft.source.file : null
    uploaded.filter((f) => f !== keep).forEach((f) => void removeParticleImage(f))
    if (initial.source.type === 'image' && initial.source.file !== keep) void removeParticleImage(initial.source.file)
    onSave({ ...draft, name: draft.name.trim() || t('particles.customDefault') })
  }

  const layer = useMemo<ParticleLayer>(
    () => ({ kind: customKind(draft.id), density: 1, speed: 1, size: 1, opacity: 1, blur: 0, custom: draft }),
    [draft]
  )

  const shape = draft.source.type === 'shape' ? draft.source : null
  const image = draft.source.type === 'image' ? draft.source : null
  const motionLabel = (m: ParticleMotion) => t(`particles.motion_${m}`)

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="frame-modal wide cp-editor">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t(isNew ? 'particles.customNew' : 'particles.customEdit')}</div>
          <div className="frame-modal-sub">{t('particles.customSub')}</div>
        </div>

        <div className="cp-layout">
          <div className="cp-preview">
            <ParticleCanvas layer={layer} className="cp-preview-canvas" />
            <span className="cp-preview-label">{t('particles.preview')}</span>
          </div>

          <div className="cp-fields">
            <input
              className="input-field cp-name"
              value={draft.name}
              maxLength={40}
              placeholder={t('particles.customName')}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />

            <div className="banner-editor-field">
              <div className="banner-editor-label"><span>{t('particles.source')}</span></div>
              <div className="segmented">
                <button
                  className={shape ? 'active' : ''}
                  onClick={() => !shape && setDraft((d) => ({ ...d, source: { type: 'shape', shape: 'star', color: '#ffe08a' } }))}
                >
                  {t('particles.sourceShape')}
                </button>
                <button className={image ? 'active' : ''} onClick={() => (image ? undefined : void pick())}>
                  {t('particles.sourceImage')}
                </button>
              </div>
            </div>

            {shape && (
              <div className="cp-shapes">
                {PARTICLE_SHAPES.map((s) => (
                  <button
                    key={s}
                    className={`cp-shape ${shape.shape === s ? 'active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, source: { ...shape, shape: s } }))}
                    title={t(`particles.shape_${s}`)}
                  >
                    <svg viewBox="0 0 24 24" fill={shape.color} stroke="none">{SHAPE_ICONS[s]}</svg>
                  </button>
                ))}
                <label className="look-editor-swatch cp-color" style={{ background: shape.color }} title={t('particles.color')}>
                  <input type="color" value={shape.color} onChange={(e) => setDraft((d) => ({ ...d, source: { ...shape, color: e.target.value } }))} />
                </label>
              </div>
            )}

            {image && (
              <>
                <div className="banner-editor-file">
                  <button className="btn" onClick={pick} disabled={picking}>
                    {picking ? t('common.loading') : t('look.change')}
                  </button>
                  <span className="cp-file-hint">{t('particles.imageHint')}</span>
                </div>
                <div className="banner-editor-field">
                  <div className="banner-editor-label"><span>{t('particles.smoothing')}</span></div>
                  <div className="segmented">
                    <button
                      className={image.smoothing === 'smooth' ? 'active' : ''}
                      onClick={() => setDraft((d) => ({ ...d, source: { ...image, smoothing: 'smooth' } }))}
                    >
                      {t('particles.smoothing_smooth')}
                    </button>
                    <button
                      className={image.smoothing === 'pixelated' ? 'active' : ''}
                      onClick={() => setDraft((d) => ({ ...d, source: { ...image, smoothing: 'pixelated' } }))}
                    >
                      {t('particles.smoothing_pixelated')}
                    </button>
                  </div>
                </div>
              </>
            )}
            {pickError && <div className="look-editor-error">{t('look.pickError')}</div>}
          </div>
        </div>

        {/* ===== Поведение ===== */}
        <div className="banner-editor-field full">
          <div className="banner-editor-label"><span>{t('particles.motion')}</span></div>
          <div className="segmented">
            {PARTICLE_MOTIONS.map((m) => (
              <button key={m} className={b.motion === m ? 'active' : ''} onClick={() => setB({ motion: m })}>
                {motionLabel(m)}
              </button>
            ))}
          </div>
          <div className="frame-modal-sub">{t(`particles.motionDesc_${b.motion}`)}</div>
        </div>

        <div className="banner-editor-grid">
          {b.motion === 'flow' && (
            <>
              <div className="banner-editor-field">
                <div className="banner-editor-label">
                  <span>{t('particles.direction')}</span>
                  <span>{b.direction}°</span>
                </div>
                <div className="cp-direction">
                  <span className="cp-dial" style={{ '--deg': `${b.direction}deg` } as CSSProperties} aria-hidden="true">
                    <i />
                  </span>
                  <div className="cp-dir-buttons">
                    {DIRECTIONS.map((d) => (
                      <button key={d.deg} className={b.direction === d.deg ? 'active' : ''} onClick={() => setB({ direction: d.deg })}>
                        {d.icon}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={b.direction}
                  style={{ '--val': `${sliderPercent(b.direction, -180, 180)}%` } as CSSProperties}
                  onChange={(e) => setB({ direction: Number(e.target.value) })}
                />
              </div>
              <Range label={t('particles.spread')} value={b.spread} min={0} max={90} display={`±${b.spread}°`} onChange={(spread) => setB({ spread })} />
              <Range label={t('particles.sway')} value={b.sway} min={0} max={120} display={`${b.sway}px`} onChange={(sway) => setB({ sway })} />
              <Range label={t('particles.swayFreq')} value={b.swayFreq} min={0.05} max={4} step={0.05} display={b.swayFreq.toFixed(2)} disabled={b.sway === 0} onChange={(swayFreq) => setB({ swayFreq })} />
            </>
          )}
          <RangePair label={t('particles.speedRange')} min={0} max={b.motion === 'flow' ? 1200 : 200} lo={b.speedMin} hi={b.speedMax} unit={t('particles.pxPerSec')} onChange={(speedMin, speedMax) => setB({ speedMin, speedMax })} />
          <RangePair label={t('particles.sizeRange')} min={2} max={120} lo={b.sizeMin} hi={b.sizeMax} unit="px" onChange={(sizeMin, sizeMax) => setB({ sizeMin, sizeMax })} />
          <RangePair label={t('particles.opacityRange')} min={0.05} max={1} step={0.05} lo={b.opacityMin} hi={b.opacityMax} unit="" onChange={(opacityMin, opacityMax) => setB({ opacityMin, opacityMax })} />
          <Range label={t('particles.spin')} value={b.spin} min={0} max={3} step={0.05} display={`${b.spin.toFixed(2)} ${t('particles.turnsPerSec')}`} onChange={(spin) => setB({ spin })} />
          <Range label={t('particles.count')} value={draft.count} min={2} max={400} display={String(draft.count)} onChange={(count) => setDraft((d) => ({ ...d, count }))} />
          <div className="banner-editor-field cp-toggles">
            <label className="cp-toggle">
              <span>{t('particles.flip')}</span>
              <span className="toggle">
                <input type="checkbox" checked={b.flip} onChange={(e) => setB({ flip: e.target.checked })} />
                <span className="toggle-slider"></span>
              </span>
            </label>
            {b.motion !== 'flow' && (
              <label className="cp-toggle">
                <span>{t('particles.fade')}</span>
                <span className="toggle">
                  <input type="checkbox" checked={b.fade} onChange={(e) => setB({ fade: e.target.checked })} />
                  <span className="toggle-slider"></span>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="frame-modal-actions">
          {!isNew && (
            <>
              <button className="btn btn-danger" onClick={() => onDelete(initial)}>{t('common.delete')}</button>
              <span className="spacer" />
            </>
          )}
          <button className="btn" onClick={cancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
