import { Fragment, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import Collapse from '../../Collapse'
import { APP_VERSION, versionLabel, type AppChannel } from '../../../lib/version'

interface ChangelogGroup {
  title?: string
  items: string[]
}

interface ChangelogSection {
  title: string
  groups: ChangelogGroup[]
}

interface ChangelogEntry {
  version: string
  /* Снапшот — промежуточная сборка; без поля версия считается релизом */
  channel?: AppChannel
  date: string
  title: string
  sections: ChangelogSection[]
}

/** Как и в «О программе»: из переводов принимаем только <strong>, остальное — обычный текст */
function renderBold(text: string) {
  return text.split(/(<strong>[\s\S]*?<\/strong>)/g).map((part, i) => {
    const m = part.match(/^<strong>([\s\S]*)<\/strong>$/)
    return m ? <strong key={i}>{m[1]}</strong> : <Fragment key={i}>{part}</Fragment>
  })
}

/* Переводы могут прийти из пользовательского файла — проверяем форму, прежде чем рисовать */
function readEntries(raw: unknown): ChangelogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is ChangelogEntry => !!e && typeof e.version === 'string' && Array.isArray(e.sections))
    .map((e) => ({
      ...e,
      title: typeof e.title === 'string' ? e.title : '',
      date: typeof e.date === 'string' ? e.date : '',
      channel: e.channel === 'snapshot' ? 'snapshot' : 'release',
      sections: e.sections
        .filter((s) => s && Array.isArray(s.groups))
        .map((s) => ({ ...s, groups: s.groups.filter((g) => g && Array.isArray(g.items)) })),
    }))
}

const countItems = (e: ChangelogEntry) =>
  e.sections.reduce((acc, s) => acc + s.groups.reduce((a, g) => a + g.items.length, 0), 0)

interface ChangelogPageProps {
  onBack: () => void
}

/** Подстраница «О программе»: история изменений по версиям, свежая версия раскрыта */
export default function ChangelogPage({ onBack }: ChangelogPageProps) {
  const { t, tm, lang } = useI18n()
  const entries = readEntries(tm('changelog.entries'))
  const [open, setOpen] = useState<Set<string>>(() => new Set(entries.length > 0 ? [entries[0].version] : []))

  const locale = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : navigator.language || 'en-US'
  const formatDate = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`)
    return isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  }

  /* Подстраница открывается с начала, а не с того места, где была прокрутка «О программе» */
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.closest('.settings-main-content')?.scrollTo({ top: 0 })
  }, [])

  const toggle = (v: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })

  return (
    <div ref={rootRef} className="about2 changelog">
      <div className="changelog-top">
        <button className="btn btn-ghost changelog-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('changelog.back')}
        </button>
      </div>

      <header className="changelog-head">
        <h1 className="page-title">{t('changelog.title')}</h1>
        <p className="page-subtitle">{t('changelog.subtitle')}</p>
      </header>

      <ol className="changelog-list">
        {entries.map((e, idx) => {
          const isOpen = open.has(e.version)
          const isCurrent = e.version === APP_VERSION
          return (
            <li key={e.version} className={`changelog-entry ${isOpen ? 'open' : ''} ${isCurrent ? 'current' : ''}`} style={{ animationDelay: `${idx * 0.05}s` }}>
              <span className="changelog-dot" aria-hidden="true" />
              <button className="changelog-entry-head" onClick={() => toggle(e.version)}
                aria-expanded={isOpen}
                title={isOpen ? t('changelog.collapse') : t('changelog.expand')}
              >
                <span className={`changelog-version ${e.channel === 'snapshot' ? 'snapshot' : ''}`}>
                  v{versionLabel(t, e.version, e.channel)}
                </span>
                <span className="changelog-entry-text">
                  <span className="changelog-entry-title">{e.title}</span>
                  <span className="changelog-entry-meta">
                    {e.date && formatDate(e.date)}
                    {isCurrent && <span className="changelog-current">{t('changelog.current')}</span>}
                  </span>
                </span>
                <span className="changelog-count">{countItems(e)}</span>
                <span className="changelog-chevron" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>

              <Collapse open={isOpen}>
                <div className="changelog-body">
                  {e.sections.map((s, si) => (
                    <section key={si} className="changelog-section">
                      <div className="about2-section-title">{s.title}</div>
                      {s.groups.map((g, gi) => (
                        <div key={gi} className="changelog-group">
                          {g.title && <div className="changelog-group-title">{renderBold(g.title)}</div>}
                          <ul>
                            {g.items.map((item, ii) => (
                              <li key={ii}>{renderBold(item)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </Collapse>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
