import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../../i18n'
import { cacheTotal, clearCache, formatBytes, getCacheReport, type CacheReport } from '../../../lib/cache'

interface CacheSettingsProps {
  getReferencedCovers?: () => Set<string>
}

const localeFor = (lang: string) => (lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : navigator.language || 'en-US')

/** «Хранилище»: сколько весит кеш, из чего он состоит, и кнопка «Очистить весь кеш» */
export default function CacheSettings({ getReferencedCovers }: CacheSettingsProps) {
  const { t, tm, lang } = useI18n()
  const [report, setReport] = useState<CacheReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [freed, setFreed] = useState<number | null>(null)

  const units = tm<string[]>('settings.system.cacheUnits') ?? ['B', 'KB', 'MB', 'GB']
  const fmt = (n: number) => formatBytes(n, units, localeFor(lang))

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await getCacheReport(getReferencedCovers?.() ?? new Set()))
    } catch (e) {
      console.error('Не удалось посчитать кеш:', e)
    } finally {
      setLoading(false)
    }
  }, [getReferencedCovers])

  /* Первый подсчёт при открытии раздела (загрузка уже отмечена начальным состоянием) */
  useEffect(() => {
    let alive = true
    getCacheReport(getReferencedCovers?.() ?? new Set())
      .then((r) => alive && setReport(r))
      .catch((e) => console.error('Не удалось посчитать кеш:', e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [getReferencedCovers])

  const handleClear = async () => {
    if (!report || clearing) return
    setClearing(true)
    try {
      /* Пересчитываем прямо перед удалением: за время, пока окно было открыто, обложки могли измениться */
      const fresh = await getCacheReport(getReferencedCovers?.() ?? new Set())
      setFreed(await clearCache(fresh))
      setConfirmOpen(false)
      await refresh()
    } finally {
      setClearing(false)
    }
  }

  const total = report ? cacheTotal(report) : 0
  const rows = report
    ? [
        { key: 'webview', size: report.webview, meta: null },
        { key: 'covers', size: report.orphanCovers.size, meta: t('settings.system.cacheFiles', { n: report.orphanCovers.files.length }) },
        { key: 'temp', size: report.temp.size, meta: null },
      ]
    : []

  return (
    <div className="settings-section">
      <div className="section-title">{t('settings.system.storage')}</div>

      <div className="setting-row cache-row">
        <div className="setting-info">
          <div className="setting-name">{t('settings.system.cache')}</div>
          <div className="setting-desc">{t('settings.system.cacheDesc')}</div>
        </div>
        <div className="setting-control cache-total">
          <span className={`cache-total-value ${loading ? 'loading' : ''}`}>{report ? fmt(total) : '—'}</span>
          <button className="icon-btn" onClick={() => void refresh()} disabled={loading} title={t('settings.system.cacheRefresh')}>
            <svg className={loading ? 'spin' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      {report && (
        <div className="cache-breakdown">
          {rows.map((r) => (
            <div key={r.key} className="cache-item">
              <span className="cache-bar" style={{ width: `${total > 0 ? Math.max(2, (r.size / total) * 100) : 0}%` }} />
              <span className="cache-item-name">
                {t(`settings.system.cache_${r.key}`)}
                {r.meta && <span className="cache-item-meta">{r.meta}</span>}
              </span>
              <span className="cache-item-size">{fmt(r.size)}</span>
            </div>
          ))}
          <div className="cache-data-note">
            {t('settings.system.cacheData', { size: fmt(report.dataTotal) })}
          </div>
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-name">{t('settings.system.cacheClear')}</div>
          <div className="setting-desc">
            {freed !== null ? t('settings.system.cacheFreed', { size: fmt(freed) }) : t('settings.system.cacheClearDesc')}
          </div>
        </div>
        <div className="setting-control">
          <button className="btn btn-danger" onClick={() => setConfirmOpen(true)} disabled={!report || total === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            {t('settings.system.cacheClearBtn')}
          </button>
        </div>
      </div>

      {createPortal(
        <div
          className={`modal-overlay ${confirmOpen ? 'open' : ''}`}
          onClick={(e) => e.target === e.currentTarget && !clearing && setConfirmOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('settings.system.cacheConfirmTitle', { size: fmt(total) })}</div>
            <div className="modal-text">{t('settings.system.cacheConfirmText')}</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmOpen(false)} disabled={clearing}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={handleClear} disabled={clearing}>
                {clearing ? t('common.loading') : t('settings.system.cacheClearBtn')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
