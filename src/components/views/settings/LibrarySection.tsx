import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../i18n'

type SyncMode = 'auto' | 'manual'

interface LibrarySectionProps {
  libraryFolder?: string
  syncMode?: SyncMode
  isScanning?: boolean
  onSelectFolder?: () => void
  onChangeSyncMode?: (mode: SyncMode) => void
  onRescan?: () => void
  onClearLibrary?: () => void
}

export default function LibrarySection({
  libraryFolder = '',
  syncMode = 'auto',
  isScanning = false,
  onSelectFolder,
  onChangeSyncMode,
  onRescan,
  onClearLibrary,
}: LibrarySectionProps) {
  const { t } = useI18n()
  const [isClearModalOpen, setIsClearModalOpen] = useState(false)
  const [clearTimer, setClearTimer] = useState(5)
  const [isClearBtnDisabled, setIsClearBtnDisabled] = useState(true)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    if (isClearModalOpen && isClearBtnDisabled) {
      interval = setInterval(() => {
        setClearTimer((prev) => {
          if (prev <= 1) {
            if (interval) clearInterval(interval)
            setIsClearBtnDisabled(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isClearModalOpen, isClearBtnDisabled])

  return (
    <>
      <h1 className="page-title">{t('settings.library.title')}</h1>
      <p className="page-subtitle">{t('settings.library.subtitle')}</p>

      {/* ===== Источник ===== */}
      <div className="settings-section">
        <div className="section-title">{t('settings.library.source')}</div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.library.folder')}</div>
            <div
              className="setting-desc"
              style={libraryFolder ? { wordBreak: 'break-all' } : undefined}
            >
              {libraryFolder || t('settings.library.folderDesc')}
            </div>
          </div>
          <div className="setting-control">
            <button className="btn" onClick={onSelectFolder} disabled={isScanning}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              {isScanning ? t('settings.library.scanning') : t('settings.library.chooseFolder')}
            </button>
          </div>
        </div>
      </div>

      {/* ===== Синхронизация ===== */}
      <div className="settings-section">
        <div className="section-title">{t('settings.library.sync')}</div>
        <div
          className="setting-row"
          style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}
        >
          <div className="setting-info" style={{ width: '100%' }}>
            <div className="setting-name">{t('settings.library.mode')}</div>
            <div className="setting-desc">{t('settings.library.modeDesc')}</div>
          </div>
          <div className="radio-group" style={{ width: '100%' }}>
            <label className="radio-option">
              <input
                type="radio"
                name="syncMode"
                value="auto"
                checked={syncMode === 'auto'}
                onChange={() => onChangeSyncMode?.('auto')}
              />
              <span className="radio-dot"></span>
              <span className="radio-label">{t('settings.library.auto')}</span>
            </label>
            <div className="radio-desc">{t('settings.library.autoDesc')}</div>
            <label className="radio-option" style={{ marginTop: '4px' }}>
              <input
                type="radio"
                name="syncMode"
                value="manual"
                checked={syncMode === 'manual'}
                onChange={() => onChangeSyncMode?.('manual')}
              />
              <span className="radio-dot"></span>
              <span className="radio-label">{t('settings.library.manual')}</span>
            </label>
            <div className="radio-desc">{t('settings.library.manualDesc')}</div>
          </div>
        </div>
        {syncMode === 'manual' && (
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-name">{t('settings.library.refresh')}</div>
              <div className="setting-desc">{t('settings.library.refreshDesc')}</div>
            </div>
            <div className="setting-control">
              <button className="btn" onClick={onRescan} disabled={isScanning}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                {isScanning ? t('settings.library.scanning') : t('settings.library.refreshBtn')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===== Опасная зона ===== */}
      <div className="settings-section">
        <div className="section-title" style={{ color: '#ff6b6b' }}>
          {t('settings.library.danger')}
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.library.clearAll')}</div>
            <div className="setting-desc">{t('settings.library.clearDesc')}</div>
          </div>
          <div className="setting-control">
            <button
              className="btn btn-danger"
              onClick={() => {
                setIsClearModalOpen(true)
                setClearTimer(5)
                setIsClearBtnDisabled(true)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              {t('settings.library.clearBtn')}
            </button>
          </div>
        </div>
      </div>

      {/* ===== Модальное окно: только когда isClearModalOpen = true ===== */}
      {isClearModalOpen &&
        createPortal(
          <div
            className="modal-overlay danger-modal open"
            onClick={(e) => e.target === e.currentTarget && setIsClearModalOpen(false)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="danger-modal-header">
                <div className="danger-icon-wrap">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div className="danger-modal-title">{t('settings.library.warnTitle')}</div>
                <div className="danger-modal-subtitle">{t('settings.library.warnSubtitle')}</div>
              </div>
              <div className="danger-modal-body">
                <div className="modal-text">
                  {t('settings.library.warnText')}
                  <strong>{t('settings.library.warnStrong')}</strong>
                  {t('settings.library.warnText2')}
                </div>
                <div className="danger-warning-box">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{t('settings.library.warnBox')}</span>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setIsClearModalOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={isClearBtnDisabled}
                  onClick={() => {
                    setIsClearModalOpen(false)
                    onClearLibrary?.()
                  }}
                >
                  {isClearBtnDisabled
                    ? t('settings.library.wait', { n: clearTimer })
                    : t('settings.library.confirmClear')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}