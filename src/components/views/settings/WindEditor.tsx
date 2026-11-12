import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { WIND_LIMITS, WIND_MAX_PHASES, type ParticleSettings, type WindPhase } from '../../../lib/appearance'
import { useI18n } from '../../../i18n'
import Collapse from '../../Collapse'

const SNAP = 15
const NEW_PHASE: WindPhase = { direction: 90, duration: 8, strength: 20 }
/* 0° — вниз, 90° — вправо, дальше по часовой стрелке на экране */
const DIRECTIONS = ['down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft'] as const

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/**
 * Числовое поле, в котором можно стереть значение и набрать новое:
 * пока пользователь печатает, держим черновик, а на выходе из поля приводим к границам.
 */
function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(clamp(Math.round(n), min, max))
    setDraft(null)
  }

  return (
    <label className="wind-value">
      <span>{label}</span>
      <div>
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={draft ?? String(value)}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const text = event.target.value.replace(/[^\d]/g, '')
            setDraft(text)
            /* Подходящее число применяем сразу, чтобы частицы откликались на ввод */
            const n = Number(text)
            if (text !== '' && n >= min && n <= max) onChange(n)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              setDraft(null)
              onChange(clamp(value + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1), min, max))
            }
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  )
}

/** Ветер для частиц: до пяти порывов, которые сменяют друг друга по кругу */
export default function WindEditor({ value, onChange }: { value: ParticleSettings; onChange: (p: ParticleSettings) => void }) {
  const { t } = useI18n()
  const snapping = useRef(false)
  const [removing, setRemoving] = useState<number | null>(null)
  const wind = value.wind ?? []

  const setWind = (next: WindPhase[]) => onChange({ ...value, wind: next })
  const update = (index: number, patch: Partial<WindPhase>) =>
    setWind(wind.map((phase, i) => (i === index ? { ...phase, ...patch } : phase)))

  const remove = (index: number) => {
    if (removing !== null) return
    setRemoving(index)
    /* Даём карточке доиграть анимацию исчезновения */
    window.setTimeout(() => {
      setWind(wind.filter((_, i) => i !== index))
      setRemoving(null)
    }, 180)
  }

  /* С Ctrl стрелки двигают угол сразу на 15°: иначе шаг в 1° округлялся бы обратно и угол стоял на месте */
  const angleKeys = (index: number, direction: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    snapping.current = event.ctrlKey
    if (!event.ctrlKey) return
    const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (!sign) return
    event.preventDefault()
    const snapped = sign > 0 ? Math.floor(direction / SNAP) * SNAP + SNAP : Math.ceil(direction / SNAP) * SNAP - SNAP
    update(index, { direction: clamp(snapped, 0, 360) % 360 })
  }

  return (
    <div className="wind-editor">
      <div className="wind-editor-head">
        <div>
          <div className="setting-name">
            {t('wind.title')}
            <span className="wind-count">
              {wind.length} / {WIND_MAX_PHASES}
            </span>
          </div>
          <p className="setting-desc">{t('wind.desc')}</p>
        </div>
        <button className="btn" disabled={wind.length >= WIND_MAX_PHASES} onClick={() => setWind([...wind, NEW_PHASE])}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('wind.add')}
        </button>
      </div>

      <Collapse open={wind.length > 0}>
        <div className="wind-phases">
          {wind.map((phase, i) => {
            const name = t('wind.phase', { n: i + 1 })
            const where = t(`wind.directions.${DIRECTIONS[Math.round(phase.direction / 45) % 8]}`)
            return (
              <section className={`wind-phase ${removing === i ? 'removing' : ''}`} key={i} aria-label={name}>
                <div className="wind-phase-heading">
                  <span className="wind-direction-mark" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: `rotate(${-phase.direction}deg)` }}
                    >
                      <path d="M12 4v16m-6-6 6 6 6-6" />
                    </svg>
                  </span>
                  <strong>{name}</strong>
                  <button
                    className="player-close"
                    disabled={removing !== null}
                    aria-label={`${t('wind.remove')}: ${name}`}
                    title={t('wind.remove')}
                    onClick={() => remove(i)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                      <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>

                <div className="wind-angle">
                  <label htmlFor={`wind-angle-${i}`}>{t('wind.angle')}</label>
                  <div className="slider-wrap">
                    <input
                      id={`wind-angle-${i}`}
                      type="range"
                      min={0}
                      max={359}
                      value={phase.direction}
                      aria-valuetext={`${phase.direction}°, ${where}`}
                      style={{ '--val': `${(phase.direction / 359) * 100}%` } as CSSProperties}
                      onPointerDown={(event) => {
                        snapping.current = event.ctrlKey
                      }}
                      onKeyDown={angleKeys(i, phase.direction)}
                      onChange={(event) => {
                        const n = Number(event.target.value)
                        update(i, { direction: snapping.current ? (Math.round(n / SNAP) * SNAP) % 360 : n })
                      }}
                    />
                    <span className="slider-value wind-angle-value">
                      {phase.direction}° <span>{where}</span>
                    </span>
                  </div>
                </div>

                <div className="wind-values">
                  <NumberField
                    label={t('wind.duration')}
                    unit={t('wind.seconds')}
                    value={phase.duration}
                    min={WIND_LIMITS.duration.min}
                    max={WIND_LIMITS.duration.max}
                    onChange={(duration) => update(i, { duration })}
                  />
                  <NumberField
                    label={t('wind.strength')}
                    unit={t('wind.pxPerSecond')}
                    value={phase.strength}
                    min={WIND_LIMITS.strength.min}
                    max={WIND_LIMITS.strength.max}
                    onChange={(strength) => update(i, { strength })}
                  />
                </div>
              </section>
            )
          })}
        </div>
      </Collapse>

      {!wind.length && <p className="wind-empty">{t('wind.empty')}</p>}
    </div>
  )
}
