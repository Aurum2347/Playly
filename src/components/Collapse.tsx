import { useState, type ReactNode } from 'react'
import './Collapse.css'

interface CollapseProps {
  open: boolean
  children: ReactNode
  className?: string
}

/**
 * Плавно раскрывает/сворачивает блок по высоте (grid-template-rows 0fr ↔ 1fr),
 * поэтому всё, что ниже, едет вслед, а не прыгает. Пока идёт анимация, содержимое
 * обрезается; в раскрытом состоянии — нет, чтобы выпадающие списки внутри не резались.
 */
export default function Collapse({ open, children, className }: CollapseProps) {
  const [animating, setAnimating] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setAnimating(true)
  }

  return (
    <div
      className={`smooth-collapse ${open ? 'open' : ''} ${animating || !open ? 'clip' : ''} ${className ?? ''}`}
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setAnimating(false)
      }}
    >
      <div className="smooth-collapse-inner">{children}</div>
    </div>
  )
}
