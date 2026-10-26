import { useEffect, useState } from 'react'
import { formatClock, SESSION_START } from '../lib/listeningStats'

interface SessionClockProps {
  className?: string
  title?: string
}

/** Время текущей сессии (с запуска Playly). Тикает сам, не перерисовывая родителя */
export default function SessionClock({ className, title }: SessionClockProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    /* Подстраиваемся под границу секунды, чтобы цифры менялись ровно */
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(Date.now())
      timer = setTimeout(tick, 1000 - ((Date.now() - SESSION_START) % 1000) + 5)
    }
    timer = setTimeout(tick, 1000 - ((Date.now() - SESSION_START) % 1000) + 5)
    return () => clearTimeout(timer)
  }, [])

  return (
    <span className={`session-clock ${className ?? ''}`} title={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14" />
      </svg>
      <span className="session-clock-time">{formatClock((now - SESSION_START) / 1000)}</span>
    </span>
  )
}
