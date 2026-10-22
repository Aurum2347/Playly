import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { readSettingsRaw, sliderPercent, useOutsideClose, writeSettingsRaw } from './helpers'
import { useI18n } from '../../../i18n'
import Collapse from '../../Collapse'
import EqCurve from '../../EqCurve'
import EqEditorModal, { type EqEditTarget } from '../../EqEditorModal'
import { BUILTIN_EQ_PRESETS, EQ_BANDS, bandLabel, isBuiltinPreset, presetGains, type EqPreset } from '../../../lib/equalizer'
import '../../Equalizer.css'

type CurveKind = 'equal' | 'linear' | 'smooth'

const CURVES: CurveKind[] = ['equal', 'smooth', 'linear']

const CURVE_LABEL_KEYS: Record<CurveKind, string> = {
  equal: 'settings.playback.curveEqual',
  smooth: 'settings.playback.curveSmooth',
  linear: 'settings.playback.curveLinear',
}

function curveValue(kind: CurveKind, p: number) {
  if (kind === 'linear') return p
  if (kind === 'smooth') return p * p * (3 - 2 * p)
  return Math.sin((p * Math.PI) / 2)
}

/* Мини-график: как затухает старый трек и нарастает новый */
function CurvePreview({ kind }: { kind: CurveKind }) {
  const pts = (fn: (p: number) => number) =>
    Array.from({ length: 33 }, (_, i) => {
      const p = i / 32
      return `${(p * 100).toFixed(1)},${(37 - fn(p) * 34).toFixed(1)}`
    }).join(' ')
  return (
    <svg className="xfade-preview" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline className="xfade-out" points={pts((p) => curveValue(kind, 1 - p))} />
      <polyline className="xfade-in" points={pts((p) => curveValue(kind, p))} />
    </svg>
  )
}

interface PlaybackSectionProps {
  crossfade?: number
  onChangeCrossfade?: (sec: number) => void
  manualCrossfade?: boolean
  onChangeManualCrossfade?: (v: boolean) => void
  crossfadeCurve?: CurveKind
  onChangeCrossfadeCurve?: (c: CurveKind) => void
  outputDevice?: string
  onChangeOutputDevice?: (id: string) => void
  eqEnabled?: boolean
  eqPresetId?: string
  eqCustomPresets?: EqPreset[]
  onChangeEqEnabled?: (v: boolean) => void
  onChangeEqPreset?: (id: string) => void
  onSaveEqPreset?: (p: EqPreset) => void
  onDeleteEqPreset?: (id: string) => void
  onPreviewEq?: (gains: number[] | null) => void
}

const noopPreview = () => {}

export default function PlaybackSection({
  crossfade,
  onChangeCrossfade,
  manualCrossfade = false,
  onChangeManualCrossfade,
  crossfadeCurve = 'equal',
  onChangeCrossfadeCurve,
  outputDevice,
  onChangeOutputDevice,
  eqEnabled = false,
  eqPresetId = 'flat',
  eqCustomPresets = [],
  onChangeEqEnabled,
  onChangeEqPreset,
  onSaveEqPreset,
  onDeleteEqPreset,
  onPreviewEq = noopPreview,
}: PlaybackSectionProps) {
  const { t } = useI18n()
  const [localCrossfade, setLocalCrossfade] = useState(0)
  const [localOutputDevice, setLocalOutputDevice] = useState('')
  const [outputDevices, setOutputDevices] = useState<{ id: string; label: string }[]>([])
  const [defaultDeviceName, setDefaultDeviceName] = useState('')
  const [normalization, setNormalization] = useState(true)
  const [eqEdit, setEqEdit] = useState<EqEditTarget | null>(null)
  const [openDropdown, setOpenDropdown] = useState<'output' | 'curve' | null>(null)
  const outputDropdownRef = useRef<HTMLDivElement>(null)
  const curveDropdownRef = useRef<HTMLDivElement>(null)

  /* Закрываем список при клике мимо именно открытого списка (раньше считался «внутри» весь раздел) */
  const activeDropdownRef = openDropdown === 'output' ? outputDropdownRef : curveDropdownRef
  useOutsideClose(activeDropdownRef, () => setOpenDropdown(null))

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
              /* 'default' и 'communications' — псевдоустройства Windows, дублирующие реальные */
              .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
              .map((d) => ({ id: d.deviceId, label: d.label }))
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

  /* ===== Эквалайзер ===== */
  const presetName = (id: string) =>
    eqCustomPresets.find((p) => p.id === id)?.name ?? t(`eq.preset_${id}`)

  /* Встроенный пресет не меняем — редактирование создаёт свою копию */
  const editCurrentPreset = () => {
    const custom = eqCustomPresets.find((p) => p.id === eqPresetId)
    if (custom) {
      setEqEdit({ id: custom.id, name: custom.name, gains: custom.gains })
    } else {
      setEqEdit({
        id: null,
        name: t('eq.copyName', { name: presetName(eqPresetId) }),
        gains: presetGains(eqPresetId, eqCustomPresets),
      })
    }
  }

  const createPreset = () => setEqEdit({ id: null, name: t('eq.newName'), gains: presetGains('flat', []) })

  return (
    <div>
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
        {/* ===== Кроссфейд: детали (видны, только если он включён) ===== */}
        <Collapse open={crossfadeValue > 0}>
          <div className="xfade-panel">
            <div className="xfade-panel-row">
              <div>
                <div className="eq-panel-title">{t('settings.playback.curve')}</div>
                <div className="eq-panel-desc">{t('settings.playback.curveDesc')}</div>
              </div>
              <div className="xfade-panel-controls">
                <CurvePreview kind={crossfadeCurve} />
                <div className="dropdown" ref={curveDropdownRef}>
                  <button
                    className={`select-btn ${openDropdown === 'curve' ? 'open' : ''}`}
                    onClick={() => setOpenDropdown(openDropdown === 'curve' ? null : 'curve')}
                  >
                    <span className="btn-label">{t(CURVE_LABEL_KEYS[crossfadeCurve])}</span>
                    <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {openDropdown === 'curve' && (
                    <div className="dropdown-menu open">
                      {CURVES.map((c) => (
                        <button
                          key={c}
                          className={`dropdown-option ${crossfadeCurve === c ? 'active' : ''}`}
                          onClick={() => {
                            onChangeCrossfadeCurve?.(c)
                            setOpenDropdown(null)
                          }}
                        >
                          <span>{t(CURVE_LABEL_KEYS[c])}</span>
                          <svg className="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="xfade-panel-row">
              <div>
                <div className="eq-panel-title">{t('settings.playback.manualCrossfade')}</div>
                <div className="eq-panel-desc">{t('settings.playback.manualCrossfadeDesc')}</div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={manualCrossfade}
                  onChange={(e) => onChangeManualCrossfade?.(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </Collapse>
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
            <div className="dropdown" ref={outputDropdownRef}>
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
                  {outputDevices.map((d, i) => (
                    <button
                      key={d.id}
                      className={`dropdown-option ${outputDeviceValue === d.id ? 'active' : ''}`}
                      onClick={() => {
                        handleOutputDeviceChange(d.id)
                        setOpenDropdown(null)
                      }}
                    >
                      <span>{d.label || t('settings.playback.deviceN', { n: i + 1 })}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* ===== Эквалайзер ===== */}
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
                onChange={(e) => onChangeEqEnabled?.(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
        {/* Панель видна только при включённом эквалайзере и раскрывается плавно */}
        <Collapse open={eqEnabled}>
          <div className="eq-card">
            <div className="eq-card-preview">
              <EqCurve gains={presetGains(eqPresetId, eqCustomPresets)} alignToColumns />
              <div className="eq-card-freqs" aria-hidden="true">
                {EQ_BANDS.map((f) => <span key={f}>{bandLabel(f)}</span>)}
              </div>
            </div>

            <div className="eq-card-head">
              <span className="eq-card-title">{t('settings.playback.presets')}</span>
              <div className="eq-card-actions">
                <button className="btn" onClick={editCurrentPreset}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                  {t('eq.tune')}
                </button>
                <button className="btn btn-primary" onClick={createPreset}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  {t('eq.new')}
                </button>
              </div>
            </div>

            <div className="eq-chips">
              {BUILTIN_EQ_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`eq-chip ${eqPresetId === p.id ? 'active' : ''}`}
                  onClick={() => onChangeEqPreset?.(p.id)}
                >
                  {t(`eq.preset_${p.id}`)}
                </button>
              ))}
              {eqCustomPresets.map((p) => (
                <button
                  key={p.id}
                  className={`eq-chip custom ${eqPresetId === p.id ? 'active' : ''}`}
                  onClick={() => onChangeEqPreset?.(p.id)}
                  onDoubleClick={() => setEqEdit({ id: p.id, name: p.name, gains: p.gains })}
                  title={t('eq.customHint')}
                >
                  {p.name}
                  <span
                    className="eq-chip-edit"
                    role="button"
                    aria-label={t('common.edit')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEqEdit({ id: p.id, name: p.name, gains: p.gains })
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Collapse>

        <EqEditorModal
          target={eqEdit}
          onCancel={() => setEqEdit(null)}
          onSave={(p) => {
            onSaveEqPreset?.(p)
            setEqEdit(null)
          }}
          onDelete={(id) => {
            if (!isBuiltinPreset(id)) onDeleteEqPreset?.(id)
          }}
          onPreview={onPreviewEq}
        />
      </div>
    </div>
  )
}