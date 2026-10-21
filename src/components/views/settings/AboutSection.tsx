import { Fragment } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import Logo from '../../Logo'
import { useI18n } from '../../../i18n'

/**
 * Переводы могут прийти из пользовательских файлов языков, поэтому HTML не вставляем как есть:
 * поддерживается только <strong>…</strong>, всё остальное выводится как обычный текст.
 */
function renderBold(text: string) {
  return text.split(/(<strong>[\s\S]*?<\/strong>)/g).map((part, i) => {
    const m = part.match(/^<strong>([\s\S]*)<\/strong>$/)
    return m ? <strong key={i}>{m[1]}</strong> : <Fragment key={i}>{part}</Fragment>
  })
}

/* В окне Tauri ссылки с target="_blank" не открываются — отдаём их системному браузеру */
const openExternal = (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault()
  open(e.currentTarget.href).catch((err) => console.error('Не удалось открыть ссылку:', err))
}

export default function AboutSection() {
  const { t } = useI18n()

  return (
    <div className="about-container">
      {/* ===== Логотип СЛЕВА от названия, как на сплэше ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 8,
        }}
      >
        <Logo style={{ width: 68, height: 60, color: 'var(--text)', flexShrink: 0 }} />
        <h1 className="about-logo" style={{ marginBottom: 0 }}>
          Playly
        </h1>
      </div>
      <div className="about-version">{t('settings.about.version')}</div>

      <div className="about-text">
        <p>{renderBold(t('settings.about.p1'))}</p>
        <p>{renderBold(t('settings.about.p2'))}</p>
      </div>

      <div className="about-links">
        <a
          href="https://t.me/aurums2347"
          onClick={openExternal}
          rel="noreferrer"
          className="about-link-card"
        >
          <div className="about-link-icon telegram">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161l-1.97 9.291c-.145.658-.537.818-1.084.508l-3-2.211-1.446 1.394c-.14.18-.357.295-.6.295l.213-3.053 5.56-5.023c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.93z" />
            </svg>
          </div>

          <div className="about-link-info">
            <div className="about-link-title">{t('settings.about.link1')}</div>
            <div className="about-link-sub">t.me/aurums2347</div>
          </div>

          <div className="about-link-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </a>

        <a
          href="https://t.me/thermodynamicprogrammer"
          onClick={openExternal}
          rel="noreferrer"
          className="about-link-card"
        >
          <div className="about-link-icon telegram">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161l-1.97 9.291c-.145.658-.537.818-1.084.508l-3-2.211-1.446 1.394c-.14.18-.357.295-.6.295l.213-3.053 5.56-5.023c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.93z" />
            </svg>
          </div>

          <div className="about-link-info">
            <div className="about-link-title">{t('settings.about.link2')}</div>
            <div className="about-link-sub">t.me/thermodynamicprogrammer</div>
          </div>

          <div className="about-link-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </a>

        <div className="about-links-row">
          <a
            href="https://github.com/aurum2347"
            onClick={openExternal}
            rel="noreferrer"
            className="about-link-card"
          >
            <div className="about-link-icon github">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>

            <div className="about-link-info">
              <div className="about-link-title">{t('settings.about.link3')}</div>
              <div className="about-link-sub">github.com/aurum2347</div>
            </div>
          </a>

          <a
            href="https://github.com/aurum2347/playly"
            onClick={openExternal}
            rel="noreferrer"
            className="about-link-card"
          >
            <div className="about-link-icon github">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>

            <div className="about-link-info">
              <div className="about-link-title">{t('settings.about.link4')}</div>
              <div className="about-link-sub">{t('settings.about.link4Sub')}</div>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}