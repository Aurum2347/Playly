import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import { streamerActive, toggleStreamer, updateStreamer, usePrefs } from '../../lib/prefs'
import './StreamerControl.css'

interface OutputDevice {
  id: string
  label: string
}

/** Реальные устройства вывода (без псевдоустройств Windows «default» и «communications») */
function useOutputDevices(enabled = true): OutputDevice[] {
  const [list, setList] = useState<OutputDevice[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      try {
        const devs = (await navigator.mediaDevices?.enumerateDevices?.()) ?? []
        const out = devs
          .filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .filter((d, i, all) => all.findIndex((a) => a.deviceId === d.deviceId) === i)
          .map((d) => ({ id: d.deviceId, label: d.label }))
        if (alive) setList(out)
      } catch {
        /* Список недоступен — выбрать устройство нельзя */
      }
    }
    void load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', load)
    }
  }, [enabled])
  return list
}

let captureSupport: Promise<boolean> | null = null
function captureHideSupported(): Promise<boolean> {
  captureSupport ??= invoke<boolean>('capture_hide_supported').catch(() => false)
  return captureSupport
}

/** Переключатели режима стримера: одни и те же в меню шапки и в настройках */
export function StreamerToggles({ outputDevice, compact = false }: { outputDevice: string; compact?: boolean }) {
  const { t } = useI18n()
  const { streamer } = usePrefs()
  const devices = useOutputDevices()
  const [canHide, setCanHide] = useState(true)
  useEffect(() => {
    void captureHideSupported().then(setCanHide)
  }, [])
  /* Основное устройство (на нём слушает и программа захвата) для отдельного звука не подходит */
  const choices = devices.filter((d) => d.id !== outputDevice)
  const deviceMissing = streamer.device !== '' && devices.length > 0 && !devices.some((d) => d.id === streamer.device)

  return (
    <div className={`streamer-toggles ${compact ? 'compact' : ''}`}>
      <label className="streamer-row">
        <span className="streamer-text">
          <span className="streamer-name">{t('streamer.window')}</span>
          <span className="streamer-desc">{canHide ? t('streamer.windowDesc') : t('streamer.windowUnsupported')}</span>
        </span>
        <span className="toggle">
          <input
            type="checkbox"
            checked={streamer.window}
            disabled={!canHide}
            onChange={(e) => updateStreamer({ window: e.target.checked })}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>
      <label className="streamer-row">
        <span className="streamer-text">
          <span className="streamer-name">{t('streamer.audio')}</span>
          <span className="streamer-desc">{t('streamer.audioDesc')}</span>
        </span>
        <span className="toggle">
          <input
            type="checkbox"
            checked={streamer.audio}
            disabled={streamer.device === ''}
            onChange={(e) => updateStreamer({ audio: e.target.checked })}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>
      <div className="streamer-device">
        <select
          value={streamer.device}
          onChange={(e) => {
            const device = e.target.value
            updateStreamer({ device, audio: device !== '' ? true : false })
          }}
        >
          <option value="">{t('streamer.deviceNone')}</option>
          {choices.map((d, i) => (
            <option key={d.id} value={d.id}>{d.label || t('settings.playback.deviceN', { n: i + 1 })}</option>
          ))}
          {deviceMissing && <option value={streamer.device}>{t('streamer.deviceMissing')}</option>}
        </select>
        {devices.length === 0 && <span className="streamer-desc">{t('audioDevices.hint')}</span>}
      </div>
      <p className="streamer-note">{t('streamer.audioNote')}</p>
    </div>
  )
}

/** Кнопка в шапке: клик — включить/выключить, ПКМ — отдельные переключатели */
export default function StreamerButton({ outputDevice }: { outputDevice: string }) {
  const { t } = useI18n()
  const { streamer } = usePrefs()
  const active = streamerActive(streamer)
  const [menuOpen, setMenuOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className="tb-streamer" ref={wrap}>
      <button
        className={`tb-btn ${active ? 'tb-streamer-on' : ''}`}
        onClick={() => toggleStreamer()}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuOpen((v) => !v)
        }}
        title={active ? t('streamer.titleOn') : t('streamer.title')}
        aria-pressed={active}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="14" height="12" rx="2.5" />
          <path d="m16 10.5 5-3v9l-5-3" />
          {active && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
      {menuOpen && (
        <div className="tb-streamer-menu" role="dialog" aria-label={t('streamer.title')}>
          <div className="tb-streamer-head">{t('streamer.title')}</div>
          <StreamerToggles outputDevice={outputDevice} compact />
        </div>
      )}
    </div>
  )
}
