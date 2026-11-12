import { useEffect, useRef, useState } from 'react'
import Logo from '../../Logo'
import { readSettingsRaw, removeSettingsKeys, writeSettingsRaw } from './helpers'
import { notify, reportError } from '../../../lib/feedback'
import { useI18n } from '../../../i18n'
import {
  applyIcon,
  createIconShortcut,
  DEFAULT_ICON,
  ICON_PRESETS,
  normalizeIcon,
  resetIcon,
  sameIcon,
  type IconStyle,
} from '../../../lib/appIcon'

type Busy = 'apply' | 'reset' | 'shortcut' | null

/** «Оформление → Иконка»: палитры, свои цвета, форма; применяется к окну, трею и ярлыку */
export default function IconEditor() {
  const { t } = useI18n()
  const [draft, setDraft] = useState<IconStyle>(DEFAULT_ICON)
  /* Что сейчас стоит на самом деле; null — стандартная иконка Playly */
  const [applied, setApplied] = useState<IconStyle | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const preview = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void readSettingsRaw().then((settings) => {
      if (!alive || !settings.appIcon) return
      const style = normalizeIcon(settings.appIcon)
      setDraft(style)
      setApplied(style)
    })
    return () => {
      alive = false
    }
  }, [])

  const current = applied ?? DEFAULT_ICON
  const dirty = !sameIcon(draft, current)
  const patch = (next: Partial<IconStyle>) => setDraft((prev) => ({ ...prev, ...next }))

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>, errorKey: string) => {
    if (busy) return
    setBusy(kind)
    try {
      await action()
    } catch (e) {
      reportError(errorKey, e)
    } finally {
      setBusy(null)
    }
  }

  const apply = () =>
    run(
      'apply',
      async () => {
        const svg = preview.current?.querySelector('svg')
        if (!svg) return
        if (sameIcon(draft, DEFAULT_ICON)) {
          /* Собрали стандартную расцветку вручную — значит, это просто сброс */
          await resetIcon()
          await removeSettingsKeys(['appIcon'])
          setApplied(null)
        } else {
          await applyIcon(draft, svg)
          await writeSettingsRaw({ appIcon: draft })
          setApplied(draft)
        }
        notify('iconApplied')
      },
      'iconApply',
    )

  const reset = () =>
    run(
      'reset',
      async () => {
        await resetIcon()
        await removeSettingsKeys(['appIcon'])
        setApplied(null)
        setDraft(DEFAULT_ICON)
      },
      'iconApply',
    )

  const shortcut = () =>
    run(
      'shortcut',
      async () => {
        await createIconShortcut()
        notify('shortcutCreated')
      },
      'shortcutCreate',
    )

  return (
    <div className="settings-section">
      <div className="section-title">
        {t('iconEditor.title')}
        {dirty && <span className="icon-unsaved">{t('iconEditor.unsaved')}</span>}
      </div>

      <div className="icon-editor">
        <div
          ref={preview}
          className="icon-preview"
          style={{ background: draft.background, color: draft.foreground, borderRadius: draft.round ? '50%' : 26 }}
        >
          <Logo />
        </div>
        <div className="icon-palettes">
          <p className="setting-desc">{t('iconEditor.hint')}</p>
          <div className="icon-presets">
            {ICON_PRESETS.map(([background, foreground]) => (
              <button
                key={background + foreground}
                type="button"
                className="icon-swatch"
                aria-pressed={draft.background === background && draft.foreground === foreground}
                aria-label={`${background} / ${foreground}`}
                title={`${background.toUpperCase()} / ${foreground.toUpperCase()}`}
                style={{ background, color: foreground, borderRadius: draft.round ? '50%' : undefined }}
                onClick={() => patch({ background, foreground })}
              >
                <Logo />
              </button>
            ))}
          </div>
        </div>
      </div>

      {(['background', 'foreground'] as const).map((key) => (
        <div className="setting-row" key={key}>
          <div className="setting-name">{t(key === 'background' ? 'iconEditor.background' : 'iconEditor.mark')}</div>
          <label className="icon-color">
            <span>{draft[key].toUpperCase()}</span>
            <input
              aria-label={t(key === 'background' ? 'iconEditor.backgroundColor' : 'iconEditor.markColor')}
              type="color"
              value={draft[key]}
              onChange={(event) => patch({ [key]: event.target.value.toLowerCase() })}
            />
          </label>
        </div>
      ))}

      <div className="setting-row">
        <span className="setting-name">{t('iconEditor.shape')}</span>
        <div className="player-segmented">
          {[false, true].map((round) => (
            <button key={String(round)} type="button" aria-pressed={draft.round === round} onClick={() => patch({ round })}>
              {t(round ? 'iconEditor.circle' : 'iconEditor.square')}
            </button>
          ))}
        </div>
      </div>

      <div className="icon-actions">
        <button className="btn btn-primary" disabled={busy !== null || !dirty} onClick={() => void apply()}>
          {busy === 'apply' ? t('iconEditor.applying') : t('iconEditor.apply')}
        </button>
        <button className="btn" disabled={busy !== null || (applied === null && !dirty)} onClick={() => void reset()}>
          {t('iconEditor.reset')}
        </button>
        {/* Ярлык строится из уже применённой иконки, поэтому без неё кнопка не нужна */}
        <button className="btn" disabled={busy !== null || applied === null || dirty} onClick={() => void shortcut()}>
          {t('iconEditor.shortcut')}
        </button>
      </div>
      <p className="setting-desc">{t('iconEditor.note')}</p>
    </div>
  )
}
