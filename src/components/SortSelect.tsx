import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePresence } from './views/shared'
import './SortSelect.css'

export interface SortOptionDef<T extends string> {
  value: T
  label: string
  icon: ReactNode
  /* Заголовок группы — пишется над первым пунктом группы */
  group?: string
}

interface SortSelectProps<T extends string> {
  label: string
  value: T | null
  options: SortOptionDef<T>[]
  onChange: (value: T) => void
  /* Что показать, если ни один вариант не выбран (например, при перемешивании) */
  placeholder?: string
}

const SortIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="4" y1="6" x2="14" y2="6" /><line x1="4" y1="12" x2="11" y2="12" />
    <line x1="4" y1="18" x2="8" y2="18" /><polyline points="16 15 19 18 22 15" />
    <line x1="19" y1="6" x2="19" y2="18" />
  </svg>
)

export default function SortSelect<T extends string>({ label, value, options, onChange, placeholder }: SortSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const presence = usePresence(open, 160)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const current = options.find((o) => o.value === value) ?? null

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    /* Перехватываем Escape раньше страницы, чтобы он закрыл только список, а не снял выделение треков */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (v: T) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div className={`sort-select ${open ? 'open' : ''}`} ref={rootRef}>
      <span className="sort-select-label">{label}</span>
      <button
        type="button"
        className="sort-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sort-select-icon">{current?.icon ?? <SortIcon />}</span>
        <span className={`sort-select-value ${current ? '' : 'placeholder'}`}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <svg className="sort-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {presence.mounted && (
        <div id={menuId} role="listbox" className={`sort-select-menu ${presence.closing ? 'closing' : ''}`}>
          {options.map((o, i) => {
            const showGroup = o.group && o.group !== options[i - 1]?.group
            return (
              <div key={o.value} className="sort-select-entry">
                {showGroup && (
                  <div className={`sort-select-group ${i > 0 ? 'divided' : ''}`}>{o.group}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`sort-select-option ${o.value === value ? 'active' : ''}`}
                  onClick={() => pick(o.value)}
                >
                  <span className="sort-select-option-icon">{o.icon}</span>
                  <span className="sort-select-option-label">{o.label}</span>
                  <svg className="sort-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
