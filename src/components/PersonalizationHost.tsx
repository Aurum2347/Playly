import { exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { useEffect, useRef, useState } from 'react'
import Logo from './Logo'
import PlayerDialog from './PlayerDialog'
import { applyIcon, normalizeIcon } from '../lib/appIcon'
import {
  readSettingsRaw,
  writeSettingsRaw,
  removeSettingsKeys,
  getFontsDir,
  activateFont,
  deactivateFont,
  applyTheme,
  loadThemeSetting,
} from './views/settings/helpers'
import { APP_VERSION } from '../lib/version'
import { useI18n } from '../i18n'

/* Каждый шаг сам по себе: не загрузился шрифт — тема и иконка всё равно применяются */
async function step(name: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (e) {
    console.error(`Оформление (${name}) не применилось:`, e)
  }
}

/**
 * Один раз при запуске: тема, свой шрифт, своя иконка окна и трея,
 * а после обновления — предложение посмотреть список изменений.
 */
export default function PersonalizationHost({ onOpenChanges }: { onOpenChanges: () => void }) {
  const { t } = useI18n()
  const logo = useRef<HTMLDivElement>(null)
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const settings = await readSettingsRaw()
      if (!alive) return

      await step('theme', async () => {
        applyTheme(await loadThemeSetting())
        if ('customTheme' in settings) await removeSettingsKeys(['customTheme'])
      })

      await step('font', async () => {
        const font = settings.customFont as { file?: unknown } | undefined
        if (typeof font?.file !== 'string' || /[\\/]/.test(font.file)) return
        const path = await join(await getFontsDir(), font.file)
        if (await exists(path)) await activateFont(path)
        else {
          deactivateFont()
          await removeSettingsKeys(['customFont'])
        }
      })

      await step('icon', async () => {
        const svg = logo.current?.querySelector('svg')
        if (settings.appIcon && svg) await applyIcon(normalizeIcon(settings.appIcon), svg)
      })

      if (!alive) return
      /* Первый запуск после онбординга версию уже записал — окно не появится */
      const seen = settings.lastSeenVersion
      const changed = settings.pendingUpdateVersion === APP_VERSION || (typeof seen === 'string' && seen !== APP_VERSION)
      setUpdated(changed)
      if (seen !== APP_VERSION || settings.pendingUpdateVersion != null) {
        await writeSettingsRaw({ lastSeenVersion: APP_VERSION, pendingUpdateVersion: null, pendingUpdateNotes: null })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      {/* Логотип для отрисовки иконки: applyIcon перекрашивает его копию */}
      <div ref={logo} hidden>
        <Logo />
      </div>
      <PlayerDialog
        open={updated}
        title={t('whatsNew.title')}
        subtitle={t('whatsNew.version', { v: APP_VERSION })}
        onClose={() => setUpdated(false)}
      >
        <div className="update-welcome">
          <span className="update-welcome-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
          </span>
          <p className="player-dialog-copy">{t('whatsNew.text')}</p>
        </div>
        <footer className="frame-modal-actions">
          <button className="btn" onClick={() => setUpdated(false)}>{t('whatsNew.later')}</button>
          <button
            data-initial-focus
            className="btn btn-primary"
            onClick={() => {
              setUpdated(false)
              onOpenChanges()
            }}
          >
            {t('whatsNew.open')}
          </button>
        </footer>
      </PlayerDialog>
    </>
  )
}
