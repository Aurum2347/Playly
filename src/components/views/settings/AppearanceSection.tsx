import { useEffect, useRef, useState } from 'react'
import { join } from '@tauri-apps/api/path'
import { exists, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import {
  activateFont,
  applyTheme,
  deactivateFont,
  deleteFontFiles,
  getFontsDir,
  loadThemeSetting,
  readFontSetting,
  saveThemeSetting,
  useOutsideClose,
  writeFontSetting,
  type ThemeMode,
} from './helpers'
import { useI18n } from '../../../i18n'

interface AppearanceSectionProps {
  theme?: ThemeMode
  onChangeTheme?: (theme: ThemeMode) => void
}

export default function AppearanceSection({ theme, onChangeTheme }: AppearanceSectionProps) {
  const { t } = useI18n()
  const [localTheme, setLocalTheme] = useState<ThemeMode>('dark')
  const [isThemeOpen, setIsThemeOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [customFontName, setCustomFontName] = useState<string | null>(null)
  const [isFontLoading, setIsFontLoading] = useState(false)

  useOutsideClose(dropdownRef, () => setIsThemeOpen(false))

  useEffect(() => {
    if (theme !== undefined) {
      applyTheme(theme)
      return
    }
    let cancelled = false
    loadThemeSetting()
      .then((savedTheme) => {
        if (!cancelled) {
          setLocalTheme(savedTheme)
          applyTheme(savedTheme)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [theme])

  const currentTheme: ThemeMode = theme ?? localTheme

  useEffect(() => {
    if (currentTheme !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const update = () => applyTheme('system')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [currentTheme])

  const handleThemeChange = (value: ThemeMode) => {
    setLocalTheme(value)
    applyTheme(value)
    saveThemeSetting(value).catch((e) => console.error('Не удалось сохранить тему:', e))
    onChangeTheme?.(value)
  }

  /* Подхватываем сохранённый шрифт при открытии */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const setting = await readFontSetting()
      if (!setting) return
      try {
        const fontsDir = await getFontsDir()
        const filePath = await join(fontsDir, setting.file)
        if (await exists(filePath)) {
          await activateFont(filePath)
          if (!cancelled) setCustomFontName(setting.name)
        }
      } catch (e) {
        console.error('Не удалось загрузить сохранённый шрифт:', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleUploadFont = async () => {
    if (isFontLoading) return
    setIsFontLoading(true)
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: t('settings.appearance.fontsFilter'), extensions: ['ttf', 'otf', 'woff', 'woff2'] },
        ],
      })
      if (!selected || Array.isArray(selected)) return
      const ext = selected.split('.').pop()?.toLowerCase() || 'ttf'
      const fileName = `custom.${ext}`
      const fontsDir = await getFontsDir()
      const targetPath = await join(fontsDir, fileName)
      const bytes = await readFile(selected)
      await writeFile(targetPath, bytes)
      await activateFont(targetPath)
      const originalName = selected.split(/[\\/]/).pop() || fileName
      setCustomFontName(originalName)
      await writeFontSetting({ file: fileName, name: originalName })
    } catch (e) {
      console.error('Ошибка установки шрифта:', e)
      alert(t('settings.appearance.fontError'))
    } finally {
      setIsFontLoading(false)
    }
  }

  const handleResetFont = async () => {
    try {
      deactivateFont()
      setCustomFontName(null)
      await writeFontSetting(null)
      await deleteFontFiles()
    } catch (e) {
      console.error('Ошибка сброса шрифта:', e)
    }
  }

  const themeLabel = (m: ThemeMode) =>
    m === 'dark'
      ? t('settings.appearance.dark')
      : m === 'light'
        ? t('settings.appearance.light')
        : t('settings.appearance.system')

  return (
    <>
      <h1 className="page-title">{t('settings.appearance.title')}</h1>
      <p className="page-subtitle">{t('settings.appearance.subtitle')}</p>
      <div className="settings-section">
        <div className="section-title">{t('settings.appearance.section')}</div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.appearance.theme')}</div>
            <div className="setting-desc">{t('settings.appearance.themeDesc')}</div>
          </div>
          <div className="setting-control" ref={dropdownRef}>
            <div className="dropdown">
              <button
                className={`select-btn ${isThemeOpen ? 'open' : ''}`}
                onClick={() => setIsThemeOpen((v) => !v)}
              >
                <span className="btn-label">{themeLabel(currentTheme)}</span>
                <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {isThemeOpen && (
                <div className="dropdown-menu open">
                  {(['dark', 'light', 'system'] as ThemeMode[]).map((val) => (
                    <button
                      key={val}
                      className={`dropdown-option ${currentTheme === val ? 'active' : ''}`}
                      onClick={() => {
                        handleThemeChange(val)
                        setIsThemeOpen(false)
                      }}
                    >
                      <span>{themeLabel(val)}</span>
                      <svg
                        className="check"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.appearance.font')}</div>
            <div className="setting-desc">
              {customFontName
                ? t('settings.appearance.fontCurrent', { name: customFontName })
                : t('settings.appearance.fontDesc')}
            </div>
          </div>
          <div className="setting-control">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn"
                onClick={handleUploadFont}
                disabled={isFontLoading}
                style={isFontLoading ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {isFontLoading ? t('common.loading') : t('settings.appearance.uploadFont')}
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleResetFont}
                disabled={!customFontName || isFontLoading}
                style={!customFontName || isFontLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                {t('settings.appearance.reset')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}