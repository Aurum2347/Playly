import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { I18nProvider, useI18n } from '../i18n'
import Logo from '../components/Logo'
import { loadCoverUrl, formatDuration } from '../lib/trackLoader'
import { useCoverColor } from '../lib/coverColor'
import {
  livePosition,
  MINI_COMMAND_EVENT,
  MINI_HELLO_EVENT,
  MINI_STATE_EVENT,
  type MiniCommand,
  type MiniState,
} from '../lib/miniBridge'
import './MiniPlayer.css'

/* Размер окна мини-плеера между запусками */
const SIZE_KEY = 'playly-mini-size'

const send = (cmd: MiniCommand) => {
  emitTo('main', MINI_COMMAND_EVENT, cmd).catch(() => {})
}

const Icon = {
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>,
  prev: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" /></svg>,
  shuffle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>,
  repeat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
  heart: <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>,
  pin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" /></svg>,
  expand: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  music: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>,
  volume: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>,
  volumeMute: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>,
  dots: <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
  target: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" /></svg>,
  minimize: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="18" x2="19" y2="18" /></svg>,
  power: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>,
}

/** Обложка из папки covers: окна не делят blob-url, поэтому файл читается здесь заново */
function useCover(file: string | null): string | null {
  const [cover, setCover] = useState<{ file: string; url: string } | null>(null)
  useEffect(() => {
    if (!file) return
    let alive = true
    let url: string | null = null
    loadCoverUrl(file).then((u) => {
      if (!alive) {
        if (u) URL.revokeObjectURL(u)
        return
      }
      url = u
      setCover(u ? { file, url: u } : null)
    })
    return () => {
      alive = false
      if (url) setTimeout(() => URL.revokeObjectURL(url as string), 1000)
    }
  }, [file])
  return file && cover?.file === file ? cover.url : null
}

function MiniPlayer() {
  const { t, lang, setLang, selectCustom } = useI18n()
  const [state, setState] = useState<MiniState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pinned, setPinned] = useState(false)
  /* Позиция под пальцем, пока тянут полосу прогресса */
  const [scrub, setScrub] = useState<number | null>(null)
  const [volumeFlash, setVolumeFlash] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement>(null)
  /* Небольшое окно — громкость прячется в кнопку; широкое — обложка крупнее */
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [volumeOpen, setVolumeOpen] = useState(false)
  const compact = size.h < 190
  /* Узкое окно: перемешивание и повтор переезжают в меню «⋯», иначе кнопки налезают друг на друга */
  const narrow = size.w < 360
  const wide = size.w >= 520 && size.h >= 240

  /* ===== Размер окна: запоминаем и восстанавливаем ===== */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as { w: number; h: number } | null
      if (saved && saved.w > 0 && saved.h > 0) void getCurrentWindow().setSize(new LogicalSize(saved.w, saved.h))
    } catch {
      /* размер по умолчанию */
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      setSize({ w: window.innerWidth, h: window.innerHeight })
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify({ w: window.innerWidth, h: window.innerHeight }))
        } catch {
          /* хранилище недоступно — размер просто не запомнится */
        }
      }, 400)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [])

  /* Меню «⋯» и всплывающая громкость закрываются кликом мимо, по Esc и когда окно прячется */
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    const onBlur = () => {
      setMenuOpen(false)
      setVolumeOpen(false)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  /* ===== Связь с главным окном ===== */
  useEffect(() => {
    const un = listen<MiniState>(MINI_STATE_EVENT, (e) => setState(e.payload))
    emitTo('main', MINI_HELLO_EVENT).catch(() => {})
    /* Окно прячется и показывается без перезагрузки — при каждом показе просим свежее состояние */
    const onVisible = () => {
      if (!document.hidden) emitTo('main', MINI_HELLO_EVENT).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      un.then((f) => f())
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  /* Язык — как в главном окне */
  useEffect(() => {
    if (!state || state.lang === lang) return
    if (state.lang === 'ru' || state.lang === 'en') setLang(state.lang)
    else void selectCustom(state.lang)
  }, [state, lang, setLang, selectCustom])

  /* Полоса прогресса плавно едет сама, без потока событий из главного окна */
  useEffect(() => {
    if (!state?.isPlaying) return
    let raf = 0
    let last = 0
    const tick = (ts: number) => {
      if (ts - last > 250) {
        last = ts
        setNow(Date.now())
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state?.isPlaying])

  const track = state?.track ?? null
  const animUrl = useCover(track?.animCoverFile ?? null)
  const stillUrl = useCover(track?.coverFile ?? null)
  const cover = animUrl ?? stillUrl
  const tint = useCoverColor(stillUrl) ?? '120, 120, 140'

  const position = state ? scrub ?? livePosition(state, now) : 0
  const duration = state?.duration ?? 0
  const progress = duration > 0 ? Math.min(1, position / duration) : 0

  const flashVolume = () => {
    setVolumeFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setVolumeFlash(false), 1200)
  }

  /* Клавиатура: пробел, стрелки, Esc — прячет окно */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!state) return
      if (e.code === 'Space') {
        e.preventDefault()
        send({ type: 'toggle' })
      } else if (e.code === 'ArrowRight') send({ type: 'seek', time: livePosition(state) + 5 })
      else if (e.code === 'ArrowLeft') send({ type: 'seek', time: Math.max(0, livePosition(state) - 5) })
      else if (e.code === 'ArrowUp') {
        send({ type: 'volume', value: state.volume + 5 })
        flashVolume()
      } else if (e.code === 'ArrowDown') {
        send({ type: 'volume', value: state.volume - 5 })
        flashVolume()
      } else if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false)
        else invoke('hide_mini_player').catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, menuOpen])

  const seekFromPointer = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration
  }

  const onBarDown = (e: React.PointerEvent) => {
    if (!track || duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrub(seekFromPointer(e.clientX))
  }
  const onBarMove = (e: React.PointerEvent) => {
    if (scrub !== null) setScrub(seekFromPointer(e.clientX))
  }
  const onBarUp = (e: React.PointerEvent) => {
    if (scrub === null) return
    send({ type: 'seek', time: seekFromPointer(e.clientX) })
    setScrub(null)
  }

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    invoke('set_mini_pinned', { pinned: next }).catch(() => {})
  }

  const volume = state?.muted ? 0 : state?.volume ?? 0
  const setVolume = (v: number) => send({ type: 'volume', value: Math.max(0, Math.min(100, Math.round(v))) })

  /* Перетаскивание за шапку: Rust запоминает, что место выбрано пользователем */
  const onHeadPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    invoke('mini_user_moved').catch(() => {})
  }

  const runMenu = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  const volumeControl = (
    <div className="mini-volume-row">
      <button className="mini-ctl small" onClick={() => send({ type: 'mute' })} title={t(state?.muted ? 'layout.playerbar.muteOff' : 'layout.playerbar.muteOn')}>
        {volume === 0 ? Icon.volumeMute : Icon.volume}
      </button>
      <input
        type="range"
        className="mini-volume-slider"
        min={0}
        max={100}
        value={volume}
        style={{ '--val': `${volume}%` } as CSSProperties}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label={t('layout.playerbar.volume')}
      />
      <span className="mini-volume-value">{volume}</span>
    </div>
  )

  return (
    <div
      className={`mini ${pinned ? 'pinned' : ''} ${compact ? 'compact' : ''} ${narrow ? 'narrow' : ''} ${wide ? 'wide' : ''}`}
      style={{ '--tint': tint } as CSSProperties}
      onWheel={(e) => {
        if (!state) return
        setVolume(state.volume + (e.deltaY < 0 ? 5 : -5))
        flashVolume()
      }}
    >
      <div className="mini-bg" aria-hidden="true">
        {stillUrl && <img src={stillUrl} alt="" />}
      </div>

      <header className="mini-head" data-tauri-drag-region onPointerDown={onHeadPointerDown}>
        <span className="mini-brand" data-tauri-drag-region>
          <Logo style={{ width: 14, height: 13, color: 'currentColor' }} />
          Playly
        </span>
        <span className="mini-head-actions">
          <button className={`mini-icon ${pinned ? 'on' : ''}`} onClick={togglePin} title={t(pinned ? 'mini.unpin' : 'mini.pin')}>
            {Icon.pin}
          </button>
          <span className="mini-menu-wrap" ref={menuRef}>
            <button className={`mini-icon ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen((v) => !v)} title={t('mini.more')}>
              {Icon.dots}
            </button>
            {menuOpen && (
              <div className="mini-menu" role="menu">
                <button role="menuitem" onClick={() => runMenu(() => invoke('show_main_window').catch(() => {}))}>
                  {Icon.expand}
                  <span>{t('mini.openMain')}</span>
                </button>
                <button role="menuitem" onClick={() => runMenu(togglePin)}>
                  {Icon.pin}
                  <span>{t(pinned ? 'mini.unpin' : 'mini.pin')}</span>
                </button>
                <button role="menuitem" onClick={() => runMenu(() => invoke('reset_mini_position').catch(() => {}))}>
                  {Icon.target}
                  <span>{t('mini.resetPosition')}</span>
                </button>
                {narrow && track && (
                  <>
                    <button role="menuitem" className={state?.shuffle ? 'on' : ''} onClick={() => runMenu(() => send({ type: 'shuffle' }))}>
                      {Icon.shuffle}
                      <span>{t('layout.playerbar.shuffle')}</span>
                    </button>
                    <button role="menuitem" className={state && state.repeat !== 'off' ? 'on' : ''} onClick={() => runMenu(() => send({ type: 'repeat' }))}>
                      {Icon.repeat}
                      <span>
                        {t('layout.playerbar.repeat')}
                        {state?.repeat === 'one' && ' · 1'}
                      </span>
                    </button>
                  </>
                )}
                <div className="mini-menu-sep" />
                <button role="menuitem" className="danger" onClick={() => runMenu(() => invoke('quit_app').catch(() => {}))}>
                  {Icon.power}
                  <span>{t('mini.quit')}</span>
                </button>
              </div>
            )}
          </span>
          <button className="mini-icon" onClick={() => invoke('hide_mini_player').catch(() => {})} title={t('common.close')}>
            {Icon.close}
          </button>
        </span>
      </header>

      <div className="mini-body">
        <div className="mini-cover">
          {cover ? <img key={cover} src={cover} alt="" draggable={false} /> : Icon.music}
          {volumeFlash && (
            <div className="mini-volume-flash">
              {Icon.volume}
              <span>{volume}%</span>
            </div>
          )}
        </div>

        <div className="mini-main">
          <div className="mini-text">
            <div className="mini-title" title={track?.title}>{track ? track.title : t('layout.playerbar.nothingPlaying')}</div>
            <div className="mini-artist">{track ? track.artist : t('layout.playerbar.chooseTrack')}</div>
          </div>

          <div className="mini-progress">
            <div
              ref={barRef}
              className={`mini-bar ${scrub !== null ? 'scrubbing' : ''}`}
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={() => setScrub(null)}
            >
              <div className="mini-bar-fill" style={{ width: `${progress * 100}%` }} />
              <div className="mini-bar-thumb" style={{ left: `${progress * 100}%` }} />
            </div>
            <div className="mini-times">
              <span>{formatDuration(position)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="mini-controls">
            {!narrow && (
              <button className={`mini-ctl small ${state?.shuffle ? 'on' : ''}`} onClick={() => send({ type: 'shuffle' })} disabled={!track} title={t('layout.playerbar.shuffle')}>
                {Icon.shuffle}
              </button>
            )}
            <button className="mini-ctl" onClick={() => send({ type: 'prev' })} disabled={!track} title={t('layout.playerbar.prev')}>
              {Icon.prev}
            </button>
            <button className="mini-ctl play" onClick={() => send({ type: 'toggle' })} disabled={!track} title={t(state?.isPlaying ? 'layout.playerbar.pause' : 'layout.playerbar.play')}>
              {state?.isPlaying ? Icon.pause : Icon.play}
            </button>
            <button className="mini-ctl" onClick={() => send({ type: 'next' })} disabled={!track} title={t('layout.playerbar.next')}>
              {Icon.next}
            </button>
            {!narrow && (
              <button
                className={`mini-ctl small ${state && state.repeat !== 'off' ? 'on' : ''}`}
                onClick={() => send({ type: 'repeat' })}
                disabled={!track}
                title={t('layout.playerbar.repeat')}
              >
                {Icon.repeat}
                {state?.repeat === 'one' && <i className="mini-badge">1</i>}
              </button>
            )}
            <button
              className={`mini-ctl small like ${track?.liked ? 'on' : ''}`}
              onClick={() => send({ type: 'like' })}
              disabled={!track}
              title={t(track?.liked ? 'layout.playerbar.likeRemove' : 'layout.playerbar.likeAdd')}
            >
              {Icon.heart}
            </button>
            {compact && (
              <span className="mini-volume-pop-wrap">
                <button className={`mini-ctl small ${volumeOpen ? 'on' : ''}`} onClick={() => setVolumeOpen((v) => !v)} title={t('mini.volume')}>
                  {volume === 0 ? Icon.volumeMute : Icon.volume}
                </button>
                {volumeOpen && <div className="mini-volume-pop">{volumeControl}</div>}
              </span>
            )}
          </div>

          {!compact && volumeControl}
        </div>
      </div>

      {/* Уголок для изменения размера (края окна тоже тянутся) */}
      <span
        className="mini-resize"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          /* Иначе Windows на время изменения размера забирает фокус, и окно пряталось */
          invoke('mini_touch').catch(() => {})
          void getCurrentWindow().startResizeDragging('SouthEast')
        }}
        aria-hidden="true"
      />
    </div>
  )
}

export default function MiniApp() {
  return (
    <I18nProvider>
      <MiniPlayer />
    </I18nProvider>
  )
}
