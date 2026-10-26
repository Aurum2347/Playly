import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../App'
import { useI18n } from '../i18n'
import { frameStyle, type ImageFrame } from '../lib/imageFrame'
import type { AvatarShape, ProfileLook } from '../lib/profile'
import {
  daysSince,
  listeningStreak,
  periodTotals,
  secondsOnDay,
  STATS_PERIODS,
  useListeningStats,
  type StatsPeriod,
} from '../lib/listeningStats'
import { usePresence } from './views/shared'
import { ProfileBanner } from './ProfileLook'
import SessionClock from './SessionClock'
import DefaultAvatar from './DefaultAvatar'
import './ProfileModal.css'

const TOP_LIMIT = 5

interface ProfileModalProps {
  open: boolean
  onClose: () => void
  nickname: string
  avatarUrl: string | null
  avatarShape: AvatarShape
  avatarFrame: ImageFrame
  bannerLook: ProfileLook | null
  tracks: Track[]
  playlistsCount: number
  onEditProfile: () => void
  onPlayTrack: (track: Track, context: Track[]) => void
}

/* Встроенные языки знаем точно, для своих переводов берём язык системы */
const localeFor = (lang: string) => (lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-US' : navigator.language || 'en-US')

const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
)

/** Окно профиля: баннер, аватарка, сессия и статистика прослушиваний */
export default function ProfileModal(props: ProfileModalProps) {
  const { open, onClose } = props
  const presence = usePresence(open, 240)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  /* Содержимое (и подписка на статистику, которая меняется каждую секунду) живёт, только пока окно открыто */
  if (!presence.mounted) return null
  return <ProfileModalContent {...props} closing={presence.closing} />
}

function ProfileModalContent({
  closing,
  onClose,
  nickname,
  avatarUrl,
  avatarShape,
  avatarFrame,
  bannerLook,
  tracks,
  playlistsCount,
  onEditProfile,
  onPlayTrack,
}: ProfileModalProps & { closing: boolean }) {
  const { t, lang } = useI18n()
  const [stats, revision] = useListeningStats()
  const [period, setPeriod] = useState<StatsPeriod>('week')

  const byId = useMemo(() => new Map(tracks.map((tr) => [tr.id, tr])), [tracks])

  /* Удалённые из библиотеки треки в топ не попадают */
  const totals = useMemo(
    () => (stats ? periodTotals(stats, period).filter((x) => byId.has(x.trackId)) : []),
    // revision — признак того, что статистика (изменяемая на месте) обновилась
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, revision, period, byId]
  )
  const top = totals.slice(0, TOP_LIMIT)

  const topArtist = useMemo(() => {
    const sums = new Map<string, number>()
    for (const x of totals) {
      const artist = byId.get(x.trackId)?.artist?.trim()
      if (artist) sums.set(artist, (sums.get(artist) ?? 0) + x.seconds)
    }
    let best: string | null = null
    let bestSec = 0
    sums.forEach((sec, artist) => {
      if (sec > bestSec) {
        best = artist
        bestSec = sec
      }
    })
    return best as string | null
  }, [totals, byId])

  const formatTime = (sec: number) => {
    const s = Math.floor(sec)
    if (s >= 3600) return t('profile.timeH', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
    if (s >= 60) return t('profile.timeM', { m: Math.floor(s / 60) })
    return t('profile.timeS', { s })
  }

  const locale = localeFor(lang)
  const firstSeen = stats?.firstSeen ?? null
  const daysTogether = firstSeen === null ? 0 : daysSince(firstSeen)
  const isNew = !!stats && !stats.restored && daysTogether < 7
  const streak = stats ? listeningStreak(stats) : 0
  const likedCount = tracks.filter((tr) => tr.liked).length
  const topTracks = top.map((x) => byId.get(x.trackId) as Track)

  return createPortal(
    <div
      className={`pm-overlay ${closing ? 'closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pm-modal" role="dialog" aria-modal="true" aria-label={t('profile.title')}>
        <ProfileBanner look={bannerLook} avatarUrl={avatarUrl} seed={nickname} className="pm-banner">
          <button className="pm-close" onClick={onClose} title={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </ProfileBanner>

        <div className="pm-body">
          {/* ===== Левая колонка: кто это ===== */}
          <aside className="pm-side">
            <div className="pm-head">
              <div className={`pm-avatar ${avatarShape}`}>
                <div className="pm-avatar-img">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" draggable={false} style={frameStyle(avatarFrame)} />
                  ) : (
                    <DefaultAvatar seed={nickname} />
                  )}
                </div>
                <span className="pm-status" title={t('profile.online')} />
              </div>
            </div>

            <div className="pm-card pm-identity">
              <div className="pm-name-row">
                <h2 className="pm-name">{nickname}</h2>
                {isNew && (
                  <span className="pm-badge">
                    <Icon.sparkles />
                    {t('profile.newBadge')}
                  </span>
                )}
              </div>
              <div className="pm-presence">
                <span className="pm-presence-dot" />
                {t('profile.online')}
              </div>
              <div className="pm-session">
                <span className="pm-session-label">
                  <Icon.clock />
                  {t('profile.session')}
                </span>
                <SessionClock className="pm-clock" />
              </div>

              <div className="pm-divider" />

              <div className="pm-label">
                <Icon.calendar />
                {t('profile.memberSince')}
              </div>
              <div className="pm-since-date">
                {firstSeen === null
                  ? '—'
                  : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(firstSeen)}
              </div>
              <div className="pm-since-days">
                {daysTogether > 0 ? t('profile.daysWith', { n: daysTogether }) : t('profile.firstDay')}
              </div>
              {stats && <div className="pm-hint">{stats.restored ? t('profile.restoredHint') : t('profile.newHint')}</div>}

              <button className="btn pm-edit" onClick={onEditProfile}>
                <Icon.pencil />
                {t('profile.editProfile')}
              </button>
            </div>
          </aside>

          {/* ===== Правая колонка: статистика ===== */}
          <section className="pm-main">
            <div className="pm-tiles">
              <div className="pm-tile accent">
                <span className="pm-tile-icon"><Icon.headphones /></span>
                <span className="pm-tile-label">{t('profile.totalListened')}</span>
                <span className="pm-tile-value">{formatTime(stats?.totalSeconds ?? 0)}</span>
                <span className="pm-tile-meta">{t('profile.totalPlays', { n: stats?.totalPlays ?? 0 })}</span>
              </div>
              <div className="pm-tile">
                <span className="pm-tile-icon sun"><Icon.sun /></span>
                <span className="pm-tile-label">{t('profile.today')}</span>
                <span className="pm-tile-value">{formatTime(stats ? secondsOnDay(stats) : 0)}</span>
              </div>
              <div className="pm-tile">
                <span className={`pm-tile-icon flame ${streak > 0 ? 'lit' : ''}`}><Icon.flame /></span>
                <span className="pm-tile-label">{t('profile.streak')}</span>
                <span className="pm-tile-value">{streak > 0 ? t('profile.streakDays', { n: streak }) : '—'}</span>
                {streak === 0 && <span className="pm-tile-meta">{t('profile.streakNone')}</span>}
              </div>
              <div className="pm-tile">
                <span className="pm-tile-icon disc"><Icon.disc /></span>
                <span className="pm-tile-label">{t('profile.library')}</span>
                <span className="pm-tile-value">{t('profile.libraryValue', { n: tracks.length })}</span>
                <span className="pm-tile-meta">{t('profile.libraryMeta', { liked: likedCount, playlists: playlistsCount })}</span>
              </div>
            </div>

            <div className="pm-card pm-top">
              <div className="pm-top-head">
                <div className="pm-top-title">
                  <span className="pm-section-icon"><Icon.chart /></span>
                  <span>
                    <span className="pm-section-title">{t('profile.topTracks')}</span>
                    <span className="pm-hint">{t(`profile.periodHint_${period}`)}</span>
                  </span>
                </div>
                <div className="segmented pm-periods">
                  {STATS_PERIODS.map((p) => (
                    <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>
                      {t(`profile.period_${p}`)}
                    </button>
                  ))}
                </div>
              </div>

              {topArtist && (
                <div className="pm-artist" key={`${period}-${topArtist}`}>
                  <span className="pm-artist-icon"><Icon.mic /></span>
                  <span className="pm-artist-text">
                    <span className="pm-label">{t('profile.topArtist')}</span>
                    <span className="pm-artist-name">{topArtist}</span>
                  </span>
                </div>
              )}

              {top.length === 0 ? (
                <div className="pm-empty">
                  <MusicIcon />
                  <span>{t('profile.emptyTop')}</span>
                </div>
              ) : (
                <ol key={period} className="pm-top-list">
                  {top.map((x, i) => {
                    const tr = byId.get(x.trackId) as Track
                    return (
                      <li key={x.trackId} style={{ '--i': i } as CSSProperties}>
                        <button className="pm-track" onClick={() => onPlayTrack(tr, topTracks)} title={tr.title}>
                          <span className={`pm-rank ${i === 0 ? 'first' : ''}`}>{i === 0 ? <Icon.crown /> : i + 1}</span>
                          <span className="pm-cover">
                            {tr.cover ? <img src={tr.cover} alt="" draggable={false} /> : <MusicIcon />}
                            <span className="pm-cover-play">
                              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                            </span>
                          </span>
                          <span className="pm-track-text">
                            <span className="pm-track-title">{tr.title}</span>
                            <span className="pm-track-artist">{tr.artist || t('profile.unknownArtist')}</span>
                          </span>
                          <span className="pm-track-stats">
                            {x.plays > 0 && <span className="pm-track-plays">{t('profile.plays', { n: x.plays })}</span>}
                            <span className="pm-track-time">{formatTime(x.seconds)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ===== Иконки окна профиля ===== */
const svg = (children: ReactNode) => () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const Icon = {
  clock: svg(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>),
  calendar: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  pencil: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></>),
  sparkles: svg(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>),
  headphones: svg(<><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></>),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>),
  flame: svg(<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />),
  disc: svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3a9 9 0 0 1 9 9" opacity="0.5" /></>),
  chart: svg(<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>),
  mic: svg(<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></>),
  crown: svg(<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />),
}
