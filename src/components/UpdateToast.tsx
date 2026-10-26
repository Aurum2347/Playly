import { useI18n } from '../i18n'
import { open } from '@tauri-apps/plugin-shell'
import { dismissUpdateToast, downloadUpdate, installUpdate, RELEASES_URL, useUpdater } from '../lib/updater'
import { versionLabel } from '../lib/version'
import './UpdateToast.css'

/**
 * Ненавязчивое уведомление в углу: «обновление скачано — перезапустить?» или «доступно — скачать?».
 * О «неизвестной версии» (сборка не из релизов) не уведомляем: это видно только в «О программе».
 */
export default function UpdateToast() {
  const { t } = useI18n()
  const u = useUpdater()
  const visible =
    !u.dismissed && (u.status === 'ready' || u.status === 'installing' || u.status === 'manual' || (u.status === 'available' && !u.auto))
  if (!visible || !u.version) return null

  const ready = u.status === 'ready' || u.status === 'installing'
  return (
    <div className="update-toast" role="status">
      <span className="update-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </span>
      <span className="update-toast-text">
        <span className="update-toast-title">
          {t(ready ? 'updates.toastReady' : 'updates.toastAvailable', { v: versionLabel(t, u.version, 'release') })}
        </span>
        <span className="update-toast-sub">
          {t(ready ? 'updates.toastReadySub' : u.status === 'manual' ? 'updates.manualSub' : 'updates.toastAvailableSub')}
        </span>
      </span>
      <span className="update-toast-actions">
        <button className="btn btn-ghost" onClick={dismissUpdateToast} disabled={u.status === 'installing'}>
          {t('updates.later')}
        </button>
        {ready ? (
          <button className="btn btn-primary" onClick={() => void installUpdate()} disabled={u.status === 'installing'}>
            {u.status === 'installing' ? t('updates.installing') : t('updates.restart')}
          </button>
        ) : u.status === 'manual' ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              void open(u.releaseUrl ?? RELEASES_URL)
              dismissUpdateToast()
            }}
          >
            {t('updates.openRelease')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void downloadUpdate()}>
            {t('updates.download')}
          </button>
        )}
      </span>
    </div>
  )
}
