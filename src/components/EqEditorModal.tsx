import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import {
  BUILTIN_EQ_PRESETS,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  FLAT_GAINS,
  bandLabel,
  type EqPreset,
} from '../lib/equalizer'
import EqCurve from './EqCurve'
import './FrameEditor.css'
import './Equalizer.css'

export interface EqEditTarget {
  /* null — новый пресет */
  id: string | null
  name: string
  gains: number[]
}

interface EqEditorModalProps {
  target: EqEditTarget | null
  onCancel: () => void
  onSave: (preset: EqPreset) => void
  onDelete?: (id: string) => void
  /* Слышно сразу: пока окно открыто, эквалайзер играет черновик */
  onPreview: (gains: number[] | null) => void
}

/* Доля высоты дорожки, на которую центр ползунка не заходит (радиус ручки) */
const RAIL_INSET = 0.06

const fmtDb = (v: number) => (v > 0 ? `+${v}` : String(v))
const roundHalf = (v: number) => Math.round(v * 2) / 2
const clampDb = (v: number) => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, roundHalf(v)))

/* ===== Вертикальный ползунок полосы ===== */
function BandSlider({ value, freq, onChange }: { value: number; freq: number; onChange: (v: number) => void }) {
  const railRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
  })

  const toPct = (db: number) => {
    const ratio = (db - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB)
    return (RAIL_INSET + ratio * (1 - RAIL_INSET * 2)) * 100
  }

  const fromY = (clientY: number) => {
    const rail = railRef.current
    if (!rail) return valueRef.current
    const rect = rail.getBoundingClientRect()
    const ratio = 1 - (clientY - rect.top) / rect.height
    const r = (ratio - RAIL_INSET) / (1 - RAIL_INSET * 2)
    return clampDb(EQ_MIN_DB + r * (EQ_MAX_DB - EQ_MIN_DB))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).focus()
    onChangeRef.current(fromY(e.clientY))
    const move = (ev: PointerEvent) => onChangeRef.current(fromY(ev.clientY))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /* Колёсико — по полдецибела; слушаем нативно, чтобы отменить прокрутку */
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      onChangeRef.current(clampDb(valueRef.current + (e.deltaY < 0 ? 0.5 : -0.5)))
    }
    rail.addEventListener('wheel', onWheel, { passive: false })
    return () => rail.removeEventListener('wheel', onWheel)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 3 : 0.5
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'PageUp') next = value + step
    else if (e.key === 'ArrowDown' || e.key === 'PageDown') next = value - step
    else if (e.key === 'Home') next = EQ_MAX_DB
    else if (e.key === 'End') next = EQ_MIN_DB
    else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') next = 0
    if (next === null) return
    e.preventDefault()
    onChange(clampDb(next))
  }

  const pos = toPct(value)
  const zero = toPct(0)

  return (
    <div className="eqe-band">
      <span className={`eqe-band-value ${value > 0 ? 'up' : value < 0 ? 'down' : ''}`}>{fmtDb(value)}</span>
      <div
        ref={railRef}
        className="eqe-rail"
        role="slider"
        tabIndex={0}
        aria-valuemin={EQ_MIN_DB}
        aria-valuemax={EQ_MAX_DB}
        aria-valuenow={value}
        aria-label={`${bandLabel(freq)} Hz`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange(0)}
      >
        <span className="eqe-rail-line" />
        <span
          className="eqe-rail-fill"
          style={{ bottom: `${Math.min(pos, zero)}%`, height: `${Math.abs(pos - zero)}%` }}
        />
        <span className="eqe-thumb" style={{ bottom: `${pos}%` }} />
      </div>
      <span className="eqe-band-freq">{bandLabel(freq)}</span>
    </div>
  )
}

export default function EqEditorModal({ target, onCancel, onSave, onDelete, onPreview }: EqEditorModalProps) {
  const { t } = useI18n()
  const [name, setName] = useState(target?.name ?? '')
  const [gains, setGains] = useState<number[]>(target?.gains ?? FLAT_GAINS)
  const [openedFor, setOpenedFor] = useState<EqEditTarget | null>(null)
  if (target !== openedFor) {
    setOpenedFor(target)
    if (target) {
      setName(target.name)
      setGains([...target.gains])
    }
  }

  const isOpen = target !== null

  /* Черновик звучит сразу */
  useEffect(() => {
    if (isOpen) onPreview(gains)
  }, [isOpen, gains, onPreview])

  const close = () => {
    onPreview(null)
    onCancel()
  }

  const save = () => {
    if (!target) return
    onPreview(null)
    onSave({
      id: target.id ?? `custom-${Date.now()}`,
      name: name.trim() || t('eq.newName'),
      gains: gains.map(clampDb),
    })
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onPreview(null)
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, onCancel, onPreview])

  if (!target) return null

  const setBand = (i: number, v: number) => setGains((prev) => prev.map((g, j) => (j === i ? v : g)))

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="frame-modal eqe-modal">
        <div className="eqe-head">
          <div>
            <div className="frame-modal-title">{target.id ? t('eq.editTitle') : t('eq.newTitle')}</div>
            <div className="frame-modal-sub">{t('eq.editorSub')}</div>
          </div>
          <input
            className="eqe-name"
            value={name}
            maxLength={40}
            placeholder={t('eq.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          />
        </div>

        <div className="eqe-board">
          <div className="eqe-scale" aria-hidden="true">
            <span>+12</span><span>+6</span><span>0</span><span>−6</span><span>−12</span>
          </div>
          <div className="eqe-bands">
            <div className="eqe-curve-wrap" aria-hidden="true">
              <EqCurve gains={gains} alignToColumns yInset={RAIL_INSET} />
            </div>
            {EQ_BANDS.map((freq, i) => (
              <BandSlider key={freq} freq={freq} value={gains[i] ?? 0} onChange={(v) => setBand(i, v)} />
            ))}
          </div>
        </div>

        <div className="eqe-presets">
          <span className="eqe-presets-label">{t('eq.startFrom')}</span>
          {BUILTIN_EQ_PRESETS.map((p) => (
            <button key={p.id} className="eq-chip small" onClick={() => setGains([...p.gains])}>
              {t(`eq.preset_${p.id}`)}
            </button>
          ))}
        </div>

        <div className="frame-modal-actions">
          {target.id && onDelete && (
            <button
              className="btn btn-danger"
              onClick={() => {
                onPreview(null)
                onDelete(target.id as string)
                onCancel()
              }}
            >
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={() => setGains([...FLAT_GAINS])}>{t('eq.resetBands')}</button>
          <button className="btn" onClick={close}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
