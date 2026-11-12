import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { lyricsUpdated, parseLyrics } from '../lib/lyrics'
import { notify, reportError } from '../lib/feedback'
import { positionOf } from '../lib/playbackClock'
import { useI18n } from '../i18n'
import PlayerDialog from './PlayerDialog'

/* Метка времени LRC: [мм:сс.сс] */
function stamp(seconds: number): string {
  const total = Math.max(0, seconds)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`
}

const LEADING_STAMP = /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/

/** Редактор текста песни: обычный текст или LRC, сохраняется в .lrc рядом с аудиофайлом */
export default function LyricsEditor({ path, onClose }: { path: string | null; onClose: () => void }) {
  const { t } = useI18n()
  const area = useRef<HTMLTextAreaElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  /* Пока окно закрывается, в заголовке остаётся прежнее имя файла */
  const [shownPath, setShownPath] = useState(path)
  if (path && path !== shownPath) setShownPath(path)

  const [text, setText] = useState('')
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [requestPath, setRequestPath] = useState(path)
  if (requestPath !== path) {
    setRequestPath(path)
    if (path) setLoadedPath(null)
  }

  useEffect(() => {
    if (!path) return
    let active = true
    invoke<string | null>('get_track_lyrics', { path })
      .then((raw) => {
        if (!active) return
        setText(raw ?? '')
        setLoadedPath(path)
      })
      .catch((error) => {
        if (!active) return
        reportError('lyricsRead', error)
        closeRef.current()
      })
    return () => {
      active = false
    }
  }, [path])

  /* Текущая позиция трека для кнопки «Метка»: обновляем, пока окно открыто и этот трек звучит */
  const [position, setPosition] = useState<number | null>(null)
  useEffect(() => {
    if (!path) return
    const tick = () => setPosition(positionOf(path))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [path])

  const ready = !!path && loadedPath === path
  const status = useMemo(() => {
    if (!text.trim()) return { kind: 'empty' as const, n: 0 }
    const parsed = parseLyrics(text)
    if (parsed?.synced) return { kind: 'synced' as const, n: parsed.lines.length }
    const looksSynced = text.split(/\r?\n/).some((line) => LEADING_STAMP.test(line))
    return { kind: looksSynced ? ('invalid' as const) : ('plain' as const), n: 0 }
  }, [text])

  /* Метка текущего момента — в начало строки с курсором (прежняя метка заменяется),
     курсор переходит на следующую строку: так удобно размечать песню по ходу */
  const insertStamp = () => {
    const el = area.current
    const now = path ? positionOf(path) : null
    if (!el || now === null) return
    const caret = el.selectionStart
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1
    const lineEndRaw = text.indexOf('\n', caret)
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw
    const tag = stamp(now)
    const line = text.slice(lineStart, lineEnd).replace(LEADING_STAMP, '').trimStart()
    const next = text.slice(0, lineStart) + tag + line + text.slice(lineEnd)
    setText(next)
    const after = lineStart + tag.length + line.length
    requestAnimationFrame(() => {
      el.focus()
      const nextLine = next.indexOf('\n', after)
      const pos = nextLine < 0 ? next.length : nextLine + 1
      el.setSelectionRange(pos, pos)
    })
  }

  const save = async () => {
    if (!path || !ready || busy || status.kind === 'invalid') return
    setBusy(true)
    try {
      await invoke('save_track_lyrics', { path, text })
      lyricsUpdated(path)
      notify('lyricsSaved')
      onClose()
    } catch (error) {
      reportError('lyricsSave', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlayerDialog open={!!path} title={t('lyricsEditor.title')} subtitle={shownPath?.split(/[\\/]/).pop()} onClose={onClose} busy={busy} wide>
      <p className="lyrics-editor-hint">{t('lyricsEditor.hint')}</p>
      <label className="lyrics-editor-field">
        <span className="sr-only">{t('lyricsEditor.field')}</span>
        <textarea
          ref={area}
          data-initial-focus
          value={ready ? text : ''}
          disabled={busy || !ready}
          placeholder={t('lyricsEditor.placeholder')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              void save()
            }
          }}
          spellCheck={false}
        />
      </label>
      <div className="lyrics-editor-bar">
        <span className={`lyrics-editor-status ${status.kind}`} role="status">
          <span className="lyrics-editor-dot" aria-hidden="true" />
          {status.kind === 'synced' ? t('lyricsEditor.synced', { n: status.n, count: status.n }) : t(`lyricsEditor.${status.kind}`)}
        </span>
        {position !== null && (
          <button type="button" className="btn lyrics-stamp" disabled={!ready || busy} title={t('lyricsEditor.stampHint')} onClick={insertStamp}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M10 2h4" /></svg>
            {t('lyricsEditor.stamp', { time: stamp(position).slice(1, -1) })}
          </button>
        )}
      </div>
      <footer className="frame-modal-actions">
        <span className="lyrics-editor-note">{t('lyricsEditor.savedAs')}</span>
        <button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !ready || status.kind === 'invalid'} onClick={() => void save()}>
          {busy ? t('lyricsEditor.saving') : t('common.save')}
        </button>
      </footer>
    </PlayerDialog>
  )
}
