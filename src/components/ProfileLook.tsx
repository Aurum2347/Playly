import SafeImage from './SafeImage'
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { frameStyle } from '../lib/imageFrame'
import { blurMask, fadeMask } from '../lib/masks'
import { gradientCss, lookVisible, type ProfileLook } from '../lib/profile'
import { useCoverColor } from '../lib/coverColor'
import { gradientFromSeed } from '../lib/gradients'
import './ProfileLook.css'

interface ProfileBannerProps {
  look: ProfileLook | null | undefined
  /* Пока баннер не задан, он окрашивается в цвет аватарки (как в Discord), а без аватарки — в цвета ника */
  avatarUrl?: string | null
  seed?: string
  className?: string
  children?: ReactNode
}

/* Узор баннера по умолчанию: звуковая волна и пара нот */
function DefaultBannerArt() {
  return (
    <svg className="profile-banner-art" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path className="pba-wave" d="M0 120 C 60 80, 120 160, 180 120 S 300 80, 360 120 S 480 160, 540 120 S 600 100, 640 110" />
      <path className="pba-wave soft" d="M0 145 C 70 115, 130 175, 200 145 S 320 110, 390 145 S 520 175, 600 140" />
      <g className="pba-note" transform="translate(470 38) rotate(12)">
        <ellipse cx="0" cy="38" rx="11" ry="8" />
        <rect x="8" y="0" width="4" height="38" rx="2" />
        <path d="M12 0 q 18 6 14 22 q -4 -10 -14 -12 z" />
      </g>
      <g className="pba-note small" transform="translate(90 46) rotate(-14)">
        <ellipse cx="0" cy="26" rx="8" ry="6" />
        <rect x="6" y="0" width="3" height="26" rx="1.5" />
      </g>
    </svg>
  )
}

/** Шапка окна профиля: свой баннер или мягкий градиент с узором */
export function ProfileBanner({ look, avatarUrl, seed = '', className, children }: ProfileBannerProps) {
  const tint = useCoverColor(avatarUrl)
  const fallback = useMemo(() => gradientFromSeed(seed), [seed])
  const background = tint
    ? `radial-gradient(120% 160% at 0% 0%, rgba(${tint}, 0.95), transparent 70%), linear-gradient(135deg, rgba(${tint}, 0.75), rgba(${tint}, 0.3))`
    : `linear-gradient(${fallback.angle}deg, ${fallback.from}, ${fallback.to})`
  return (
    <div className={`profile-banner ${className ?? ''}`}>
      {lookVisible(look) ? (
        <LookLayers look={look} effects={false} />
      ) : (
        <div className="profile-banner-default" style={{ background }}>
          <DefaultBannerArt />
        </div>
      )}
      {children}
    </div>
  )
}

interface LookLayersProps {
  look: ProfileLook | null | undefined
  className?: string
  /* Исчезновение и размытие нужны только мини-баннеру карточки */
  effects?: boolean
}

/** Фон профиля: картинка в своём кадре или градиент → размытие у краёв → затемнение; всё вместе плавно исчезает к краю */
export function LookLayers({ look, className, effects = true }: LookLayersProps) {
  if (!lookVisible(look)) return null
  const fade = effects ? fadeMask(look.fade, look.fadeSize) : undefined
  const isImage = look.mode === 'image'
  const showBlur = effects && isImage && look.blur !== 'none' && look.blurAmount > 0
  const blur = showBlur ? blurMask(look.blur, look.blurSize) : undefined

  return (
    <div
      className={`look-layers ${className ?? ''}`}
      aria-hidden="true"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      {isImage ? (
        <SafeImage src={look.url ?? undefined} alt="" draggable={false} style={frameStyle(look.frame)} />
      ) : (
        <div className="look-gradient" style={{ background: gradientCss(look.gradient) }} />
      )}
      {showBlur && (
        <div
          className="look-blur"
          style={{
            backdropFilter: `blur(${look.blurAmount}px)`,
            WebkitBackdropFilter: `blur(${look.blurAmount}px)`,
            maskImage: blur,
            WebkitMaskImage: blur,
          }}
        />
      )}
      {look.dim > 0 && <div className="look-shade" style={{ '--dim': look.dim } as CSSProperties} />}
    </div>
  )
}
