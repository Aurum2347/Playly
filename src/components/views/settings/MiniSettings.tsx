import type { CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { updateMiniPreferences, useMiniPreferences } from '../../../lib/miniPreferences'
import { useI18n } from '../../../i18n'
import Collapse from '../../Collapse'
import { sliderPercent } from './helpers'

/** «Система → Мини-плеер»: включение, фон и затемнение */
export default function MiniSettings() {
  const { t } = useI18n()
  const p = useMiniPreferences()

  return (
    <div className="settings-section">
      <div className="section-title">{t('miniSettings.title')}</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-name">{t('miniSettings.enable')}</div>
          <div className="setting-desc">{t('miniSettings.enableDesc')}</div>
        </div>
        <label className="toggle">
          <input
            aria-label={t('miniSettings.enable')}
            type="checkbox"
            checked={p.enabled}
            onChange={(event) => updateMiniPreferences({ enabled: event.target.checked })}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      <Collapse open={p.enabled}>
        <div className="mini-preferences">
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-name">{t('miniSettings.background')}</div>
            </div>
            <div className="player-segmented" role="radiogroup" aria-label={t('miniSettings.background')}>
              {(['cover', 'dark'] as const).map((background) => (
                <button
                  key={background}
                  role="radio"
                  aria-checked={p.background === background}
                  aria-pressed={p.background === background}
                  onClick={() => updateMiniPreferences({ background })}
                >
                  <span className={`mini-bg-swatch ${background}`} aria-hidden="true" />
                  {t(`miniSettings.${background}`)}
                </button>
              ))}
            </div>
          </div>

          <Collapse open={p.background === 'cover'}>
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-name">{t('miniSettings.dim')}</div>
              </div>
              <div className="setting-control">
                <div className="slider-wrap">
                  <input
                    aria-label={t('miniSettings.dim')}
                    type="range"
                    min={0}
                    max={0.9}
                    step={0.05}
                    value={p.dim}
                    style={{ '--val': `${sliderPercent(p.dim, 0, 0.9)}%` } as CSSProperties}
                    onChange={(event) => updateMiniPreferences({ dim: Number(event.target.value) })}
                  />
                  <span className="slider-value">{Math.round(p.dim * 100)}%</span>
                </div>
              </div>
            </div>
          </Collapse>

          <div className="mini-open-action">
            <button className="btn" onClick={() => invoke('toggle_mini_player').catch(() => {})}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><rect x="12" y="11" width="7" height="7" rx="1" /></svg>
              {t('miniSettings.toggle')}
            </button>
          </div>
        </div>
      </Collapse>
    </div>
  )
}
