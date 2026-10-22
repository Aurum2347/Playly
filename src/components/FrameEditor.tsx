import { useRef, type CSSProperties, type ReactNode } from 'react'
import {
  DEFAULT_FRAME,
  FRAME_MAX_ZOOM,
  FRAME_MIN_ZOOM,
  frameStyle,
  usePanZoom,
  type ImageFrame,
} from '../lib/imageFrame'
import { useI18n } from '../i18n'
import './FrameEditor.css'

interface FramePreviewProps {
  src: string
  frame: ImageFrame
  onChange: (f: ImageFrame) => void
  className?: string
  style?: CSSProperties
  /* Слои поверх картинки (размытие баннера, затемнение и т.п.) */
  children?: ReactNode
  /* Своя отрисовка картинки (например, баннер со слоями); внутри должен быть <img> */
  image?: ReactNode
}

/** Рамка, в которой картинку двигают мышью и приближают колёсиком */
export function FramePreview({ src, frame, onChange, className, style, children, image }: FramePreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { onPointerDown } = usePanZoom(boxRef, frame, onChange)

  return (
    <div ref={boxRef} className={`frame-box ${className ?? ''}`} style={style} onPointerDown={onPointerDown}>
      {image ?? <img src={src} alt="" draggable={false} style={frameStyle(frame)} />}
      {children}
    </div>
  )
}

/** Ползунок масштаба с кнопками −/+ и сбросом кадра */
export function ZoomControl({ frame, onChange }: { frame: ImageFrame; onChange: (f: ImageFrame) => void }) {
  const { t } = useI18n()
  const step = (dir: number) =>
    onChange({ ...frame, zoom: Math.max(FRAME_MIN_ZOOM, Math.min(FRAME_MAX_ZOOM, +(frame.zoom + dir * 0.25).toFixed(2))) })
  const pct = ((frame.zoom - FRAME_MIN_ZOOM) / (FRAME_MAX_ZOOM - FRAME_MIN_ZOOM)) * 100
  const isDefault = frame.zoom === 1 && frame.x === 50 && frame.y === 50

  return (
    <div className="zoom-control">
      <button className="icon-btn" onClick={() => step(-1)} disabled={frame.zoom <= FRAME_MIN_ZOOM} title={t('frame.zoomOut')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
      </button>
      <input
        type="range"
        min={FRAME_MIN_ZOOM}
        max={FRAME_MAX_ZOOM}
        step={0.01}
        value={frame.zoom}
        style={{ '--val': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange({ ...frame, zoom: Number(e.target.value) })}
      />
      <button className="icon-btn" onClick={() => step(1)} disabled={frame.zoom >= FRAME_MAX_ZOOM} title={t('frame.zoomIn')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
      </button>
      <span className="zoom-control-value">{Math.round(frame.zoom * 100)}%</span>
      <button className="btn btn-ghost zoom-control-reset" onClick={() => onChange(DEFAULT_FRAME)} disabled={isDefault}>
        {t('frame.reset')}
      </button>
    </div>
  )
}
