import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from './views/shared'
import { useI18n } from '../i18n'
import './FrameEditor.css'

interface PlayerDialogProps {
  open: boolean
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  /* Идёт сохранение: окно нельзя закрыть ни крестиком, ни Escape, ни кликом мимо */
  busy?: boolean
  /* Сообщение об ошибке: поверх остальных окон, перехватывает клавиатуру */
  alert?: boolean
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]'

/** Общее модальное окно в стиле плеера: анимация, ловушка фокуса, Escape, возврат фокуса */
export default function PlayerDialog({ open, title, subtitle, children, onClose, wide = false, busy = false, alert = false }: PlayerDialogProps) {
  const presence = usePresence(open, 180)
  const titleId = useId()
  const root = useRef<HTMLDivElement>(null)
  const { t } = useI18n()

  /* Свежие значения для обработчика клавиш: он вешается один раз на открытие,
     иначе при каждом переключении busy фокус уезжал бы из окна и обратно */
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => {
    closeRef.current = onClose
    busyRef.current = busy
  }, [onClose, busy])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const initial =
      root.current?.querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)') ??
      root.current?.querySelector<HTMLElement>('textarea:not(:disabled), button:not(:disabled)')
    ;(initial ?? root.current)?.focus()

    const onKey = (event: KeyboardEvent) => {
      /* Открыто окно ошибки — клавиатура принадлежит ему */
      if (!alert && document.querySelector('.player-dialog-alert:not(.closing)')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!busyRef.current) closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = root.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes?.length) {
        event.preventDefault()
        root.current?.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [open, alert])

  if (!presence.mounted) return null
  return createPortal(
    <div
      className={`frame-modal-overlay player-dialog-overlay ${presence.closing ? 'closing' : ''} ${alert ? 'player-dialog-alert' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={root}
        tabIndex={-1}
        className={`frame-modal player-dialog ${wide ? 'wide' : ''}`}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="player-dialog-head">
          <div className="frame-modal-head">
            <h2 id={titleId} className="frame-modal-title">{title}</h2>
            {subtitle && <p className="frame-modal-sub">{subtitle}</p>}
          </div>
          <button className="player-close" aria-label={t('common.close')} disabled={busy} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body
  )
}
