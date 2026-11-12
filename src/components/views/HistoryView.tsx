import { useMemo, useState } from 'react'
import type { Track } from '../../App'
import { clearPlayEvents, usePlayEvents } from '../../lib/playHistory'
import { useI18n } from '../../i18n'
import SafeImage from '../SafeImage'
import PlayerDialog from '../PlayerDialog'
import { cx } from './shared'
import styles from './TracksView.module.css'
import './HistoryView.css'

const PAGE_SIZE = 100

interface HistoryViewProps {
  tracks: Track[]
  onSelectTrack: (track: Track, queue?: Track[]) => void
  playingTrackId: number | null
  isPlaying: boolean
  onPlayToggle: () => void
}

interface Entry {
  key: string
  track: Track
  playedAt: number
}

interface DayGroup {
  day: number
  label: string
  items: Entry[]
  seconds: number
}

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
)

const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7M3 3v6h6" /><path d="M12 7v5l3 2" /></svg>
)

/** «3:45» / «1:02:03» → секунды */
const durationSecs = (value: string) => {
  const parts = (value || '').split(':').map(Number)
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0
  return parts.reduce((sum, n) => sum * 60 + n, 0)
}

const startOfDay = (time: number) => {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** История прослушивания: каждое начало трека, по дням, новые сверху */
export default function HistoryView({ tracks, onSelectTrack, playingTrackId, isPlaying, onPlayToggle }: HistoryViewProps) {
  const { lang, t } = useI18n()
  const locale = lang === 'en' ? 'en' : 'ru'
  const events = usePlayEvents()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [confirmClear, setConfirmClear] = useState(false)
  /* «Сегодня» считаем от момента открытия страницы */
  const [now] = useState(() => Date.now())

  /* Удалённые из библиотеки треки в истории не показываем */
  const entries = useMemo<Entry[]>(() => {
    const byId = new Map(tracks.map((track) => [track.id, track]))
    const q = query.trim().toLocaleLowerCase()
    const list: Entry[] = []
    for (const e of events) {
      const track = byId.get(e.trackId)
      if (!track) continue
      if (q && !`${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(q)) continue
      list.push({ key: `${e.playedAt}-${e.trackId}`, track, playedAt: e.playedAt })
    }
    return list
  }, [events, tracks, query])

  /* Очередь при запуске из истории: треки в порядке истории, без повторов */
  const queue = useMemo(() => {
    const seen = new Set<number>()
    return entries.flatMap((e) => (seen.has(e.track.id) ? [] : (seen.add(e.track.id), [e.track])))
  }, [entries])

  const stats = useMemo(() => {
    const today = startOfDay(now)
    let seconds = 0
    let todayCount = 0
    for (const e of entries) {
      seconds += durationSecs(e.track.duration)
      if (e.playedAt >= today) todayCount++
    }
    return { plays: entries.length, tracks: queue.length, seconds, today: todayCount }
  }, [entries, queue, now])

  const formatTime = (seconds: number) => {
    const total = Math.round(seconds / 60)
    const h = Math.floor(total / 60)
    return h > 0
      ? t('history.hours', { h: h.toLocaleString(locale), m: total % 60 })
      : t('history.minutes', { m: total })
  }

  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const offset = (current - 1) * PAGE_SIZE
  const visible = entries.slice(offset, offset + PAGE_SIZE)

  const groups = useMemo(() => {
    const today = startOfDay(now)
    const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', weekday: 'long' })
    const yearFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    const thisYear = new Date(now).getFullYear()
    const label = (day: number) => {
      if (day === today) return t('history.today')
      if (day === startOfDay(today - 12 * 3600_000)) return t('history.yesterday')
      return new Date(day).getFullYear() === thisYear ? dayFormat.format(day) : yearFormat.format(day)
    }
    const out: DayGroup[] = []
    for (const entry of visible) {
      const day = startOfDay(entry.playedAt)
      const secs = durationSecs(entry.track.duration)
      const last = out[out.length - 1]
      if (last && last.day === day) {
        last.items.push(entry)
        last.seconds += secs
      } else out.push({ day, label: label(day), items: [entry], seconds: secs })
    }
    return out
  }, [visible, locale, t, now])

  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])

  const play = (track: Track) => {
    if (playingTrackId === track.id) onPlayToggle()
    else onSelectTrack(track, queue)
  }

  const changePage = (next: number) => {
    setPage(next)
    document.querySelector('.history-list')?.scrollTo({ top: 0 })
  }

  /* «Сейчас играет» отмечаем только у самой свежей записи этого трека, а не у всех повторов */
  const currentKey = useMemo(
    () => (playingTrackId == null ? null : entries.find((e) => e.track.id === playingTrackId)?.key ?? null),
    [entries, playingTrackId]
  )

  let row = 0
  return (
    <section className={cx(styles.tracksView, 'listening-history')}>
      <header className="history-head">
        <div className="history-head-main">
          <span className="history-head-icon" aria-hidden="true"><HistoryIcon /></span>
          <div className="history-head-text">
            <h1 className={styles.pageTitle}>{t('history.title')}</h1>
            <p className="history-subtitle">{t('history.subtitle')}</p>
          </div>
        </div>
        {events.length > 0 && (
          <button className="btn history-clear" onClick={() => setConfirmClear(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
            {t('history.clear')}
          </button>
        )}
      </header>

      {events.length > 0 && (
        <div className="history-stats">
          <div className="history-stat">
            <span className="history-stat-label">{t('history.statPlays')}</span>
            <span className="history-stat-value">{stats.plays.toLocaleString(locale)}</span>
          </div>
          <div className="history-stat">
            <span className="history-stat-label">{t('history.statTracks')}</span>
            <span className="history-stat-value">{stats.tracks.toLocaleString(locale)}</span>
          </div>
          <div className="history-stat">
            <span className="history-stat-label">{t('history.statTime')}</span>
            <span className="history-stat-value">{formatTime(stats.seconds)}</span>
          </div>
          <div className="history-stat">
            <span className="history-stat-label">{t('history.statToday')}</span>
            <span className="history-stat-value">{stats.today.toLocaleString(locale)}</span>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m16 16 5 5" /></svg>
          <input
            className={styles.searchInput}
            type="search"
            aria-label={t('history.search')}
            placeholder={t('views.tracks.searchPlaceholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </div>
      )}

      <div key={`${query}-${current}`} className="history-list">
        {groups.map((group) => (
          <div key={group.day} className="history-day" role="group" aria-label={group.label}>
            <div className="history-day-head">
              <span className="history-day-label">{group.label}</span>
              <span className="history-day-meta">
                {t('history.plays', { n: group.items.length.toLocaleString(locale), count: group.items.length })}
                {group.seconds >= 60 && <> · {formatTime(group.seconds)}</>}
              </span>
            </div>
            <div className="history-day-rows">
              {group.items.map((entry) => {
                const isCurrent = entry.key === currentKey
                const sameTrack = playingTrackId === entry.track.id
                const delay = Math.min(row++, 10) * 18
                return (
                  <div
                    key={entry.key}
                    className={cx('history-row', isCurrent && 'is-current', isCurrent && isPlaying && 'is-playing')}
                    style={{ animationDelay: `${delay}ms` }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${entry.track.title}, ${entry.track.artist}`}
                    onClick={() => play(entry.track)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        play(entry.track)
                      }
                    }}
                  >
                    <time className="history-time" dateTime={new Date(entry.playedAt).toISOString()}>{timeFormat.format(entry.playedAt)}</time>
                    <span className="history-cover">
                      {entry.track.cover ? <SafeImage src={entry.track.cover} alt="" loading="lazy" decoding="async" /> : <MusicIcon />}
                      <span className="history-cover-play" aria-hidden="true">
                        {isCurrent && isPlaying ? (
                          <span className="history-bars"><i /><i /><i /></span>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor">{sameTrack && isPlaying ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path d="m8 5 12 7-12 7z" />}</svg>
                        )}
                      </span>
                    </span>
                    <span className="history-text">
                      <span className="history-title">{entry.track.title}</span>
                      <span className="history-artist">{entry.track.artist}</span>
                    </span>
                    <span className="history-album" title={entry.track.album || undefined}>{entry.track.album}</span>
                    <span className="history-dur">{entry.track.duration}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="history-empty">
            <span className="history-empty-icon" aria-hidden="true"><HistoryIcon /></span>
            <h2>{query ? t('history.notFoundTitle') : t('history.emptyTitle')}</h2>
            <p>{query ? t('history.notFoundText') : t('history.emptyText')}</p>
          </div>
        )}
      </div>

      {pages > 1 && (
        <nav className="history-pagination" aria-label={t('history.pages')}>
          <button className="btn" disabled={current === 1} onClick={() => changePage(current - 1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>
            {t('history.prev')}
          </button>
          <span className="history-page">{t('history.page', { n: current, total: pages })}</span>
          <button className="btn" disabled={current === pages} onClick={() => changePage(current + 1)}>
            {t('history.next')}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </nav>
      )}

      <PlayerDialog open={confirmClear} title={t('history.clearTitle')} onClose={() => setConfirmClear(false)}>
        <p className="player-dialog-copy">{t('history.clearText')}</p>
        <footer className="frame-modal-actions">
          <button className="btn" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button>
          <button
            data-initial-focus
            className="btn btn-danger"
            onClick={() => {
              setConfirmClear(false)
              setPage(1)
              void clearPlayEvents()
            }}
          >
            {t('history.clearConfirm')}
          </button>
        </footer>
      </PlayerDialog>
    </section>
  )
}
