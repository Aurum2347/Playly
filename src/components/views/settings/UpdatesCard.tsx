import { useState } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { useI18n } from '../../../i18n'
import { formatBytes } from '../../../lib/cache'
import {
  checkForUpdates,
  downloadUpdate,
  installReleaseBuild,
  installUpdate,
  RELEASES_URL,
  setAutoUpdate,
  setCheckOnStartup,
  useUpdater,
} from '../../../lib/updater'
import { versionLabel } from '../../../lib/version'

const localeFor = (lang: string) => (lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : navigator.language || 'en-US')

/** «О программе» → «Обновления»: проверка, скачивание с прогрессом, установка сейчас или позже */
export default function UpdatesCard() {
  const { t, tm, lang } = useI18n()
  const u = useUpdater()
  /* «Установить релиз» поверх неизвестной сборки — это откат, поэтому сначала спрашиваем */
  const [confirmRelease, setConfirmRelease] = useState(false)
  const locale = localeFor(lang)
  const units = tm<string[]>('settings.system.cacheUnits') ?? ['B', 'KB', 'MB', 'GB']
  const pct = u.total > 0 ? Math.min(100, Math.round((u.downloaded / u.total) * 100)) : 0
  const busy = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing'
  const newVersion = u.version ? versionLabel(t, u.version, 'release') : ''

  let title: string
  let sub: string | null = null
  switch (u.status) {
    case 'checking':
      title = t('updates.checking')
      break
    case 'latest':
      title = t('updates.latest')
      sub = t('updates.latestSub', { v: versionLabel(t) })
      break
    case 'available':
      title = t('updates.available', { v: newVersion })
      sub = u.auto ? t('updates.downloadingSoon') : t('updates.availableSub')
      break
    case 'manual':
      title = t('updates.available', { v: newVersion })
      sub = t('updates.manualSub')
      break
    case 'unknown':
      title = t('updates.unknown', { v: versionLabel(t) })
      sub = newVersion ? t('updates.unknownSub', { v: newVersion }) : null
      break
    case 'downloading':
      title = t('updates.downloading', { v: newVersion })
      sub = u.total > 0 ? `${formatBytes(u.downloaded, units, locale)} / ${formatBytes(u.total, units, locale)}` : null
      break
    case 'ready':
      title = t('updates.ready', { v: newVersion })
      sub = t('updates.readySub')
      break
    case 'installing':
      title = t('updates.installing')
      break
    case 'error':
      title = t('updates.error')
      sub = t('updates.errorSub')
      break
    default:
      title = t('updates.idle')
      sub = t('updates.latestSub', { v: versionLabel(t) })
  }

  return (
    <section className={`about2-updates status-${u.status}`}>
      <div className="about2-section-title">{t('updates.title')}</div>

      <div className="about2-updates-main">
        <span className="about2-updates-icon" aria-hidden="true">
          {u.status === 'unknown' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          ) : u.status === 'latest' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : u.status === 'error' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          ) : (
            <svg className={busy ? 'spin-slow' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" />
            </svg>
          )}
        </span>
        <span className="about2-updates-text">
          <span className="about2-updates-title">{title}</span>
          {sub && <span className="about2-updates-sub">{sub}</span>}
        </span>
        <span className="about2-updates-actions">
          {u.status === 'available' && !u.auto && (
            <button className="btn btn-primary" onClick={() => void downloadUpdate()}>{t('updates.download')}</button>
          )}
          {u.status === 'manual' && (
            <button className="btn btn-primary" onClick={() => void open(u.releaseUrl ?? RELEASES_URL)}>{t('updates.openRelease')}</button>
          )}
          {u.status === 'unknown' && u.version && !confirmRelease && (
            <button
              className="btn btn-primary"
              onClick={() => (u.installable ? setConfirmRelease(true) : void open(u.releaseUrl ?? RELEASES_URL))}
            >
              {t('updates.installRelease', { v: newVersion })}
            </button>
          )}
          {(u.status === 'ready' || u.status === 'installing') && (
            <button className="btn btn-primary" onClick={() => void installUpdate()} disabled={u.status === 'installing'}>
              {t('updates.installNow')}
            </button>
          )}
          {u.status !== 'ready' && u.status !== 'installing' && (
            <button className="btn" onClick={() => void checkForUpdates(false)} disabled={busy}>
              {t('updates.check')}
            </button>
          )}
        </span>
      </div>

      {u.status === 'unknown' && confirmRelease && (
        <div className="about2-updates-confirm">
          <span>{t('updates.installReleaseConfirm', { v: newVersion, cur: versionLabel(t) })}</span>
          <span className="about2-updates-actions">
            <button className="btn" onClick={() => setConfirmRelease(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setConfirmRelease(false)
                void installReleaseBuild()
              }}
            >
              {t('updates.installReleaseYes')}
            </button>
          </span>
        </div>
      )}

      {u.status === 'downloading' && (
        <div className="about2-updates-progress">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}

      {u.notes && (u.status === 'available' || u.status === 'unknown' || u.status === 'downloading' || u.status === 'ready') && (
        <div className="about2-updates-notes">
          <div className="about2-updates-notes-title">{t('updates.notes')}</div>
          <p>{u.notes}</p>
        </div>
      )}

      <label className="about2-updates-auto">
        <span>
          <span className="about2-updates-auto-title">{t('startupCheck.title')}</span>
          <span className="about2-updates-auto-sub">{t('startupCheck.desc')}</span>
        </span>
        <span className="toggle">
          <input type="checkbox" checked={u.checkOnStartup} onChange={(e) => void setCheckOnStartup(e.target.checked)} />
          <span className="toggle-slider" />
        </span>
      </label>
      <label className="about2-updates-auto">
        <span>
          <span className="about2-updates-auto-title">{t('updates.auto')}</span>
          <span className="about2-updates-auto-sub">{t('updates.autoDesc')}</span>
        </span>
        <span className="toggle">
          <input type="checkbox" checked={u.auto} onChange={(e) => void setAutoUpdate(e.target.checked)} />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {u.checkedAt && (
        <div className="about2-updates-checked">
          {t('updates.checkedAt', {
            time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(u.checkedAt),
          })}
        </div>
      )}
    </section>
  )
}
