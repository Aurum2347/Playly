import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../../App'
import { useI18n } from '../../i18n'
import CoverMenu from '../CoverMenu'
import type { CoverMenuTarget } from '../CoverMenu'
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
    if (!ts) return <span className={styles.emptyValue}>—</span>
    return new Date(ts).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const orEmpty = (value: string | undefined) =>
    value || <span className={styles.emptyValue}>{t('views.details.notSpecified')}</span>

  const musicIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  )

  const copyIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )

  const folderIconSVG = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )

  const speed = displayTrack.playbackRate ?? 1

  return createPortal(
    <div className={`${styles.overlay} ${isClosing ? styles.closing : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget && isOpen) onClose() }}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.coverSection}>
            {displayTrack.cover ? (
              <img src={displayTrack.cover} alt="" className={styles.coverImage} onContextMenu={handleCoverContextMenu} />
            ) : (
              <div className={styles.coverPlaceholder}>{musicIconSVG}</div>
            )}
          </div>

          <div className={styles.infoSection}>
            <div className={styles.titleRow}>
              <span className={styles.titleText} title={displayTrack.title}>{displayTrack.title}</span>
              {onCopyTitle && (
                <span className={styles.tooltipWrapper}>
                  <button className={styles.copyBtn} onClick={() => onCopyTitle(displayTrack.id)}>
                    {copyIconSVG}
                  </button>
                  <span className={styles.tooltipText}>{t('views.details.copyTitle')}</span>
                </span>
              )}
            </div>
            <div className={styles.artistRow}>
              <span className={styles.artistText} title={displayTrack.artist}>{displayTrack.artist}</span>
              {onCopyArtist && (
                <span className={styles.tooltipWrapper}>
                  <button className={styles.copyBtn} onClick={() => onCopyArtist(displayTrack.id)}>
                    {copyIconSVG}
                  </button>
                  <span className={styles.tooltipText}>{t('views.details.copyArtist')}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.tabsContainer}>
          <div className={styles.tabsHeader}>
            <button className={`${styles.tabBtn} ${activeTab === 'file' ? styles.active : ''}`} onClick={() => setActiveTab('file')}>{t('views.details.tabFile')}</button>
            <button className={`${styles.tabBtn} ${activeTab === 'metadata' ? styles.active : ''}`} onClick={() => setActiveTab('metadata')}>{t('views.details.tabMetadata')}</button>
            <button className={`${styles.tabBtn} ${activeTab === 'stats' ? styles.active : ''}`} onClick={() => setActiveTab('stats')}>{t('views.details.tabStats')}</button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'file' && (
              <div className={styles.tabPane} key="file">
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.location')}</span>
                  <div className={styles.detailValue}>
                    <span className={styles.filePathText} title={displayTrack.filePath}>{displayTrack.filePath}</span>
                    {onCopyPath && (
                      <span className={styles.tooltipWrapper}>
                        <button className={styles.actionBtn} onClick={() => onCopyPath(displayTrack.id)}>
                          {copyIconSVG}
                        </button>
                        <span className={styles.tooltipText}>{t('views.details.copyPath')}</span>
                      </span>
                    )}
                    {onRevealInDir && (
                      <span className={styles.tooltipWrapper}>
                        <button className={styles.actionBtn} onClick={() => onRevealInDir(displayTrack.id)}>
                          {folderIconSVG}
                        </button>
                        <span className={styles.tooltipText}>{t('views.details.revealInDir')}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.duration')}</span>
                  <span className={styles.detailValue}>{displayTrack.duration}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.fileModified')}</span>
                  <span className={styles.detailValue}>{formatDate(displayTrack.fileModifiedAt)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.addedAt')}</span>
                  <span className={styles.detailValue}>{formatDate(displayTrack.addedAt)}</span>
                </div>
              </div>
            )}

            {activeTab === 'metadata' && (
              <div className={styles.tabPane} key="metadata">
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.title')}</span>
                  <span className={styles.detailValue}>{orEmpty(displayTrack.title)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.artist')}</span>
                  <span className={styles.detailValue}>{orEmpty(displayTrack.artist)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.album')}</span>
                  <span className={styles.detailValue}>{orEmpty(displayTrack.album)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.genre')}</span>
                  <span className={styles.detailValue}>{orEmpty(displayTrack.genre)}</span>
                </div>
              </div>
            )}

            {activeTab === 'stats' && (
              <div className={styles.tabPane} key="stats">
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.playbackSpeed')}</span>
                  <span className={styles.detailValue}>
                    <span className={styles.badge}>{String(Math.round(speed * 100) / 100)}×</span>
                  </span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.addedToLibrary')}</span>
                  <span className={styles.detailValue}>{formatDate(displayTrack.addedAt)}</span>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>{t('views.details.addedToLiked')}</span>
                  <span className={styles.detailValue}>
                    {displayTrack.liked && displayTrack.likedAt
                      ? formatDate(displayTrack.likedAt)
                      : <span className={styles.emptyValue}>{t('views.details.notLiked')}</span>}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <CoverMenu target={coverMenu} onClose={closeCoverMenu} />
    </div>,
    document.body
  )
}
