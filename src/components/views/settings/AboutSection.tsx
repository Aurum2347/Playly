import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import Logo from '../../Logo'
import { useI18n } from '../../../i18n'
import { versionLabel, consumeChangelogRequest } from '../../../lib/version'
import ChangelogPage from './ChangelogPage'
import UpdatesCard from './UpdatesCard'
import './AboutSection.css'

/* В окне Tauri ссылки с target="_blank" не открываются — отдаём их системному браузеру */
const openExternal = (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault()
  open(e.currentTarget.href).catch((err) => console.error('Не удалось открыть ссылку:', err))
}

const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161l-1.97 9.291c-.145.658-.537.818-1.084.508l-3-2.211-1.446 1.394c-.14.18-.357.295-.6.295l.213-3.053 5.56-5.023c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.93z" />
  </svg>
)

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" /><polyline points="8 7 17 7 17 16" />
  </svg>
)

interface LinkCardProps {
  href: string
  kind: 'telegram' | 'github'
  title: string
  sub: string
  featured?: boolean
}

function LinkCard({ href, kind, title, sub, featured }: LinkCardProps) {
  return (
    <a href={href} onClick={openExternal} rel="noreferrer" className={`about2-link ${featured ? 'featured' : ''}`}>
      <span className={`about2-link-icon ${kind}`}>{kind === 'telegram' ? <TelegramIcon /> : <GithubIcon />}</span>
      <span className="about2-link-text">
        <span className="about2-link-title">{title}</span>
        <span className="about2-link-sub">{sub}</span>
      </span>
      <span className="about2-link-arrow"><ArrowIcon /></span>
    </a>
  )
}

export default function AboutSection() {
  const { t } = useI18n()
  const [page, setPage] = useState<'main' | 'changelog'>(() => (consumeChangelogRequest() ? 'changelog' : 'main'))
  const rootRef = useRef<HTMLDivElement>(null)

  /* Возврат из списка изменений — тоже к началу страницы */
  useEffect(() => {
    if (page === 'main') rootRef.current?.closest('.settings-main-content')?.scrollTo({ top: 0 })
  }, [page])

  if (page === 'changelog') return <ChangelogPage onBack={() => setPage('main')} />

  return (
    <div ref={rootRef} className="about2">
      {/* ===== Шапка ===== */}
      <section className="about2-hero">
        <div className="about2-hero-glow" aria-hidden="true" />
        <div className="about2-hero-logo">
          <Logo style={{ width: 54, height: 48, color: 'var(--text)' }} />
        </div>
        <div className="about2-hero-text">
          <h1 className="about2-name">Playly</h1>
          <p className="about2-tagline">{t('settings.about.tagline')}</p>
          <div className="about2-badges">
            <span className="about2-badge strong">v{versionLabel(t)}</span>
            <span className="about2-badge">{t('settings.about.badgeOffline')}</span>
            <span className="about2-badge">Tauri · React</span>
          </div>
        </div>
      </section>

      {/* ===== Последние изменения ===== */}
      <button className="about2-changes" onClick={() => setPage('changelog')}>
        <span className="about2-changes-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 2" />
            <path d="M3.05 11a9 9 0 1 1 .5 4" />
            <polyline points="3 4 3 11 10 11" />
          </svg>
        </span>
        <span className="about2-changes-text">
          <span className="about2-changes-title">{t('settings.about.changesTitle')}</span>
          <span className="about2-changes-sub">{t('settings.about.changesSub', { v: versionLabel(t) })}</span>
        </span>
        <span className="about2-changes-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </button>

      {/* ===== Обновления ===== */}
      <UpdatesCard />

      {/* ===== Ссылки ===== */}
      <section>
        <div className="about2-section-title">{t('settings.about.linksTitle')}</div>
        <div className="about2-links">
          <LinkCard featured href="https://github.com/aurum2347/playly" kind="github" title={t('settings.about.link4')} sub={t('settings.about.link4Sub')} />
          <LinkCard href="https://t.me/aurums2347" kind="telegram" title={t('settings.about.link1')} sub="t.me/aurums2347" />
          <LinkCard href="https://t.me/thermodynamicprogrammer" kind="telegram" title={t('settings.about.link2')} sub="t.me/thermodynamicprogrammer" />
          <LinkCard href="https://github.com/aurum2347" kind="github" title={t('settings.about.link3')} sub="github.com/aurum2347" />
        </div>
      </section>

      <footer className="about2-footer">{t('settings.about.footer')}</footer>
    </div>
  )
}
