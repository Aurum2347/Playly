import { useState } from 'react'
import type { RelinkChoice } from '../hooks/useLibrary'
import { useI18n } from '../i18n'
import PlayerDialog from './PlayerDialog'

/** Перемещённый трек нашёлся в нескольких местах: пользователь выбирает, какой файл — его */
export default function RelinkModal({ choices, onResolve }: { choices: RelinkChoice[]; onResolve: (trackId: number, path: string | null) => void }) {
  const { t } = useI18n()
  const choice = choices[0] ?? null
  const [picked, setPicked] = useState<{ trackId: number; path: string } | null>(null)
  const value = picked && choice && picked.trackId === choice.trackId ? picked.path : choice?.candidates[0] ?? ''

  return (
    <PlayerDialog
      open={choice !== null}
      title={t('relink.title')}
      subtitle={choice ? choice.title : undefined}
      onClose={() => choice && onResolve(choice.trackId, null)}
    >
      {choice && (
        <>
          <p className="frame-modal-sub" style={{ margin: '4px 0 8px', lineHeight: 1.5 }}>
            {t('relink.body')}
          </p>
          <p className="frame-modal-sub" style={{ margin: '0 0 10px', wordBreak: 'break-all', opacity: 0.8 }}>
            {t('relink.oldPath', { path: choice.oldPath })}
          </p>
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {choice.candidates.map((path) => (
              <label key={path} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', wordBreak: 'break-all' }}>
                <input
                  type="radio"
                  name="relink"
                  checked={value === path}
                  onChange={() => setPicked({ trackId: choice.trackId, path })}
                  style={{ marginTop: 3 }}
                />
                <span>{path}</span>
              </label>
            ))}
          </div>
          {choices.length > 1 && (
            <p className="frame-modal-sub" style={{ margin: '10px 0 0' }}>{t('relink.more', { n: choices.length - 1 })}</p>
          )}
          <footer className="frame-modal-actions">
            <button className="btn" onClick={() => onResolve(choice.trackId, null)}>{t('relink.skip')}</button>
            <button className="btn btn-primary" data-initial-focus disabled={!value} onClick={() => onResolve(choice.trackId, value)}>
              {t('relink.apply')}
            </button>
          </footer>
        </>
      )}
    </PlayerDialog>
  )
}
