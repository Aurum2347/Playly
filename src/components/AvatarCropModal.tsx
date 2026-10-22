import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { DEFAULT_FRAME, frameStyle, type ImageFrame } from '../lib/imageFrame'
import { FramePreview, ZoomControl } from './FrameEditor'

interface AvatarCropModalProps {
  /* null — окно закрыто */
  src: string | null
  shape: 'circle' | 'square'
  initialFrame?: ImageFrame | null
  onCancel: () => void
  onSave: (frame: ImageFrame) => void
}

/** Кадрирование аватарки: двигаем мышью, приближаем колёсиком/ползунком, сразу видим маленькие копии */
export default function AvatarCropModal({ src, shape, initialFrame, onCancel, onSave }: AvatarCropModalProps) {
  const { t } = useI18n()
  const [frame, setFrame] = useState<ImageFrame>(initialFrame ?? DEFAULT_FRAME)
  /* Каждое открытие начинается с переданного кадра */
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (src !== openedFor) {
    setOpenedFor(src)
    setFrame(initialFrame ?? DEFAULT_FRAME)
  }

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        onSave(frame)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [src, frame, onCancel, onSave])

  if (!src) return null

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="frame-modal">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('frame.avatarTitle')}</div>
          <div className="frame-modal-sub">{t('frame.hint')}</div>
        </div>

        <div className="avatar-crop-stage">
          <FramePreview src={src} frame={frame} onChange={setFrame} className={`avatar-crop-box ${shape}`} />
        </div>

        <div className="avatar-crop-previews">
          {[56, 42, 28].map((size) => (
            <div key={size} className={`avatar-crop-mini ${shape}`} style={{ width: size, height: size }}>
              <img src={src} alt="" draggable={false} style={frameStyle(frame)} />
            </div>
          ))}
        </div>

        <ZoomControl frame={frame} onChange={setFrame} />

        <div className="frame-modal-actions">
          <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => onSave(frame)}>{t('common.save')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
