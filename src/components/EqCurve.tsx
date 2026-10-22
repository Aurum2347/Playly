import { useId } from 'react'
import { eqCurvePaths } from '../lib/equalizer'

interface EqCurveProps {
  gains: number[]
  className?: string
  /* Отступ по краям на половину колонки — чтобы точки встали по центрам ползунков */
  alignToColumns?: boolean
  /* Вертикальный отступ в долях высоты: совпадает с ходом ползунков */
  yInset?: number
}

const W = 1000
const H = 200

/** Плавная кривая АЧХ эквалайзера с заливкой */
export default function EqCurve({ gains, className, alignToColumns, yInset = 0.04 }: EqCurveProps) {
  /* useId может содержать символы, недопустимые в url(#…) */
  const gradId = `eqg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const pad = alignToColumns ? W / (gains.length * 2) : 0
  const { line, area } = eqCurvePaths(gains, W, H, pad, H * yInset)
  return (
    <svg className={`eq-curve ${className ?? ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <line className="eq-curve-zero" x1="0" x2={W} y1={H / 2} y2={H / 2} />
      <path d={area} fill={`url(#${gradId})`} />
      <path className="eq-curve-line" d={line} fill="none" />
    </svg>
  )
}
