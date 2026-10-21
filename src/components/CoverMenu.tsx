import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { useI18n } from '../i18n'
import { computeMenuPosition, usePresence } from './views/shared'
import './CoverMenu.css'

export interface CoverMenuTarget {
  x: number
  y: number
  cover: string
  /* Имя файла по умолчанию (без расширения) */
  name: string
}

interface CoverMenuProps {
  target: CoverMenuTarget | null
  onClose: () => void
}

/* Примерный размер меню — нужен только чтобы не вылезти за окно */
const MENU_W = 240
const MENU_H = 96

const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'cover'

export default function CoverMenu({ target, onClose }: CoverMenuProps) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const { mounted, closing } = usePresence(target !== null)
  /* Последняя цель остаётся на экране, пока проигрывается анимация закрытия */
  const [shown, setShown] = useState(target)
  if (target && target !== shown) setShown(target)

  useEffect(() => {
    if (!target) return
    /* Capture-фаза: модалки гасят всплытие mousedown, и без неё меню не закрывалось */
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onBlur = () => onClose()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [target, onClose])

  if (!mounted || !shown) return null

  const pos = computeMenuPosition(shown.x, shown.y, MENU_W, MENU_H)

  const handleCopy = async () => {
    const cover = shown.cover
    onClose()
    try {
      const blob = await (await fetch(cover)).blob()
      /* Буфер обмена надёжно принимает только PNG — остальные форматы перекодируем */
      const png = blob.type === 'image/png' ? blob : await toPngBlob(blob)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    } catch (e) {
      console.error('Не удалось скопировать обложку:', e)
    }
  }

  const handleSave = async () => {
    const { cover, name } = shown
    onClose()
    try {
      const blob = await (await fetch(cover)).blob()
      const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      const path = await save({
        defaultPath: `${safeFileName(name)}.${ext}`,
        filters: [{ name: t('settings.profile.imagesFilter'), extensions: [ext] }],
      })
      if (!path) return
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    } catch (e) {
      console.error('Не удалось сохранить обложку:', e)
    }
  }

  return createPortal(
    <div
      ref={ref}
      className={`cover-menu ${closing ? 'closing' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      <button className="cover-menu-item" onClick={handleCopy}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {t('views.details.copyCover')}
      </button>
      <button className="cover-menu-item" onClick={handleSave}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {t('views.details.saveCover')}
      </button>
    </div>,
    document.body
  )
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  )
}
