import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import { getPrefs, streamerActive, toggleStreamer, updateStreamer, usePrefs } from '../../lib/prefs'
import { pickPrivateDevice, playTestTone, privateChoices, requestDeviceLabels, useOutputs } from '../../lib/outputDevices'
import './StreamerControl.css'

let captureSupport: Promise<boolean> | null = null
function captureHideSupported(): Promise<boolean> {
  captureSupport ??= invoke<boolean>('capture_hide_supported').catch(() => false)
  return captureSupport
}

type AudioProblem = '' | 'noDevice' | 'needAccess' | 'unknownSystem'

/** Переключатели режима стримера: одни и те же в меню шапки и в настройках */
export function StreamerToggles({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { streamer } = usePrefs()
  const [refresh, setRefresh] = useState(0)
  const info = useOutputs(refresh)
  const [canHide, setCanHide] = useState(true)
  const [problem, setProblem] = useState<AudioProblem>('')
  const [access, setAccess] = useState<'' | 'busy' | 'denied' | 'failed'>('')
  const [tested, setTested] = useState<'' | 'ok' | 'fail'>('')
  const [helpOpen, setHelpOpen] = useState(!compact)
  useEffect(() => {
    void captureHideSupported().then(setCanHide)
  }, [])

  const choices = privateChoices(info)
  const deviceMissing = streamer.device !== '' && info.devices.length > 0 && !info.devices.some((d) => d.id === streamer.device)
  const nameOf = (id: string) => {
    const i = info.devices.findIndex((d) => d.id === id)
    return i < 0 ? '' : info.devices[i].label || t('settings.playback.deviceN', { n: i + 1 })
  }

  /* Устройство для скрытого звука подбирается само; если подобрать не из чего - объясняем почему */
  const enableAudio = () => {
    const id = pickPrivateDevice(info, streamer.device)
    if (id) {
      setProblem('')
      updateStreamer({ audio: true, device: id })
      return
    }
    setProblem(info.labelsHidden || info.devices.length === 0 ? 'needAccess' : info.systemId === null ? 'unknownSystem' : 'noDevice')
  }

  const grantAccess = async () => {
    setAccess('busy')
    const r = await requestDeviceLabels()
    setAccess(r === 'ok' ? '' : r)
    if (r === 'ok') setRefresh((v) => v + 1)
  }

  /* После разрешения доступа сразу включаем то, что пользователь и хотел */
  useEffect(() => {
    if (refresh === 0 || problem !== 'needAccess' || info.devices.length === 0 || info.labelsHidden) return
    const id = pickPrivateDevice(info, streamer.device)
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProblem('')
      updateStreamer({ audio: true, device: id })
    } else setProblem(info.systemId === null ? 'unknownSystem' : 'noDevice')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  /* Звук включили кнопкой в шапке, а устройство ещё не выбрано: подбираем или объясняем */
  useEffect(() => {
    if (streamer.audio && !streamer.device) {
      updateStreamer({ audio: false })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      enableAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamer.audio, streamer.device])

  const showAccess = problem === 'needAccess' || (streamer.audio && info.labelsHidden)

  return (
    <div className={`streamer-toggles ${compact ? 'compact' : ''}`}>
      <label className="streamer-row">
        <span className="streamer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M8 21h8M12 17v4" /><line x1="4" y1="3" x2="20" y2="19" />
          </svg>
        </span>
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
        <span className="streamer-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" />
          </svg>
        </span>
        <span className="streamer-text">
          <span className="streamer-name">{t('streamer.audio')}</span>
          <span className="streamer-desc">{t('streamer.audioDesc')}</span>
        </span>
        <span className="toggle">
          <input
            type="checkbox"
            checked={streamer.audio}
            onChange={(e) => {
              if (e.target.checked) enableAudio()
              else {
                setProblem('')
                updateStreamer({ audio: false })
              }
            }}
          />
          <span className="toggle-slider"></span>
        </span>
      </label>

      {(streamer.audio || problem) && (
        <div className="streamer-audio-panel">
          {streamer.audio && (
            <>
              <div className="streamer-route">
                <span className="streamer-route-label">{t('streamer.streamHears')}</span>
                <span className="streamer-route-value">{info.systemLabel || t('streamer.systemDevice')}</span>
              </div>
              <div className="streamer-route">
                <span className="streamer-route-label">{t('streamer.youHear')}</span>
                <select
                  className="streamer-select"
                  value={streamer.device}
                  onChange={(e) => {
                    setTested('')
                    updateStreamer({ device: e.target.value })
                  }}
                >
                  {choices.map((d) => (
                    <option key={d.id} value={d.id}>{nameOf(d.id)}</option>
                  ))}
                  {deviceMissing && <option value={streamer.device}>{t('streamer.deviceMissing')}</option>}
                </select>
              </div>
              <div className="streamer-actions">
                <button
                  type="button"
                  className="btn streamer-test"
                  title={t('streamer.testHint')}
                  onClick={() => void playTestTone(streamer.device).then((ok) => setTested(ok ? 'ok' : 'fail'))}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></svg>
                  {t('streamer.test')}
                </button>
                {tested && <span className={`streamer-desc ${tested === 'fail' ? 'warn' : ''}`}>{t(tested === 'ok' ? 'streamer.testDone' : 'streamer.testFailed')}</span>}
              </div>
              {info.systemId === null && <p className="streamer-warn">{t('streamer.unknownSystem')}</p>}
            </>
          )}

          {problem === 'noDevice' && <p className="streamer-warn">{t('streamer.noDevice')}</p>}
          {problem === 'unknownSystem' && <p className="streamer-warn">{t('streamer.unknownSystemPick')}</p>}
          {problem === 'unknownSystem' && choices.length > 0 && (
            <div className="streamer-route">
              <span className="streamer-route-label">{t('streamer.youHear')}</span>
              <select
                className="streamer-select"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return
                  setProblem('')
                  updateStreamer({ audio: true, device: e.target.value })
                }}
              >
                <option value="">{t('streamer.deviceNone')}</option>
                {choices.map((d) => (
                  <option key={d.id} value={d.id}>{nameOf(d.id)}</option>
                ))}
              </select>
            </div>
          )}
          {showAccess && (
            <div className="streamer-access">
              <p className="streamer-desc">{t('streamer.needAccess')}</p>
              <button type="button" className="btn" disabled={access === 'busy'} onClick={() => void grantAccess()}>
                {access === 'busy' ? t('audioDevices.finding') : t('audioDevices.find')}
              </button>
              {(access === 'denied' || access === 'failed') && <p className="streamer-warn">{t(`audioDevices.${access}`)}</p>}
            </div>
          )}
        </div>
      )}

      <button type="button" className={`streamer-help-toggle ${helpOpen ? 'open' : ''}`} aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
        {t('streamer.howTitle')}
      </button>
      {helpOpen && (
        <div className="streamer-help">
          <p>{t('streamer.how')}</p>
          <ul>
            <li className="ok">{t('streamer.works1')}</li>
            <li className="ok">{t('streamer.works2')}</li>
            <li className="ok">{t('streamer.works3')}</li>
            <li className="no">{t('streamer.limit1')}</li>
            <li className="no">{t('streamer.limit2')}</li>
          </ul>
        </div>
      )}
    </div>
  )
}

/** Кнопка в шапке: клик - включить/выключить, ПКМ - отдельные переключатели */
export default function StreamerButton() {
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
        onClick={() => {
          toggleStreamer()
          /* Звуку нужно подходящее устройство: если его ещё нет, меню объяснит, что делать */
          const s = getPrefs().streamer
          if (s.audio && !s.device) setMenuOpen(true)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuOpen((v) => !v)
        }}
        title={`${active ? t('streamer.titleOn') : t('streamer.title')}\n${t('streamer.rmbHint')}`}
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
          <div className="tb-streamer-head">
            <span>{t('streamer.title')}</span>
            <span className={`tb-streamer-state ${active ? 'on' : ''}`}>{active ? t('streamer.stateOn') : t('streamer.stateOff')}</span>
          </div>
          <StreamerToggles compact />
        </div>
      )}
    </div>
  )
}
