import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { FEEDBACK_EVENT, type FeedbackMessage } from '../lib/feedback'
import PlayerDialog from './PlayerDialog'

interface Item extends FeedbackMessage {
  id: number
  count: number
}

const NOTICE_MS = 4500
const MAX_NOTICES = 3

/**
 * Показывает сообщения из lib/feedback:
 * ошибки — по одной в окне (одинаковые подряд не дублируются, остальные ждут в очереди),
 * уведомления — тостами внизу (повтор того же сообщения обновляет счётчик, а не плодит копии).
 */
export default function FeedbackHost() {
  const { t } = useI18n()
  const [errors, setErrors] = useState<Item[]>([])
  const [closing, setClosing] = useState(false)
  const [notices, setNotices] = useState<Item[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, number>())

  useEffect(() => {
    const live = timers.current
    const dropNotice = (id: number) => {
      live.delete(id)
      setNotices((list) => list.filter((n) => n.id !== id))
    }
    const schedule = (id: number) => {
      window.clearTimeout(live.get(id))
      live.set(id, window.setTimeout(() => dropNotice(id), NOTICE_MS))
    }
    const onFeedback = (event: Event) => {
      const msg = (event as CustomEvent<FeedbackMessage>).detail
      if (!msg?.key) return
      if (msg.kind === 'error') {
        setErrors((list) =>
          list.some((e) => e.key === msg.key && e.details === msg.details)
            ? list
            : [...list, { ...msg, id: ++seq.current, count: 1 }]
        )
        return
      }
      setNotices((list) => {
        const same = list.find((n) => n.key === msg.key)
        if (same) {
          schedule(same.id)
          return list.map((n) => (n === same ? { ...n, vars: msg.vars, count: n.count + 1 } : n))
        }
        const item = { ...msg, id: ++seq.current, count: 1 }
        schedule(item.id)
        return [...list, item].slice(-MAX_NOTICES)
      })
    }
    window.addEventListener(FEEDBACK_EVENT, onFeedback)
    return () => {
      window.removeEventListener(FEEDBACK_EVENT, onFeedback)
      live.forEach((timer) => window.clearTimeout(timer))
      live.clear()
    }
  }, [])

  const current = errors[0]
  const closeError = () => {
    if (closing) return
    setClosing(true)
    /* Даём окну доиграть анимацию закрытия, затем показываем следующее из очереди */
    window.setTimeout(() => {
      setErrors((list) => list.slice(1))
      setClosing(false)
    }, 200)
  }

  return (
    <>
      <PlayerDialog open={!!current && !closing} title={t('feedback.errorTitle')} onClose={closeError} alert>
        <div className="feedback-error-body">
          <span className="feedback-error-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          </span>
          <p className="player-dialog-copy">{current ? t(`feedback.${current.key}`, current.vars) : ''}</p>
        </div>
        {current?.details && (
          <details className="player-error-details">
            <summary>{t('feedback.details')}</summary>
            <pre>{current.details}</pre>
          </details>
        )}
        <footer className="frame-modal-actions">
          {errors.length > 1 && <span className="feedback-queue">{t('feedback.more', { n: errors.length - 1 })}</span>}
          <button data-initial-focus className="btn btn-primary" onClick={closeError}>{t('common.close')}</button>
        </footer>
      </PlayerDialog>

      <div className="feedback-toasts" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className="feedback-toast">
            <span className="feedback-toast-dot" aria-hidden="true" />
            <span className="feedback-toast-text">{t(`feedback.${n.key}`, n.vars)}</span>
            {n.count > 1 && <span className="feedback-toast-count">×{n.count}</span>}
          </div>
        ))}
      </div>
    </>
  )
}
