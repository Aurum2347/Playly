import { useState } from 'react'
import { useI18n } from '../../i18n'
import './QueueAddButton.css'

/** Кнопка слева от длительности: добавить трек в ручную очередь (видна при наведении на строку) */
export default function QueueAddButton({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={`tr-queue-btn ${done ? 'done' : ''}`}
      title={t('queue.add')}
      aria-label={t('queue.add')}
      onClick={(e) => {
        e.stopPropagation()
        onAdd()
        setDone(true)
        window.setTimeout(() => setDone(false), 900)
      }}
    >
      {done ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="11" y2="18" /><line x1="18" y1="13" x2="18" y2="21" /><line x1="14" y1="17" x2="22" y2="17" /></svg>
      )}
    </button>
  )
}

export const QueueIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="15" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="11" y2="18" /><line x1="18" y1="13" x2="18" y2="21" /><line x1="14" y1="17" x2="22" y2="17" /></svg>
)

export const CoverIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
)
