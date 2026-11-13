import { useCallback, useEffect, useRef, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { I18nProvider, useI18n } from '../i18n'
import Logo from '../components/Logo'
import './Notice.css'

/* Сколько уведомление висит, если на него не навели курсор */
const VISIBLE_MS = 6500

/**
 * Тихое уведомление «Playly продолжает работать в трее»: своё окно в углу экрана,
 * без звука и без захвата фокуса. Текст приходит из главного окна уже переведённым.
 */
function Notice() {
  const { t } = useI18n()
  const [text, setText] = useState<[string, string] | null>(null)
  const [shown, setShown] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    invoke('hide_tray_notice').catch(() => {})
  }, [])

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(hide, VISIBLE_MS)
  }, [hide])

  useEffect(() => {
    const refresh = () => {
      invoke<[string, string] | null>('take_tray_notice')
        .then((v) => {
          if (v) setText(v)
          setShown((n) => n + 1)
          arm()
        })
        .catch(() => {})
    }
    refresh()
    const un = listen('notice:shown', refresh)
    return () => {
      void un.then((fn) => fn())
      if (timer.current) clearTimeout(timer.current)
    }
  }, [arm])

  const never = () => {
    void emitTo('main', 'notice:never')
    hide()
  }

  return (
    <div className="notice-shell" onContextMenu={(e) => e.preventDefault()}>
      <div key={shown} className="notice-card" role="status" onMouseEnter={() => timer.current && clearTimeout(timer.current)} onMouseLeave={arm}>
        <div className="notice-icon"><Logo style={{ width: 18, height: 17, color: 'currentColor' }} /></div>
        <div className="notice-text">
          <div className="notice-title">{text?.[0] ?? 'Playly'}</div>
          <div className="notice-body">{text?.[1] ?? ''}</div>
          <div className="notice-actions">
            <button type="button" onClick={hide}>{t('trayNotice.ok')}</button>
            <button type="button" className="ghost" onClick={never}>{t('trayNotice.never')}</button>
          </div>
        </div>
        <button type="button" className="notice-close" aria-label={t('common.close')} onClick={hide}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
  )
}

export default function NoticeApp() {
  return (
    <I18nProvider persist={false}>
      <Notice />
    </I18nProvider>
  )
}
