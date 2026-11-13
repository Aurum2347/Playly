import { useI18n, type LangError, type LangWarning } from '../../../i18n'

/* Сколько ключей с замечаниями показывать списком — остальное «и ещё N» */
const SAMPLE = 6

/** Почему свой перевод не включился, или что из него не взято */
export function LangNotices({ error, warning }: { error: LangError | null; warning: LangWarning | null }) {
  const { t } = useI18n()

  if (error) {
    return (
      <div className="lang-info-card lang-notice error" role="alert">
        <div className="lang-info-title">⚠️ {t('settings.system.langErr.title')}</div>
        <div className="lang-info-text">
          {t(`settings.system.langErr.${error.kind}`, { file: error.file ?? '' })}
        </div>
        {error.detail && <pre className="lang-notice-detail">{error.detail}</pre>}
      </div>
    )
  }

  if (!warning) return null
  const r = warning.report
  const groups: Array<[string, string[]]> = [
    ['invalid', r.invalid],
    ['placeholders', r.placeholders],
    ['unknown', r.unknown],
  ]
  return (
    <div className="lang-info-card lang-notice warning" role="status">
      <div className="lang-info-title">{t('settings.system.langWarn.title', { file: warning.file })}</div>
      <div className="lang-info-text">{t('settings.system.langWarn.text', { n: r.accepted })}</div>
      {groups
        .filter(([, keys]) => keys.length > 0)
        .map(([kind, keys]) => (
          <div key={kind} className="lang-notice-group">
            <div className="lang-notice-label">{t(`settings.system.langWarn.${kind}`, { n: keys.length })}</div>
            <code className="lang-notice-keys">
              {keys.slice(0, SAMPLE).join(', ')}
              {keys.length > SAMPLE && ` ${t('settings.system.langWarn.more', { n: keys.length - SAMPLE })}`}
            </code>
          </div>
        ))}
    </div>
  )
}
