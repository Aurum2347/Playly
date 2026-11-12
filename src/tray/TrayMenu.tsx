import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { I18nProvider, useI18n } from '../i18n'
import Logo from '../components/Logo'
import { loadCoverUrl } from '../lib/trackLoader'
import { useCoverColor } from '../lib/coverColor'
import { MINI_HELLO_EVENT, MINI_STATE_EVENT, type MiniState } from '../lib/miniBridge'
import './TrayMenu.css'

type Action = 'show' | 'mini' | 'quit' | 'close'

const act = (action: Action) => {
  invoke('tray_menu_action', { action }).catch(() => {})
}

const Icon = {
  window: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18" /><circle cx="6.5" cy="6.5" r=".6" fill="currentColor" /><circle cx="9" cy="6.5" r=".6" fill="currentColor" /></svg>,
  mini: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><rect x="11" y="12" width="7" height="5" rx="1.5" fill="currentColor" stroke="none" /></svg>,
  power: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>,
  music: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>,
}

/** Обложка из папки covers: окна не делят blob-url, поэтому файл читается здесь заново */
function useCover(file: string | null): string | null {
  const [cover, setCover] = useState<{ file: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!file) return
    let alive = true
    let url: string | null = null
    loadCoverUrl(file).then((u) => {
      url = u
      if (alive) setCover({ file, url: u })
      else if (u) URL.revokeObjectURL(u)
    })
    return () => {
      alive = false
      /* Прежнюю отпускаем чуть позже — когда новая уже нарисована */
      if (url) {
        const old = url
        setTimeout(() => URL.revokeObjectURL(old), 1000)
      }
    }
  }, [file])
  return file && cover?.file === file ? cover.url : null
}

function TrayMenu() {
  const { t, lang, setLang, selectCustom } = useI18n()
  const [state, setState] = useState<MiniState | null>(null)
  const [miniOn, setMiniOn] = useState(true)
  /* Номер показа: меняется — карточка заново проигрывает появление */
  const [shown, setShown] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  /* Фокус на обёртке: иначе он остаётся на body и стрелки / Esc не доходят до меню */
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    shellRef.current?.focus()
  }, [shown])

  useEffect(() => {
    const refresh = () => {
      emitTo('main', MINI_HELLO_EVENT).catch(() => {})
      invoke<boolean>('mini_enabled').then(setMiniOn).catch(() => {})
    }
    const unState = listen<MiniState>(MINI_STATE_EVENT, (e) => setState(e.payload))
    const unShown = listen('traymenu:shown', () => {
      setShown((n) => n + 1)
      refresh()
    })
    refresh()
    return () => {
      unState.then((f) => f())
      unShown.then((f) => f())
    }
  }, [])

  /* Язык — как в главном окне */
  useEffect(() => {
    if (!state || state.lang === lang) return
    if (state.lang === 'ru' || state.lang === 'en') setLang(state.lang)
    else void selectCustom(state.lang)
  }, [state, lang, setLang, selectCustom])

  const track = state?.track ?? null
  const cover = useCover(track?.coverFile ?? null)
  const tint = useCoverColor(cover) ?? '130, 130, 150'

  /* Стрелки ↑/↓ ходят по пунктам, Esc закрывает меню */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      act('close')
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.tray-item') ?? [])
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  const status = !track ? t('tray.idle') : state?.isPlaying ? t('tray.playing') : t('tray.paused')

  return (
    <div ref={shellRef} tabIndex={-1} className="tray-shell" onContextMenu={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      <div key={shown} className="tray-card" style={{ '--tint': tint } as CSSProperties} role="menu" aria-label="Playly">
        <div className="tray-now">
          <span className="tray-cover">
            {cover ? <img src={cover} alt="" /> : track ? Icon.music : <Logo />}
            {track && state?.isPlaying && (
              <span className="tray-bars" aria-hidden="true"><i /><i /><i /></span>
            )}
          </span>
          <span className="tray-now-text">
            <span className="tray-now-status">{status}</span>
            <span className="tray-now-title">{track ? track.title : 'Playly'}</span>
            {track && <span className="tray-now-artist">{track.artist}</span>}
          </span>
        </div>

        <div className="tray-items" ref={listRef}>
          <button className="tray-item" role="menuitem" onClick={() => act('show')}>
            <span className="tray-item-icon">{Icon.window}</span>
            <span className="tray-item-text">
              <span className="tray-item-title">{t('tray.show')}</span>
              <span className="tray-item-hint">{t('tray.showHint')}</span>
            </span>
          </button>
          {miniOn && (
            <button className="tray-item" role="menuitem" onClick={() => act('mini')}>
              <span className="tray-item-icon">{Icon.mini}</span>
              <span className="tray-item-text">
                <span className="tray-item-title">{t('tray.mini')}</span>
                <span className="tray-item-hint">{t('tray.miniHint')}</span>
              </span>
            </button>
          )}
          <span className="tray-sep" role="separator" />
          <button className="tray-item tray-item-danger" role="menuitem" onClick={() => act('quit')}>
            <span className="tray-item-icon">{Icon.power}</span>
            <span className="tray-item-text">
              <span className="tray-item-title">{t('tray.quit')}</span>
              <span className="tray-item-hint">{t('tray.quitHint')}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TrayMenuApp() {
  return (
    <I18nProvider persist={false}>
      <TrayMenu />
    </I18nProvider>
  )
}
