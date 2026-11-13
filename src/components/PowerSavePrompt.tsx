import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n'
import { prefsLoaded, updatePrefs, usePrefs } from '../lib/prefs'
import PlayerDialog from './PlayerDialog'

interface SystemSpecs {
  totalMemoryMb: number
  cpuThreads: number
}

/*
 * Грубая оценка, а не тест производительности: мало памяти или мало потоков процессора.
 * Неизвестные значения (0) слабым устройство не делают.
 */
const LOW_MEMORY_MB = 4096 + 512
const LOW_THREADS = 2

// eslint-disable-next-line react-refresh/only-export-components
export function looksWeak(specs: SystemSpecs): boolean {
  const lowMemory = specs.totalMemoryMb > 0 && specs.totalMemoryMb <= LOW_MEMORY_MB
  const lowCpu = specs.cpuThreads > 0 && specs.cpuThreads <= LOW_THREADS
  return lowMemory || lowCpu
}

/** Один раз предлагает режим экономии на слабом устройстве; ответ запоминается, режим не навязывается */
export default function PowerSavePrompt() {
  const { t } = useI18n()
  const prefs = usePrefs()
  const checked = useRef(false)
  const [specs, setSpecs] = useState<SystemSpecs | null>(null)

  useEffect(() => {
    if (checked.current || !prefsLoaded()) return
    checked.current = true
    if (prefs.powerSave || prefs.powerSavePrompted) return
    void invoke<SystemSpecs>('system_specs')
      .then((s) => {
        if (looksWeak(s)) setSpecs(s)
      })
      .catch(() => {})
  }, [prefs])

  const answer = (enable: boolean) => {
    updatePrefs(enable ? { powerSave: true, powerSavePrompted: true } : { powerSavePrompted: true })
    setSpecs(null)
  }

  return (
    <PlayerDialog open={specs !== null} title={t('powerSave.promptTitle')} onClose={() => answer(false)}>
      <p className="frame-modal-sub" style={{ margin: '4px 0 6px', lineHeight: 1.5 }}>
        {t('powerSave.promptBody', {
          ram: specs && specs.totalMemoryMb > 0 ? (specs.totalMemoryMb / 1024).toFixed(1) : '?',
          cpu: specs && specs.cpuThreads > 0 ? specs.cpuThreads : '?',
        })}
      </p>
      <p className="frame-modal-sub" style={{ margin: '0 0 4px', lineHeight: 1.5 }}>{t('powerSave.promptLater')}</p>
      <footer className="frame-modal-actions">
        <button className="btn" onClick={() => answer(false)}>{t('powerSave.promptNo')}</button>
        <button className="btn btn-primary" data-initial-focus onClick={() => answer(true)}>{t('powerSave.promptYes')}</button>
      </footer>
    </PlayerDialog>
  )
}
