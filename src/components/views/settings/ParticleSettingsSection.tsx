import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../../../App'
import { useI18n } from '../../../i18n'
import Twemoji from '../../Twemoji'
import CustomParticleEditor from './CustomParticleEditor'
import { sliderPercent } from './helpers'
import { loadParticleSprite } from '../../../lib/particleSprites'
import {
  BUILTIN_PARTICLES,
  customIdOf,
  customKind,
  newCustomParticle,
  removeParticleImage,
  type BuiltinParticle,
  type CustomParticle,
  type ParticleKind,
  type ParticleRule,
  type ParticleSettings,
} from '../../../lib/appearance'

const KIND_EMOJI: Record<BuiltinParticle, string> = {
  snow: '❄️',
  sakura: '🌸',
  rain: '🌧️',
  leaves: '🍂',
  stars: '✨',
  fireflies: '💫',
}

/* Сколько треков показывать в окне выбора, пока не уточнили поиск */
const PICKER_LIMIT = 200

const NoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <line x1="5.6" y1="18.4" x2="18.4" y2="5.6" />
  </svg>
)

/** Миниатюра своей частицы: первый кадр её спрайта */
function CustomThumb({ particle }: { particle: CustomParticle }) {
  const [src, setSrc] = useState<{ key: CustomParticle['source']; url: string } | null>(null)
  useEffect(() => {
    let alive = true
    loadParticleSprite(particle.source)
      .then((sprite) => {
        const f = sprite.frames[0]
        const c = document.createElement('canvas')
        c.width = f.w
        c.height = f.h
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.imageSmoothingEnabled = sprite.smoothing !== 'pixelated'
        ctx.drawImage(f.image, 0, 0)
        if (alive) setSrc({ key: particle.source, url: c.toDataURL() })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [particle.source])
  const pixelated = particle.source.type === 'image' && particle.source.smoothing === 'pixelated'
  return src && src.key === particle.source ? (
    <img src={src.url} alt="" draggable={false} style={{ imageRendering: pixelated ? 'pixelated' : undefined }} />
  ) : null
}

function KindIcon({ kind, custom }: { kind: ParticleKind; custom: CustomParticle[] }) {
  if (kind === 'none') return <NoneIcon />
  const id = customIdOf(kind)
  if (id) {
    const c = custom.find((x) => x.id === id)
    return c ? <CustomThumb particle={c} /> : <NoneIcon />
  }
  return <Twemoji text={KIND_EMOJI[kind as BuiltinParticle]} />
}

interface ParticleSettingsSectionProps {
  value: ParticleSettings
  onChange: (p: ParticleSettings) => void
  tracks: Track[]
}

interface SliderProps {
  name: string
  value: number
  min: number
  max: number
  step: number
  display: string
  icon: React.ReactNode
  onChange: (v: number) => void
}

/* Компактный ползунок с иконкой — пять таких в сетке вместо пяти длинных строк */
function Slider({ name, value, min, max, step, display, icon, onChange }: SliderProps) {
  return (
    <label className="pt-slider">
      <span className="pt-slider-head">
        <span className="pt-slider-icon">{icon}</span>
        <span className="pt-slider-name">{name}</span>
        <span className="pt-slider-value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--val': `${sliderPercent(value, min, max)}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)

/** «Эффекты на фоне»: выбор частиц (своих тоже), параметры и правила для треков. Результат сразу виден на фоне приложения */
export default function ParticleSettingsSection({ value, onChange, tracks }: ParticleSettingsSectionProps) {
  const { t } = useI18n()
  const [editingRule, setEditingRule] = useState<ParticleRule | null>(null)
  const [editingCustom, setEditingCustom] = useState<{ particle: CustomParticle; isNew: boolean } | null>(null)
  const patch = (p: Partial<ParticleSettings>) => onChange({ ...value, ...p })
  const byId = useMemo(() => new Map(tracks.map((tr) => [tr.id, tr])), [tracks])
  const pct = (v: number) => `${Math.round(v * 100)}%`

  const kinds: ParticleKind[] = ['none', ...BUILTIN_PARTICLES, ...value.custom.map((c) => customKind(c.id))]
  const kindName = (k: ParticleKind) => {
    const id = customIdOf(k)
    return id ? value.custom.find((c) => c.id === id)?.name ?? '—' : t(`particles.kind_${k}`)
  }

  const saveRule = (rule: ParticleRule) => {
    const exists = value.rules.some((r) => r.id === rule.id)
    patch({ rules: exists ? value.rules.map((r) => (r.id === rule.id ? rule : r)) : [...value.rules, rule] })
    setEditingRule(null)
  }

  const saveCustom = (p: CustomParticle) => {
    const exists = value.custom.some((c) => c.id === p.id)
    onChange({
      ...value,
      custom: exists ? value.custom.map((c) => (c.id === p.id ? p : c)) : [...value.custom, p],
      /* Новую частицу сразу выбираем — её же только что делали */
      kind: exists ? value.kind : customKind(p.id),
    })
    setEditingCustom(null)
  }

  const deleteCustom = (p: CustomParticle) => {
    const k = customKind(p.id)
    if (p.source.type === 'image') void removeParticleImage(p.source.file)
    onChange({
      ...value,
      custom: value.custom.filter((c) => c.id !== p.id),
      kind: value.kind === k ? 'none' : value.kind,
      rules: value.rules.filter((r) => r.kind !== k),
    })
    setEditingCustom(null)
  }

  return (
    <div className="settings-section">
      <div className="section-title">{t('particles.section')}</div>

      <div className="particle-kinds" role="radiogroup" aria-label={t('particles.section')}>
        {kinds.map((k) => {
          const id = customIdOf(k)
          return (
            <button
              key={k}
              role="radio"
              aria-checked={value.kind === k}
              className={`particle-kind ${value.kind === k ? 'active' : ''} ${id ? 'custom' : `kind-${k}`}`}
              onClick={() => patch({ kind: k })}
              onDoubleClick={() => {
                const c = id ? value.custom.find((x) => x.id === id) : null
                if (c) setEditingCustom({ particle: c, isNew: false })
              }}
              title={id ? t('particles.customHint') : undefined}
            >
              <span className="particle-kind-icon"><KindIcon kind={k} custom={value.custom} /></span>
              <span className="particle-kind-name">{kindName(k)}</span>
              {id && (
                <span
                  className="particle-kind-edit"
                  role="button"
                  tabIndex={-1}
                  title={t('common.edit')}
                  onClick={(e) => {
                    e.stopPropagation()
                    const c = value.custom.find((x) => x.id === id)
                    if (c) setEditingCustom({ particle: c, isNew: false })
                  }}
                >
                  {svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></>)}
                </span>
              )}
            </button>
          )
        })}
        <button className="particle-kind add" onClick={() => setEditingCustom({ particle: newCustomParticle(t('particles.customDefault')), isNew: true })}>
          <span className="particle-kind-icon">{svg(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)}</span>
          <span className="particle-kind-name">{t('particles.addCustom')}</span>
        </button>
      </div>

      <div className="pt-sliders">
        <Slider name={t('particles.density')} icon={svg(<><circle cx="6" cy="7" r="1.5" /><circle cx="14" cy="5" r="1.5" /><circle cx="18" cy="13" r="1.5" /><circle cx="9" cy="15" r="1.5" /><circle cx="15" cy="19" r="1.5" /></>)} value={value.density} min={0.25} max={3} step={0.05} display={pct(value.density)} onChange={(density) => patch({ density })} />
        <Slider name={t('particles.speed')} icon={svg(<><path d="M5 12h10" /><path d="M3 7h8" /><path d="M7 17h8" /><path d="M17 8l4 4-4 4" /></>)} value={value.speed} min={0.25} max={3} step={0.05} display={pct(value.speed)} onChange={(speed) => patch({ speed })} />
        <Slider name={t('particles.size')} icon={svg(<><circle cx="8" cy="15" r="3" /><circle cx="16" cy="9" r="5" /></>)} value={value.size} min={0.5} max={2} step={0.05} display={pct(value.size)} onChange={(size) => patch({ size })} />
        <Slider name={t('particles.opacity')} icon={svg(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>)} value={value.opacity} min={0.1} max={1} step={0.05} display={pct(value.opacity)} onChange={(opacity) => patch({ opacity })} />
        <Slider name={t('particles.blur')} icon={svg(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" opacity="0.5" /><circle cx="12" cy="12" r="10" opacity="0.25" /></>)} value={value.blur} min={0} max={12} step={0.5} display={`${value.blur}px`} onChange={(blur) => patch({ blur })} />
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-name">{t('particles.onlyPlaying')}</div>
          <div className="setting-desc">{t('particles.onlyPlayingDesc')}</div>
        </div>
        <div className="setting-control">
          <label className="toggle">
            <input type="checkbox" checked={value.onlyWhilePlaying} onChange={(e) => patch({ onlyWhilePlaying: e.target.checked })} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* ===== Правила для треков ===== */}
      <div className="particle-rules">
        <div className="particle-rules-head">
          <div>
            <div className="setting-name">{t('particles.rules')}</div>
            <div className="setting-desc">{t('particles.rulesDesc')}</div>
          </div>
          <button
            className="btn"
            onClick={() => setEditingRule({ id: `r${Date.now().toString(36)}`, kind: value.kind === 'none' ? 'rain' : value.kind, trackIds: [] })}
          >
            + {t('particles.addRule')}
          </button>
        </div>

        {value.rules.length === 0 ? (
          <div className="particle-rules-empty">{t('particles.noRules')}</div>
        ) : (
          <div className="particle-rule-list">
            {value.rules.map((rule) => {
              const names = rule.trackIds.map((id) => byId.get(id)?.title).filter(Boolean) as string[]
              return (
                <div key={rule.id} className="particle-rule">
                  <span className="particle-rule-icon"><KindIcon kind={rule.kind} custom={value.custom} /></span>
                  <span className="particle-rule-text">
                    <span className="particle-rule-kind">{kindName(rule.kind)}</span>
                    <span className="particle-rule-tracks">
                      {names.length === 0
                        ? t('particles.ruleNoTracks')
                        : names.slice(0, 3).join(', ') + (names.length > 3 ? ` ${t('particles.andMore', { n: names.length - 3 })}` : '')}
                    </span>
                  </span>
                  <button className="btn btn-ghost" onClick={() => setEditingRule(rule)}>{t('common.edit')}</button>
                  <button className="icon-btn" title={t('common.delete')} onClick={() => patch({ rules: value.rules.filter((r) => r.id !== rule.id) })}>
                    {svg(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></>)}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editingRule && (
        <RuleEditor
          rule={editingRule}
          kinds={kinds}
          kindName={kindName}
          custom={value.custom}
          tracks={tracks}
          onClose={() => setEditingRule(null)}
          onSave={saveRule}
        />
      )}
      {editingCustom && (
        <CustomParticleEditor
          initial={editingCustom.particle}
          isNew={editingCustom.isNew}
          onClose={() => setEditingCustom(null)}
          onSave={saveCustom}
          onDelete={deleteCustom}
        />
      )}
    </div>
  )
}

interface RuleEditorProps {
  rule: ParticleRule
  kinds: ParticleKind[]
  kindName: (k: ParticleKind) => string
  custom: CustomParticle[]
  tracks: Track[]
  onClose: () => void
  onSave: (r: ParticleRule) => void
}

function RuleEditor({ rule, kinds, kindName, custom, tracks, onClose, onSave }: RuleEditorProps) {
  const { t } = useI18n()
  const [kind, setKind] = useState<ParticleKind>(rule.kind)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(rule.trackIds))
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /* Выбранные треки всегда сверху, дальше — найденные по запросу */
  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (tr: Track) => !q || tr.title.toLowerCase().includes(q) || tr.artist.toLowerCase().includes(q)
    const chosen = tracks.filter((tr) => selected.has(tr.id) && match(tr))
    const rest = tracks.filter((tr) => !selected.has(tr.id) && match(tr))
    return { list: [...chosen, ...rest].slice(0, PICKER_LIMIT), total: chosen.length + rest.length }
    /* selected сознательно не в зависимостях: иначе строки прыгают вверх прямо под курсором */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, query])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame-modal rule-editor">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('particles.ruleTitle')}</div>
          <div className="frame-modal-sub">{t('particles.ruleSub')}</div>
        </div>

        <div className="particle-kinds compact">
          {kinds.map((k) => (
            <button key={k} className={`particle-kind ${kind === k ? 'active' : ''} ${customIdOf(k) ? 'custom' : `kind-${k}`}`} onClick={() => setKind(k)}>
              <span className="particle-kind-icon"><KindIcon kind={k} custom={custom} /></span>
              <span className="particle-kind-name">{kindName(k)}</span>
            </button>
          ))}
        </div>

        <input className="input-field rule-search" placeholder={t('addTracks.search')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />

        <div className="rule-tracks">
          {found.list.length === 0 ? (
            <div className="particle-rules-empty">{tracks.length === 0 ? t('addTracks.libraryEmpty') : t('addTracks.notFound')}</div>
          ) : (
            found.list.map((tr) => (
              <label key={tr.id} className={`rule-track ${selected.has(tr.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={selected.has(tr.id)} onChange={() => toggle(tr.id)} />
                <span className="rpc-chip-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="rule-track-cover">{tr.cover ? <img src={tr.cover} alt="" loading="lazy" /> : null}</span>
                <span className="rule-track-text">
                  <span className="rule-track-title">{tr.title}</span>
                  <span className="rule-track-artist">{tr.artist}</span>
                </span>
              </label>
            ))
          )}
          {found.total > found.list.length && (
            <div className="particle-rules-empty">{t('particles.refineSearch', { shown: found.list.length, total: found.total })}</div>
          )}
        </div>

        <div className="frame-modal-actions">
          <span className="rule-count">{t('addTracks.selected', { n: selected.size })}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={selected.size === 0} onClick={() => onSave({ ...rule, kind, trackIds: [...selected] })}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
