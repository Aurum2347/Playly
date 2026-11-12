import SafeImage from './SafeImage'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { FramePreview, ZoomControl } from './FrameEditor'
import { LookLayers, ProfileBanner } from './ProfileLook'
import ProfileCardBody from './ProfileCardBody'
import DefaultAvatar from './DefaultAvatar'
import DiceIcon from './DiceIcon'
import { randomGradient } from '../lib/gradients'
import { sliderPercent } from './views/settings/helpers'
import { DEFAULT_FRAME, frameStyle, type ImageFrame } from '../lib/imageFrame'
import {
  pickImage,
  saveLook,
  type AvatarShape,
  type BlurEdge,
  type FadeEdge,
  type LookKind,
  type LookMode,
  type PendingImage,
  type ProfileLook,
} from '../lib/profile'
import './PlaylistBanner.css'
import './ProfileLookEditor.css'

interface ProfileLookEditorProps {
  /* null — окно закрыто */
  kind: LookKind | null
  /* Сохранённое оформление, с него начинается черновик */
  look: ProfileLook
  nickname: string
  avatarUrl: string | null
  avatarShape: AvatarShape
  avatarFrame: ImageFrame
  onClose: () => void
}

const MODES: LookMode[] = ['none', 'image', 'gradient']
const FADE_EDGES: FadeEdge[] = ['none', 'left', 'right', 'both']
const BLUR_EDGES: BlurEdge[] = ['none', 'left', 'right', 'both', 'all']

interface RangeFieldProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}

function RangeField({ label, value, display, min, max, disabled, onChange }: RangeFieldProps) {
  return (
    <div className={`banner-editor-field ${disabled ? 'disabled' : ''}`}>
      <div className="banner-editor-label">
        <span>{label}</span>
        <span>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        style={{ '--val': `${sliderPercent(value, min, max)}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Segmented<T extends string>({ value, options, label, onChange }: {
  value: T
  options: T[]
  label: (v: T) => string
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o} className={value === o ? 'active' : ''} onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
}

/** Окно настройки фона карточки профиля или основного баннера */
export default function ProfileLookEditor({
  kind,
  look,
  nickname,
  avatarUrl,
  avatarShape,
  avatarFrame,
  onClose,
}: ProfileLookEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<ProfileLook>(look)
  const [pending, setPending] = useState<(PendingImage & { url: string }) | null>(null)
  const [openedFor, setOpenedFor] = useState<LookKind | null>(null)
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickError, setPickError] = useState(false)

  if (kind !== openedFor) {
    setOpenedFor(kind)
    setDraft(look)
    setPending(null)
    setPickError(false)
  }

  /* Несохранённая картинка живёт только в памяти — освобождаем её, когда она больше не нужна */
  useEffect(() => {
    if (!pending) return
    return () => URL.revokeObjectURL(pending.url)
  }, [pending])

  useEffect(() => {
    if (kind === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [kind, onClose])

  if (kind === null) return null

  const isCard = kind === 'card'
  const patch = (p: Partial<ProfileLook>) => setDraft((d) => ({ ...d, ...p }))

  const pick = async () => {
    if (picking) return
    setPicking(true)
    setPickError(false)
    try {
      const img = await pickImage(t('settings.profile.imagesFilter'))
      if (!img) return
      setPending(img)
      /* Новая картинка — новый кадр; остальные настройки сохраняем */
      setDraft((d) => ({ ...d, mode: 'image', url: img.url, frame: DEFAULT_FRAME }))
    } catch (e) {
      console.error('Не удалось открыть изображение:', e)
      setPickError(true)
    } finally {
      setPicking(false)
    }
  }

  const setMode = (mode: LookMode) => {
    patch({ mode })
    if (mode === 'image' && !draft.url) void pick()
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const final: ProfileLook = draft.mode === 'image' && !draft.url ? { ...draft, mode: 'none' } : draft
      await saveLook(kind, final, final.mode === 'image' ? pending : null)
      onClose()
    } catch (e) {
      console.error('Не удалось сохранить оформление профиля:', e)
    } finally {
      setSaving(false)
    }
  }

  const hasImage = draft.mode === 'image' && !!draft.url
  const edgeLabel = (e: string) => t(`look.edge_${e}`)

  /* ===== Предпросмотр ===== */
  const cardBody = (
    <ProfileCardBody nickname={nickname} avatarUrl={avatarUrl} avatarShape={avatarShape} avatarFrame={avatarFrame} />
  )

  let preview: ReactNode
  if (isCard) {
    preview = hasImage ? (
      <FramePreview
        src={draft.url as string}
        frame={draft.frame}
        onChange={(frame) => patch({ frame })}
        className="profile-card has-look look-editor-card"
        image={<LookLayers look={draft} />}
      >
        {cardBody}
      </FramePreview>
    ) : (
      <div className={`profile-card look-editor-card ${draft.mode === 'gradient' ? 'has-look' : ''}`}>
        <LookLayers look={draft} />
        {cardBody}
      </div>
    )
  } else {
    const avatar = (
      <div className={`look-editor-avatar ${avatarShape}`}>
        {avatarUrl ? <SafeImage src={avatarUrl} alt="" draggable={false} style={frameStyle(avatarFrame)} /> : <DefaultAvatar seed={nickname} />}
      </div>
    )
    preview = (
      <div className="look-editor-profile">
        {hasImage ? (
          <FramePreview
            src={draft.url as string}
            frame={draft.frame}
            onChange={(frame) => patch({ frame })}
            className="profile-banner look-editor-banner"
            image={<LookLayers look={draft} effects={false} />}
          />
        ) : (
          <ProfileBanner look={draft} avatarUrl={avatarUrl} seed={nickname} className="look-editor-banner" />
        )}
        <div className="look-editor-profile-row">
          {avatar}
          <strong>{nickname}</strong>
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="frame-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="frame-modal wide look-editor">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t(isCard ? 'look.cardTitle' : 'look.bannerTitle')}</div>
          <div className="frame-modal-sub">{t(isCard ? 'look.cardSub' : 'look.bannerSub')}</div>
        </div>

        <div className={`look-editor-stage ${isCard ? 'is-card' : 'is-banner'}`}>{preview}</div>

        {hasImage && <div className="frame-modal-sub look-editor-hint">{t('frame.hint')}</div>}
        {draft.mode === 'none' && <div className="frame-modal-sub look-editor-hint">{t('look.emptyNone')}</div>}
        {pickError && <div className="look-editor-error">{t('look.pickError')}</div>}

        <div className="banner-editor-grid">
          <div className="banner-editor-field full">
            <div className="banner-editor-label"><span>{t('look.mode')}</span></div>
            <Segmented value={draft.mode} options={MODES} label={(m) => t(`look.mode_${m}`)} onChange={setMode} />
          </div>

          {draft.mode === 'image' && (
            <>
              {hasImage && (
                <div className="banner-editor-field full">
                  <div className="banner-editor-label"><span>{t('banner.zoom')}</span></div>
                  <ZoomControl frame={draft.frame} onChange={(frame) => patch({ frame })} />
                </div>
              )}
              <div className="banner-editor-field full">
                <div className="banner-editor-label"><span>{t('look.image')}</span></div>
                <div className="banner-editor-file">
                  <button className="btn" onClick={pick} disabled={picking}>
                    {picking ? t('common.loading') : hasImage ? t('look.change') : t('look.choose')}
                  </button>
                </div>
              </div>
            </>
          )}

          {draft.mode === 'gradient' && (
            <div className="banner-editor-field full">
              <div className="look-editor-gradient">
                <label className="look-editor-color">
                  <span className="look-editor-swatch" style={{ background: draft.gradient.from }}>
                    <input
                      type="color"
                      value={draft.gradient.from}
                      onChange={(e) => patch({ gradient: { ...draft.gradient, from: e.target.value } })}
                    />
                  </span>
                  {t('look.gradientFrom')}
                </label>
                <button
                  className="icon-btn look-editor-swap"
                  title={t('look.swap')}
                  onClick={() => patch({ gradient: { ...draft.gradient, from: draft.gradient.to, to: draft.gradient.from } })}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                </button>
                <label className="look-editor-color">
                  <span className="look-editor-swatch" style={{ background: draft.gradient.to }}>
                    <input
                      type="color"
                      value={draft.gradient.to}
                      onChange={(e) => patch({ gradient: { ...draft.gradient, to: e.target.value } })}
                    />
                  </span>
                  {t('look.gradientTo')}
                </label>
                <button className="btn look-editor-random" onClick={() => patch({ gradient: randomGradient() })} title={t('look.randomDesc')}>
                  <DiceIcon />
                  {t('look.random')}
                </button>
                <div className="look-editor-angle">
                  <RangeField
                    label={t('look.angle')}
                    value={draft.gradient.angle}
                    display={`${draft.gradient.angle}°`}
                    min={0}
                    max={360}
                    onChange={(angle) => patch({ gradient: { ...draft.gradient, angle } })}
                  />
                </div>
              </div>
            </div>
          )}

          {isCard && draft.mode !== 'none' && (
            <>
              <div className="banner-editor-field">
                <div className="banner-editor-label"><span>{t('look.fade')}</span></div>
                <Segmented value={draft.fade} options={FADE_EDGES} label={edgeLabel} onChange={(fade) => patch({ fade })} />
              </div>
              <RangeField
                label={t('look.fadeSize')}
                value={draft.fadeSize}
                display={`${draft.fadeSize}%`}
                min={10}
                max={100}
                disabled={draft.fade === 'none'}
                onChange={(fadeSize) => patch({ fadeSize })}
              />

              {draft.mode === 'image' && (
                <>
                  <div className="banner-editor-field">
                    <div className="banner-editor-label"><span>{t('look.blur')}</span></div>
                    <Segmented value={draft.blur} options={BLUR_EDGES} label={edgeLabel} onChange={(blur) => patch({ blur })} />
                  </div>
                  <RangeField
                    label={t('look.blurSize')}
                    value={draft.blurSize}
                    display={`${draft.blurSize}%`}
                    min={10}
                    max={100}
                    disabled={draft.blur === 'none' || draft.blur === 'all'}
                    onChange={(blurSize) => patch({ blurSize })}
                  />
                  <RangeField
                    label={t('look.blurAmount')}
                    value={draft.blurAmount}
                    display={`${draft.blurAmount}px`}
                    min={1}
                    max={40}
                    disabled={draft.blur === 'none'}
                    onChange={(blurAmount) => patch({ blurAmount })}
                  />
                </>
              )}
            </>
          )}

          {draft.mode !== 'none' && (
            <RangeField
              label={t('look.dim')}
              value={Math.round(draft.dim * 100)}
              display={`${Math.round(draft.dim * 100)}%`}
              min={0}
              max={80}
              onChange={(v) => patch({ dim: v / 100 })}
            />
          )}
        </div>

        <div className="frame-modal-actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
