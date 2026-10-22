import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import CoverMenu from '../CoverMenu'
import type { CoverMenuTarget } from '../CoverMenu'
import { useCoverColor } from '../../lib/coverColor'
import styles from './TrackDetailsModal.module.css'

interface TrackDetailsModalProps {
  track: Track | null
  onClose: () => void
  onCopyTitle?: (trackId: number) => void
  onCopyArtist?: (trackId: number) => void
  onCopyPath?: (trackId: number) => void
  onRevealInDir?: (trackId: number) => void
}

type Tab = 'file' | 'metadata' | 'stats'

const TABS: Tab[] = ['file', 'metadata', 'stats']
const CLOSE_ANIMATION_MS = 250

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/* ===== Иконки ===== */
const icons = {
  music: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>
  ),
  speed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>
  ),
  disc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></svg>
  ),
}

/* Кнопка копирования: после клика на секунду показывает галочку */
function CopyButton({ onCopy, label, className }: { onCopy: () => void; label: string; className?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <button
      className={`${styles.iconBtn} ${done ? styles.done : ''} ${className ?? ''}`}
      onClick={() => {
        onCopy()
        setDone(true)
      }}
      title={label}
      aria-label={label}
    >
      {done ? icons.check : icons.copy}
    </button>
  )
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`${styles.field} ${wide ? styles.wide : ''}`}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{children}</div>
    </div>
  )
}

export default function TrackDetailsModal({
  track,
  onClose,
  onCopyTitle,
  onCopyArtist,
  onCopyPath,
  onRevealInDir,
}: TrackDetailsModalProps) {
  const { t, lang } = useI18n()
  const [activeTab, setActiveTab] = useState<Tab>('file')
  const [coverMenu, setCoverMenu] = useState<CoverMenuTarget | null>(null)
  const isCoverMenuOpen = coverMenu !== null
  const closeCoverMenu = useCallback(() => setCoverMenu(null), [])

  /*
   * displayTrack — последний показанный трек. Он остаётся на экране, пока
   * проигрывается анимация закрытия (когда родитель уже передал track = null).
   */
  const [displayTrack, setDisplayTrack] = useState<Track | null>(track)
  const [prevTrack, setPrevTrack] = useState<Track | null>(track)
  if (track !== prevTrack) {
    setPrevTrack(track)
    if (track) {
      if (track.id !== displayTrack?.id) setActiveTab('file')
      setDisplayTrack(track)
    } else {
      setCoverMenu(null)
    }
  }

  const isOpen = track !== null
  const isClosing = !isOpen && displayTrack !== null
  const tint = useCoverColor(displayTrack?.cover)

  useEffect(() => {
    if (!isClosing) return
    const timer = setTimeout(() => setDisplayTrack(null), CLOSE_ANIMATION_MS)
    return () => clearTimeout(timer)
  }, [isClosing])

  const handleCoverContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!displayTrack?.cover) return
    setCoverMenu({ x: e.clientX, y: e.clientY, cover: displayTrack.cover, name: `${displayTrack.artist} - ${displayTrack.title}` })
  }, [displayTrack])

  /* Горячие клавиши — только пока модалка открыта. Слушаем в capture-фазе на window,
     чтобы Escape не долетал до обработчиков списка (выход из режима выделения и т.п.) */
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isCoverMenuOpen) setCoverMenu(null)
        else onClose()
        return
      }
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      const idx = ['1', '2', '3'].indexOf(e.key)
      if (idx !== -1) {
        setActiveTab(TABS[idx])
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        setActiveTab((prev) => TABS[(TABS.indexOf(prev) + dir + TABS.length) % TABS.length])
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, isCoverMenuOpen, onClose])

  if (!displayTrack) return null

  const formatDate = (ts?: number) => {
    if (!ts) return <span className={styles.empty}>—</span>
    return new Date(ts).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const orEmpty = (value: string | undefined) =>
    value || <span className={styles.empty}>{t('views.details.notSpecified')}</span>

  const speed = displayTrack.playbackRate ?? 1
  const ext = displayTrack.filePath.split('.').pop()?.toUpperCase() ?? ''
  const fileName = displayTrack.filePath.split(/[\\/]/).pop() ?? displayTrack.filePath
  const folder = displayTrack.filePath.slice(0, displayTrack.filePath.length - fileName.length)
  const tabLabel: Record<Tab, string> = {
    file: t('views.details.tabFile'),
    metadata: t('views.details.tabMetadata'),
    stats: t('views.details.tabStats'),
  }

  return createPortal(
    <div
      className={`${styles.overlay} ${isClosing ? styles.closing : ''}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && isOpen) onClose() }}
    >
      <div
        className={styles.modal}
        style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* ===== Шапка ===== */}
        <header className={styles.header}>
          <div className={styles.backdrop} aria-hidden="true">
            {displayTrack.cover && <img src={displayTrack.cover} alt="" />}
          </div>

          <button className={styles.closeBtn} onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
            {icons.close}
          </button>

          <div className={styles.cover} onContextMenu={handleCoverContextMenu}>
            {displayTrack.cover ? <img src={displayTrack.cover} alt="" /> : icons.music}
          </div>

          <div className={styles.headInfo}>
            <div className={styles.kicker}>{ext || t('views.details.tabFile')}</div>
            <div className={styles.titleRow}>
              <h2 className={styles.title} title={displayTrack.title}>{displayTrack.title}</h2>
              {onCopyTitle && (
                <CopyButton onCopy={() => onCopyTitle(displayTrack.id)} label={t('views.details.copyTitle')} />
              )}
            </div>
            <div className={styles.titleRow}>
              <span className={styles.artist} title={displayTrack.artist}>{displayTrack.artist}</span>
              {onCopyArtist && (
                <CopyButton onCopy={() => onCopyArtist(displayTrack.id)} label={t('views.details.copyArtist')} />
              )}
            </div>
            <div className={styles.chips}>
              <span className={styles.chip}>{icons.clock}{displayTrack.duration}</span>
              {speed !== 1 && <span className={styles.chip}>{icons.speed}{String(Math.round(speed * 100) / 100)}×</span>}
              {displayTrack.album && <span className={styles.chip} title={displayTrack.album}>{icons.disc}<span className={styles.chipText}>{displayTrack.album}</span></span>}
              {displayTrack.liked && <span className={`${styles.chip} ${styles.liked}`}>{icons.heart}{t('views.details.likedChip')}</span>}
            </div>
          </div>
        </header>

        {/* ===== Вкладки ===== */}
        <div className={styles.tabs} role="tablist" style={{ '--tab-index': TABS.indexOf(activeTab) } as CSSProperties}>
          <span className={styles.tabIndicator} aria-hidden="true" />
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabLabel[tab]}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {activeTab === 'file' && (
            <div className={styles.pane} key="file">
              <div className={styles.pathCard}>
                <div className={styles.pathIcon}>{icons.folder}</div>
                <div className={styles.pathText}>
                  <div className={styles.pathName} title={fileName}>{fileName}</div>
                  <div className={styles.pathDir} title={displayTrack.filePath}>{folder}</div>
                </div>
                <div className={styles.pathActions}>
                  {onCopyPath && (
                    <CopyButton onCopy={() => onCopyPath(displayTrack.id)} label={t('views.details.copyPath')} />
                  )}
                  {onRevealInDir && (
                    <button
                      className={styles.iconBtn}
                      onClick={() => onRevealInDir(displayTrack.id)}
                      title={t('views.details.revealInDir')}
                      aria-label={t('views.details.revealInDir')}
                    >
                      {icons.folder}
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.grid}>
                <Field label={t('views.details.duration')}>{displayTrack.duration}</Field>
                <Field label={t('views.details.format')}>{ext || '—'}</Field>
                <Field label={t('views.details.fileModified')}>{formatDate(displayTrack.fileModifiedAt)}</Field>
                <Field label={t('views.details.addedAt')}>{formatDate(displayTrack.addedAt)}</Field>
              </div>
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className={styles.pane} key="metadata">
              <div className={styles.grid}>
                <Field label={t('views.details.title')} wide>{orEmpty(displayTrack.title)}</Field>
                <Field label={t('views.details.artist')}>{orEmpty(displayTrack.artist)}</Field>
                <Field label={t('views.details.album')}>{orEmpty(displayTrack.album)}</Field>
                <Field label={t('views.details.genre')}>{orEmpty(displayTrack.genre)}</Field>
                <Field label={t('views.details.duration')}>{displayTrack.duration}</Field>
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className={styles.pane} key="stats">
              <div className={styles.grid}>
                <Field label={t('views.details.playbackSpeed')}>
                  <span className={styles.badge}>{String(Math.round(speed * 100) / 100)}×</span>
                </Field>
                <Field label={t('views.details.addedToLiked')}>
                  {displayTrack.liked && displayTrack.likedAt
                    ? formatDate(displayTrack.likedAt)
                    : <span className={styles.empty}>{t('views.details.notLiked')}</span>}
                </Field>
                <Field label={t('views.details.addedToLibrary')} wide>{formatDate(displayTrack.addedAt)}</Field>
              </div>
            </div>
          )}
        </div>
      </div>

      <CoverMenu target={coverMenu} onClose={closeCoverMenu} />
    </div>,
    document.body
  )
}
