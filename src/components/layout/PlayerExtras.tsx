import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { SESSION_SPEEDS } from '../../lib/audioEngine'
import { QueueIcon } from '../views/QueueAddButton'
import './PlayerExtras.css'

const label = (v: number) => `${String(Math.round(v * 100) / 100)}×`

/** Скорость сеанса: кнопка слева от лайка, список скоростей открывается вверх */
export function SpeedControl({ speed, onChange }: { speed: number; onChange?: (v: number) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="p-speed" ref={wrap}>
      <button
        type="button"
        className={`p-speed-btn ${speed !== 1 ? 'changed' : ''} ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={!onChange}
        title={t('speed.title')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label(speed)}
      </button>
      {open && (
        <div className="p-speed-menu" role="menu">
          <div className="p-speed-head">{t('speed.title')}</div>
          {[...SESSION_SPEEDS].reverse().map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={v === speed}
              className={`p-speed-item ${v === speed ? 'active' : ''}`}
              onClick={() => {
                onChange?.(v)
                setOpen(false)
              }}
            >
              {label(v)}
              {v === 1 && <span className="p-speed-note">{t('speed.normal')}</span>}
            </button>
          ))}
          <div className="p-speed-foot">{t('speed.resetNote')}</div>
        </div>
      )}
    </div>
  )
}

/** Кнопка очереди: число — сколько треков в ручной очереди */
export function QueueButton({ count, active, onClick }: { count: number; active: boolean; onClick?: () => void }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className={`p-queue-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={t('queue.title')}
      aria-pressed={active}
    >
      <QueueIcon />
      {count > 0 && <span className="p-queue-count">{count > 99 ? '99+' : count}</span>}
    </button>
  )
}
