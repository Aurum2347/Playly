import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import Logo from '../Logo'
import './TitleBar.css'

interface TitleBarProps {
  /* Подпись по центру, когда ничего не играет: название страницы или плейлиста */
  pageTitle: string
  track: { title: string; artist: string } | null
  isPlaying: boolean
  onOpenNowPlaying: () => void
  versionLabel: string
}

/**
 * Шапка окна: что сейчас играет и кнопки окна.
 * Состояние «развёрнуто» берётся у самого окна — оно верно, даже если окно развернули
 * перетаскиванием к краю экрана или сочетанием клавиш.
 */
export default function TitleBar({
  pageTitle,
  track,
  isPlaying,
  onOpenNowPlaying,
  versionLabel,
}: TitleBarProps) {
  const { t } = useI18n()
  const [isMaximized, setIsMaximized] = useState(false)
  const [focused, setFocused] = useState(true)

  useEffect(() => {
    const win = getCurrentWindow()
    let alive = true
    const sync = () => {
      win
        .isMaximized()
        .then((v) => alive && setIsMaximized(v))
        .catch(() => {})
    }
    sync()
    const unResize = win.onResized(sync)
    const unFocus = win.onFocusChanged(({ payload }) => alive && setFocused(payload))
    return () => {
      alive = false
      unResize.then((f) => f())
      unFocus.then((f) => f())
    }
  }, [])

  const win = getCurrentWindow()
  const toggleMaximize = () => void win.toggleMaximize()

  const onDoubleClick = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    toggleMaximize()
  }

  return (
    <div className={`titlebar ${focused ? '' : 'blurred'}`} data-tauri-drag-region onDoubleClick={onDoubleClick}>
      <div className="tb-left" data-tauri-drag-region>
        <span className="tb-brand" data-tauri-drag-region title={versionLabel}>
          <Logo style={{ width: 15, height: 14, color: 'currentColor' }} />
          <span data-tauri-drag-region>Playly</span>
        </span>
      </div>

      <div className="tb-center" data-tauri-drag-region>
        {track ? (
          <button className={`tb-now ${isPlaying ? 'playing' : ''}`} onClick={onOpenNowPlaying} title={t('views.home.expanded')}>
            <span className="tb-eq" aria-hidden="true"><i /><i /><i /></span>
            <span className="tb-now-title">{track.title}</span>
            {track.artist && <span className="tb-now-artist">{track.artist}</span>}
          </button>
        ) : (
          <span key={pageTitle} className="tb-page" data-tauri-drag-region>{pageTitle}</span>
        )}
      </div>

      <div className="tb-right">
        <button className="tb-btn" onClick={() => invoke('toggle_mini_player').catch(() => {})} title={t('mini.open')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5" /><rect x="11" y="11" width="8" height="6" rx="1.2" /></svg>
        </button>
        <span className="tb-sep" aria-hidden="true" />
        <button className="control-btn minimize-btn" onClick={() => void win.minimize()} title={t('titlebar.minimize')}>
          <svg viewBox="0 0 14 14" fill="none"><line className="icon-stroke" x1="3" y1="7" x2="11" y2="7" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <button className="control-btn maximize-btn" onClick={toggleMaximize} title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}>
          <svg viewBox="0 0 14 14" fill="none">
            {isMaximized ? (
              <>
                <path className="icon-stroke" d="M5 3.5V3a1.5 1.5 0 0 1 1.5-1.5H11A1.5 1.5 0 0 1 12.5 3v4.5A1.5 1.5 0 0 1 11 9h-.5" strokeWidth="1.2" />
                <rect className="icon-stroke" x="1.5" y="4.5" width="8" height="8" rx="1.5" strokeWidth="1.2" />
              </>
            ) : (
              <rect className="icon-stroke" x="2.5" y="2.5" width="9" height="9" rx="1.6" strokeWidth="1.3" />
            )}
          </svg>
        </button>
        <button className="control-btn close-btn" onClick={() => void win.close()} title={t('titlebar.closeToTray')}>
          <svg viewBox="0 0 14 14" fill="none">
            <line className="icon-stroke" x1="4" y1="4" x2="10" y2="10" strokeWidth="1.4" strokeLinecap="round" />
            <line className="icon-stroke" x1="10" y1="4" x2="4" y2="10" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
