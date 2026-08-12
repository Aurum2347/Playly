import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { readSettingsRaw, sliderPercent, useOutsideClose, writeSettingsRaw } from './helpers'
import { useI18n } from '../../../i18n'

interface PlaybackSectionProps {
  crossfade?: number
  onChangeCrossfade?: (sec: number) => void
  outputDevice?: string
  onChangeOutputDevice?: (id: string) => void
}

type EqPreset = 'flat' | 'rock' | 'pop' | 'bass' | 'classic'

const EQ_KEYS: EqPreset[] = ['flat', 'rock', 'pop', 'bass', 'classic']

const EQ_LABEL_KEYS: Record<EqPreset, string> = {
  flat: 'settings.playback.presetFlat',
  rock: 'settings.playback.presetRock',
  pop: 'settings.playback.presetPop',
  bass: 'settings.playback.presetBass',
  classic: 'settings.playback.presetClassic',
}

export default function PlaybackSection({
  crossfade,
  onChangeCrossfade,
  outputDevice,
  onChangeOutputDevice,
}: PlaybackSectionProps) {
  const { t } = useI18n()
  const [localCrossfade, setLocalCrossfade] = useState(0)
  const [localOutputDevice, setLocalOutputDevice] = useState('')
  const [outputDevices, setOutputDevices] = useState<{ id: string; label: string }[]>([])
  const [defaultDeviceName, setDefaultDeviceName] = useState('')
  const [normalization, setNormalization] = useState(true)
  const [eqEnabled, setEqEnabled] = useState(false)
  const [eqPreset, setEqPreset] = useState<EqPreset>('flat')
  const [openDropdown, setOpenDropdown] = useState<'presets' | 'output' | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useOutsideClose(dropdownRef, () => setOpenDropdown(null))

  /* ===== Читаем сохранённые значения из settings.json ===== */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await readSettingsRaw()
      if (cancelled) return
      if (crossfade === undefined && typeof data.crossfade === 'number') {
        setLocalCrossfade(Math.max(0, Math.min(12, Math.round(data.crossfade))))
      }
      if (outputDevice === undefined && typeof data.outputDevice === 'string') {
        setLocalOutputDevice(data.outputDevice)
      }
      if (typeof data.normalization === 'boolean') setNormalization(data.normalization)
      if (typeof data.eqEnabled === 'boolean') setEqEnabled(data.eqEnabled)
      if (typeof data.eq === 'string' && (EQ_KEYS as string[]).includes(data.eq)) {
        setEqPreset(data.eq as EqPreset)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ===== Список устройств вывода (без запроса микрофона) ===== */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const devs = await navigator.mediaDevices.enumerateDevices()
        const outputs = devs.filter((d) => d.kind === 'audiooutput')

        /* Название динамика, который в системе "по умолчанию" */
        let name = ''
        const pseudo = outputs.find((d) => d.deviceId === 'default')
        if (pseudo) {
          const stripped = pseudo.label.replace(/\s*\(Default\)\s*$/i, '')
          const m = stripped.match(/^(?:По умолчанию|Default)\s*-\s*(.+)$/)
          name = m ? m[1].trim() : ''
          if (!name && pseudo.groupId) {
            const real = outputs.find(
              (d) =>
                d.groupId === pseudo.groupId &&
                d.deviceId !== 'default' &&
                d.deviceId !== 'communications'
            )
            if (real) name = real.label
          }
        }

        if (!cancelled) {
          setDefaultDeviceName(name)
          setOutputDevices(
            outputs
              .filter((d) => !d.label.startsWith('По умолчанию') && !d.label.startsWith('Связь'))
              .map((d, i) => ({ id: d.deviceId, label: d.label || `Устройство ${i + 1}` }))
          )
        }
      } catch {
        // ignore
      }
    }
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', load)
    }
  }, [])

  const crossfadeValue = crossfade ?? localCrossfade
  const outputDeviceValue = outputDevice ?? localOutputDevice

  /* Первый пункт списка устройств */
  const defaultLabel = defaultDeviceName
    ? t('settings.playback.defaultDevice', { name: defaultDeviceName })
    : t('settings.playback.defaultDeviceShort')

  /* Подпись на кнопке: какое устройство сейчас выбрано */
  const selectedOutputLabel =
    outputDeviceValue === ''
      ? defaultLabel
      : outputDevices.find((d) => d.id === outputDeviceValue)?.label || defaultLabel

  const handleCrossfadeChange = (v: number) => {
    const val = Math.max(0, Math.min(12, Math.round(v)))
    setLocalCrossfade(val)
    if (onChangeCrossfade) onChangeCrossfade(val)
    else writeSettingsRaw({ crossfade: val })
  }

  const handleOutputDeviceChange = (id: string) => {
    setLocalOutputDevice(id)
    if (onChangeOutputDevice) onChangeOutputDevice(id)
    else writeSettingsRaw({ outputDevice: id })
    window.dispatchEvent(new CustomEvent('playly-output-device', { detail: id }))
  }

  const handleNormalizationChange = (v: boolean) => {
    setNormalization(v)
    writeSettingsRaw({ normalization: v })
    window.dispatchEvent(new CustomEvent('playly-normalization', { detail: v }))
  }

  const handleEqToggle = (v: boolean) => {
    setEqEnabled(v)
    writeSettingsRaw({ eqEnabled: v })
    window.dispatchEvent(new CustomEvent('playly-eq', { detail: { enabled: v, preset: eqPreset } }))
  }

  const handlePresetChange = (v: EqPreset) => {
    setEqPreset(v)
    writeSettingsRaw({ eq: v })
    window.dispatchEvent(new CustomEvent('playly-eq', { detail: { enabled: eqEnabled, preset: v } }))
  }

  return (
    <div ref={dropdownRef}>
      <h1 className="page-title">{t('settings.playback.title')}</h1>
      <p className="page-subtitle">{t('settings.playback.subtitle')}</p>
      <div className="settings-section">
        <div className="section-title">{t('settings.playback.section')}</div>
        {/* ===== Кроссфейд ===== */}
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.playback.crossfade')}</div>
            <div className="setting-desc">{t('settings.playback.crossfadeDesc')}</div>
          </div>
          <div className="setting-control">
            <div className="slider-wrap">
              <input
                type="range"
                min="0"
                max="12"
                value={crossfadeValue}
                style={{ '--val': `${sliderPercent(crossfadeValue, 0, 12)}%` } as CSSProperties}
                onChange={(e) => handleCrossfadeChange(Number(e.target.value))}
              />
              <span className="slider-value">
                {t('settings.playback.seconds', { n: crossfadeValue })}
              </span>
            </div>
          </div>
        </div>
        {/* ===== Нормализация ===== */}
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.playback.normalization')}</div>
            <div className="setting-desc">{t('settings.playback.normalizationDesc')}</div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={normalization}
                onChange={(e) => handleNormalizationChange(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
        {/* ===== Устройство вывода ===== */}
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.playback.outputDevice')}</div>
            <div className="setting-desc">{t('settings.playback.outputDeviceDesc')}</div>
          </div>
          <div className="setting-control">
            <div className="dropdown">
              <button
                className={`select-btn ${openDropdown === 'output' ? 'open' : ''}`}
                onClick={() => setOpenDropdown(openDropdown === 'output' ? null : 'output')}
              >
                <span className="btn-label">{selectedOutputLabel}</span>
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
              {openDropdown === 'output' && (
                <div
                  className="dropdown-menu open"
                  style={{ maxHeight: 208, overflowY: 'auto', overscrollBehavior: 'contain' }}
                >
                  <button
                    className={`dropdown-option ${outputDeviceValue === '' ? 'active' : ''}`}
                    onClick={() => {
                      handleOutputDeviceChange('')
                      setOpenDropdown(null)
                    }}
                  >
                    <span>{defaultLabel}</span>
                  </button>
                  {outputDevices.map((d) => (
                    <button
                      key={d.id}
                      className={`dropdown-option ${outputDeviceValue === d.id ? 'active' : ''}`}
                      onClick={() => {
                        handleOutputDeviceChange(d.id)
                        setOpenDropdown(null)
                      }}
                    >
                      <span>{d.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* ===== Эквалайзер: переключатель ===== */}
        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.playback.equalizer')}</div>
            <div className="setting-desc">{t('settings.playback.equalizerDesc')}</div>
          </div>
          <div className="setting-control">
            <label className="toggle">
              <input
                type="checkbox"
                checked={eqEnabled}
                onChange={(e) => handleEqToggle(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
        {/* ===== Панель пресетов (недоступна, если эквалайзер выключен) ===== */}
        <div className={`eq-panel ${eqEnabled ? '' : 'disabled'}`}>
          <div>
            <div className="eq-panel-title">{t('settings.playback.presets')}</div>
            <div className="eq-panel-desc">{t('settings.playback.presetsDesc')}</div>
          </div>
          <div className="dropdown">
            <button
              className={`select-btn ${openDropdown === 'presets' ? 'open' : ''}`}
              onClick={() => setOpenDropdown(openDropdown === 'presets' ? null : 'presets')}
            >
              <span className="btn-label">{t(EQ_LABEL_KEYS[eqPreset])}</span>
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
            {openDropdown === 'presets' && (
              <div className="dropdown-menu open">
                {EQ_KEYS.map((val) => (
                  <button
                    key={val}
                    className={`dropdown-option ${eqPreset === val ? 'active' : ''}`}
                    onClick={() => {
                      handlePresetChange(val)
                      setOpenDropdown(null)
                    }}
                  >
                    <span>{t(EQ_LABEL_KEYS[val])}</span>
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
    </div>
  )
}