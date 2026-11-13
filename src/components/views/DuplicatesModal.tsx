import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import PlayerDialog from '../PlayerDialog'
import { findDuplicates, type DuplicateGroup } from '../../lib/libraryMatch'
import './DuplicatesModal.css'

interface DuplicatesModalProps {
  open: boolean
  onClose: () => void
  tracks: Track[]
  /* Убрать записи из библиотеки (файлы остаются на диске) */
  onDeleteTracks?: (ids: number[]) => void
  /* Удалить сами файлы с диска (и записи из библиотеки) */
  onRemoveFiles?: (ids: number[]) => Promise<number[]>
}

interface FileStatus {
  exists: boolean
  size: number
  readable: boolean
}

type Scan = { state: 'idle' | 'scanning' } | { state: 'done'; groups: DuplicateGroup[] }

/**
 * Поиск повторов: точные копии файлов (одинаковое содержимое) и вероятные совпадения
 * по названию, исполнителю и длительности. Ничего не удаляется без выбора пользователя.
 */
async function scanDuplicates(tracks: Track[]): Promise<DuplicateGroup[]> {
  const statuses = await invoke<FileStatus[]>('file_status', { paths: tracks.map((t) => t.filePath) }).catch(() => [] as FileStatus[])
  /* Хешируем только файлы, у которых есть пара того же размера, — остальные точно не копии */
  const bySize = new Map<number, Track[]>()
  tracks.forEach((t, i) => {
    const size = statuses[i]?.exists ? statuses[i].size : 0
    if (size > 0) bySize.set(size, [...(bySize.get(size) ?? []), t])
  })
  const candidates = [...bySize.values()].filter((g) => g.length > 1).flat()
  const hashes = new Map<number, string>()
  if (candidates.length > 0) {
    const out = await invoke<Array<string | null>>('hash_files', { paths: candidates.map((t) => t.filePath) }).catch(() => [])
    candidates.forEach((t, i) => {
      if (out[i]) hashes.set(t.id, out[i] as string)
    })
  }
  return findDuplicates(tracks, hashes)
}

export default function DuplicatesModal({ open, onClose, tracks, onDeleteTracks, onRemoveFiles }: DuplicatesModalProps) {
  const { t } = useI18n()
  const [scan, setScan] = useState<Scan>({ state: 'idle' })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  /* Список треков на момент открытия: пока окно открыто, удалённые просто исчезают из групп */
  useEffect(() => {
    if (!open) return
    let alive = true
    /* Каждое открытие окна — новый поиск: сброс здесь и есть синхронизация с open */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScan({ state: 'scanning' })
    setSelected(new Set())
    void scanDuplicates(tracks).then((groups) => {
      if (alive) setScan({ state: 'done', groups })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const byId = useMemo(() => new Map(tracks.map((tr) => [tr.id, tr])), [tracks])
  const groups = useMemo(() => {
    if (scan.state !== 'done') return []
    return scan.groups
      .map((g) => ({ ...g, ids: g.ids.filter((id) => byId.has(id)) }))
      .filter((g) => g.ids.length > 1)
  }, [scan, byId])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /* Быстрый выбор: в каждой группе оставить первый (самый ранний по добавлению) трек */
  const selectExtras = () => {
    const next = new Set<number>()
    for (const g of groups) {
      const sorted = [...g.ids].sort((a, b) => (byId.get(a)?.addedAt ?? 0) - (byId.get(b)?.addedAt ?? 0))
      sorted.slice(1).forEach((id) => next.add(id))
    }
    setSelected(next)
  }

  const chosen = [...selected].filter((id) => byId.has(id))

  const removeFromLibrary = () => {
    if (chosen.length === 0 || !onDeleteTracks) return
    if (!window.confirm(t('duplicates.confirmLibrary', { n: chosen.length }))) return
    onDeleteTracks(chosen)
    setSelected(new Set())
  }

  const removeFiles = async () => {
    if (chosen.length === 0 || !onRemoveFiles) return
    if (!window.confirm(t('duplicates.confirmDisk', { n: chosen.length }))) return
    setBusy(true)
    try {
      await onRemoveFiles(chosen)
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  const exactCount = groups.filter((g) => g.kind === 'exact').length

  return (
    <PlayerDialog open={open} title={t('duplicates.title')} subtitle={t('duplicates.subtitle')} onClose={onClose} busy={busy} wide>
      <div className="dup-body">
        {scan.state !== 'done' ? (
          <div className="dup-empty">
            <span className="dup-spinner" aria-hidden="true" />
            {t('duplicates.scanning')}
          </div>
        ) : groups.length === 0 ? (
          <div className="dup-empty">{t('duplicates.none')}</div>
        ) : (
          <>
            <div className="dup-summary">
              {t('duplicates.summary', { groups: groups.length, exact: exactCount, similar: groups.length - exactCount })}
              <button type="button" className="btn btn-ghost dup-auto" onClick={selectExtras} disabled={busy}>
                {t('duplicates.selectExtras')}
              </button>
            </div>
            <div className="dup-groups">
              {groups.map((g) => (
                <section key={`${g.kind}-${g.ids.join('-')}`} className={`dup-group ${g.kind}`}>
                  <div className="dup-kind">
                    {g.kind === 'exact' ? t('duplicates.exact') : t('duplicates.similar')}
                  </div>
                  {g.ids.map((id) => {
                    const tr = byId.get(id)!
                    return (
                      <label key={id} className={`dup-item ${selected.has(id) ? 'checked' : ''}`}>
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} disabled={busy} />
                        <span className="dup-text">
                          <span className="dup-title">{tr.title} <span className="dup-artist">- {tr.artist}</span></span>
                          <span className="dup-path" title={tr.filePath}>{tr.filePath}</span>
                        </span>
                        <span className="dup-dur">{tr.duration}</span>
                      </label>
                    )
                  })}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
      <footer className="frame-modal-actions">
        <span className="dup-note">{t('duplicates.note')}</span>
        <button className="btn" disabled={busy} onClick={onClose}>{t('common.close')}</button>
        {onDeleteTracks && (
          <button className="btn" disabled={busy || chosen.length === 0} onClick={removeFromLibrary}>
            {t('duplicates.removeLibrary', { n: chosen.length })}
          </button>
        )}
        {onRemoveFiles && (
          <button className="btn btn-danger" disabled={busy || chosen.length === 0} onClick={() => void removeFiles()}>
            {t('duplicates.removeDisk', { n: chosen.length })}
          </button>
        )}
      </footer>
    </PlayerDialog>
  )
}
