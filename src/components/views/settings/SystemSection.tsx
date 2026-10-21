import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart'
import Twemoji from '../../../components/Twemoji'
import { useI18n, LANGS } from '../../../i18n'

interface SystemSectionProps {
  discordRpc?: boolean
  onChangeDiscordRpc?: (v: boolean) => void
}

export default function SystemSection({
  discordRpc = true,
  onChangeDiscordRpc,
}: SystemSectionProps) {
  const {
    lang,
    setLang,
    t,
    customLangs,
    refreshCustomLangs,
    createTemplate,
    selectCustom,
    openLanguagesFolder,
    langError,
  } = useI18n()
  const [tempLang, setTempLang] = useState(lang)
  const [isLangModalOpen, setIsLangModalOpen] = useState(false)
  const [autostart, setAutostart] = useState(false)

  /* Читаем текущее состояние автозапуска из системы */
  useEffect(() => {
    isAutostartEnabled()
      .then((v) => setAutostart(v))
      .catch(() => {})
  }, [])

  /* Открыли модалку — обновили список кастомных языков */
  useEffect(() => {
    if (isLangModalOpen) refreshCustomLangs()
  }, [isLangModalOpen, refreshCustomLangs])

  const handleAutostartChange = async (v: boolean) => {
    setAutostart(v)
    try {
      if (v) {
        await enableAutostart()
      } else {
        await disableAutostart()
      }
    } catch (e) {
      console.error('Не удалось изменить автозапуск:', e)
      /* Возвращаем переключатель к реальному состоянию системы */
      isAutostartEnabled()
        .then((actual) => setAutostart(actual))
        .catch(() => setAutostart(!v))
    }
  }

  /* Что показывать на кнопке выбора языка */
  const currentMeta =
    LANGS.find((l) => l.id === lang) ??
    customLangs.find((c) => c.id === lang) ??
    LANGS[0]
  const currentFlag = 'flag' in currentMeta ? currentMeta.flag : currentMeta.iconemoji

  const handleApply = async () => {
    if (tempLang === 'ru' || tempLang === 'en') {
      setLang(tempLang)
    } else {
      await selectCustom(tempLang)
    }
    setIsLangModalOpen(false)
  }

  return (
    <>
      <h1 className="page-title">{t('settings.system.title')}</h1>
      <p className="page-subtitle">{t('settings.system.subtitle')}</p>

      <div className="settings-section">
        <div className="section-title">{t('settings.system.localization')}</div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.system.language')}</div>
            <div className="setting-desc">{t('settings.system.languageDesc')}</div>
          </div>
          <div className="setting-control">
            <button
              className="select-btn"
              onClick={() => {
                setTempLang(lang)
                setIsLangModalOpen(true)
              }}
            >
              <span className="btn-label">
                <Twemoji text={`${currentFlag} ${currentMeta.title}`} />
              </span>
              <svg
                className="chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">{t('settings.nav.system')}</div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.system.autostart')}</div>
            <div className="setting-desc">{t('settings.system.autostartDesc')}</div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(e) => handleAutostartChange(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.system.discord')}</div>
            <div className="setting-desc">{t('settings.system.discordDesc')}</div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={discordRpc}
                onChange={(e) => onChangeDiscordRpc?.(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      {/* ===== Модалка языка: ВСЕГДА в DOM, класс open даёт анимации входа и выхода ===== */}
      {createPortal(
        <div
          className={`modal-overlay ${isLangModalOpen ? 'open' : ''}`}
          onClick={(e) => e.target === e.currentTarget && setIsLangModalOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('settings.system.chooseLanguage')}</div>

            {/* ===== Предупреждение: выбранный язык не найден ===== */}
            {langError && (
              <div className="lang-info-card" style={{ borderColor: 'rgba(255, 107, 107, 0.4)' }}>
                <div className="lang-info-title" style={{ color: '#ff6b6b' }}>
                  {lang === 'ru' ? '⚠️ Язык не найден' : '⚠️ Language not found'}
                </div>
                <div className="lang-info-text">
                  {lang === 'ru'
                    ? 'Файл выбранного языка отсутствует или повреждён, поэтому приложение переключилось на встроенный язык. Выбери язык из списка ниже.'
                    : 'The selected language file is missing or corrupted, so the app switched to a built-in language. Pick a language from the list below.'}
                </div>
              </div>
            )}

            <div className="lang-info-card">
              <div className="lang-info-title">{t('settings.system.helpTitle')}</div>
              <div className="lang-info-text">{t('settings.system.helpText')}</div>
              <a
                href="https://github.com/Aurum2347/Playly/issues/new"
                className="btn-link"
                onClick={async (e) => {
                  e.preventDefault()
                  try {
                    const { open } = await import('@tauri-apps/plugin-shell')
                    await open('https://github.com/Aurum2347/Playly/issues/new')
                  } catch (err) {
                    console.error('Не удалось открыть ссылку:', err)
                  }
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
                {t('common.open')}
              </a>
            </div>

            <div className="language-list">
              {/* Встроенные языки */}
              {LANGS.map((l) => (
                <div
                  key={l.id}
                  className={`language-item ${tempLang === l.id ? 'selected' : ''}`}
                  onClick={() => setTempLang(l.id)}
                >
                  <span className="language-flag">
                    <Twemoji text={l.flag} />
                  </span>
                  <span className="language-name">{t(`settings.system.langNames.${l.id}`)}</span>
                  <span className="language-native">{l.title}</span>
                </div>
              ))}

              {/* Кастомные языки из папки languages */}
              {customLangs.map((cl) => (
                <div
                  key={cl.id}
                  className={`language-item ${tempLang === cl.id ? 'selected' : ''}`}
                  onClick={() => setTempLang(cl.id)}
                >
                  <span className="language-flag">
                    <Twemoji text={cl.iconemoji} />
                  </span>
                  <span className="language-name">{cl.title}</span>
                  <span className="language-native">{cl.id}</span>
                </div>
              ))}
            </div>

            {/* ===== Свой перевод: шаблон + папка ===== */}
            <div className="lang-info-card">
              <div className="lang-info-title">{t('settings.system.customTitle')}</div>
              <div className="lang-info-text">{t('settings.system.customText')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  onClick={() => createTemplate(tempLang === 'ru' ? 'ru' : 'en')}
                >
                  {t('settings.system.createTemplate')}
                </button>
                <button className="btn btn-ghost" onClick={openLanguagesFolder}>
                  {t('settings.system.openFolder')}
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setIsLangModalOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleApply}>
                {t('settings.system.apply')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}