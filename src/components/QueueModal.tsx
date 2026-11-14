import { useMemo } from 'react'
import type { RepeatMode, Track } from '../App'
import { useI18n } from '../i18n'
import PlayerDialog from './PlayerDialog'
import SafeImage from './SafeImage'
import './QueueModal.css'

/** Элемент ручной очереди: uid отличает два добавления одного и того же трека */
export interface QueueItem {
  uid: number
  trackId: number
}

interface QueueModalProps {
  open: boolean
  onClose: () => void
  tracks: Track[]
  current: Track | null
  userQueue: QueueItem[]
  queue: number[]
  queueIndex: number
  shuffle: boolean
  repeat: RepeatMode
  onRemove: (uid: number) => void
  onClear: () => void
  onPlayQueued: (uid: number) => void
  onMove: (uid: number, dir: -1 | 1) => void
  onPlaySystem: (index: number) => void
}

/* Длинную системную очередь целиком не рисуем */
const SYSTEM_LIMIT = 150

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
)

function Row({ track, children, onPlay, dim = false }: { track: Track; children?: React.ReactNode; onPlay?: () => void; dim?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={`q-row ${dim ? 'dim' : ''}`} onDoubleClick={onPlay}>
      <div className="q-cover">{track.cover ? <SafeImage src={track.cover} alt="" loading="lazy" /> : <MusicIcon />}</div>
      <div className="q-text">
        <div className="q-title">{track.title}</div>
        <div className="q-artist">{track.artist || t('views.nowPlaying.unknownArtist')}</div>
      </div>
      <span className="q-dur">{track.duration}</span>
      <div className="q-actions">{children}</div>
    </div>
  )
}

/**
 * Две очереди: ручная (её собирает пользователь, она важнее) и системная — следующие треки
 * текущего списка; она меняется сама и показана приглушённо.
 */
export default function QueueModal(props: QueueModalProps) {
  const { open, onClose, tracks, current, userQueue, queue, queueIndex, shuffle, repeat } = props
  const { t } = useI18n()
  const byId = useMemo(() => new Map(tracks.map((tr) => [tr.id, tr])), [tracks])

  /* Что сыграет дальше по системной очереди: позиции в queue */
  const system = useMemo(() => {
    if (!open || queue.length === 0) return [] as number[]
    const out: number[] = []
    if (shuffle) {
      for (let i = 0; i < queue.length && out.length < SYSTEM_LIMIT; i++) if (i !== queueIndex) out.push(i)
      return out
    }
    for (let i = queueIndex + 1; i < queue.length && out.length < SYSTEM_LIMIT; i++) out.push(i)
    if (repeat === 'all') for (let i = 0; i < queueIndex && out.length < SYSTEM_LIMIT; i++) out.push(i)
    return out
  }, [open, queue, queueIndex, shuffle, repeat])

  const userItems = userQueue.filter((it) => byId.has(it.trackId))
  const ahead = Math.max(0, queue.length - queueIndex - 1)
  const wrapped = repeat === 'all' ? Math.max(0, queueIndex) : 0
  const systemTotal = shuffle ? Math.max(0, queue.length - 1) : ahead + wrapped

  return (
    <PlayerDialog open={open} title={t('queue.title')} onClose={onClose} wide>
      <div className="q-body">
        {current && (
          <section className="q-section">
            <div className="q-head"><span>{t('queue.now')}</span></div>
            <Row track={current} />
          </section>
        )}

        <section className="q-section">
          <div className="q-head">
            <span>{t('queue.manual')} {userItems.length > 0 && <span className="q-count">{userItems.length}</span>}</span>
            {userItems.length > 0 && (
              <button type="button" className="btn btn-ghost q-clear" onClick={props.onClear}>{t('queue.clear')}</button>
            )}
          </div>
          {userItems.length === 0 ? (
            <div className="q-empty">{t('queue.manualEmpty')}</div>
          ) : (
            userItems.map((it, i) => (
              <Row key={it.uid} track={byId.get(it.trackId)!} onPlay={() => props.onPlayQueued(it.uid)}>
                <button type="button" className="q-icon" title={t('queue.playNow')} onClick={() => props.onPlayQueued(it.uid)}>
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>
                </button>
                <button type="button" className="q-icon" title={t('queue.up')} disabled={i === 0} onClick={() => props.onMove(it.uid, -1)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <button type="button" className="q-icon" title={t('queue.down')} disabled={i === userItems.length - 1} onClick={() => props.onMove(it.uid, 1)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <button type="button" className="q-icon danger" title={t('queue.remove')} onClick={() => props.onRemove(it.uid)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </Row>
            ))
          )}
        </section>

        <section className="q-section q-system">
          <div className="q-head">
            <span>{t('queue.system')} {systemTotal > 0 && <span className="q-count">{systemTotal}</span>}</span>
          </div>
          <div className="q-hint">{shuffle ? t('queue.systemShuffle') : t('queue.systemHint')}</div>
          {system.length === 0 ? (
            <div className="q-empty">{t('queue.systemEmpty')}</div>
          ) : (
            system.map((idx) => {
              const tr = byId.get(queue[idx])
              if (!tr) return null
              return (
                <Row key={`${idx}-${tr.id}`} track={tr} dim onPlay={() => props.onPlaySystem(idx)}>
                  <button type="button" className="q-icon" title={t('queue.playNow')} onClick={() => props.onPlaySystem(idx)}>
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>
                  </button>
                </Row>
              )
            })
          )}
          {systemTotal > system.length && <div className="q-more">{t('queue.more', { n: systemTotal - system.length })}</div>}
        </section>
      </div>
    </PlayerDialog>
  )
}
