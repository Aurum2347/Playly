import type { CSSProperties } from 'react'
import type { PlaylistBanner } from '../App'
import { frameStyle } from '../lib/imageFrame'
import { blurMask } from '../lib/masks'
import { bannerVisible } from '../lib/banner'
import './PlaylistBanner.css'

interface BannerLayersProps {
  banner: PlaylistBanner
  className?: string
}

/** Слои баннера: картинка в своём кадре → размытие у краёв → затемнение для читаемости текста */
export function BannerLayers({ banner, className }: BannerLayersProps) {
  if (!bannerVisible(banner)) return null
  if (banner.mode === 'gradient' && banner.gradient) {
    const g = banner.gradient
    return (
      <div className={`pl-banner ${className ?? ''}`} aria-hidden="true">
        <div className="pl-banner-gradient" style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }} />
        <div className="pl-banner-shade" style={{ '--dim': banner.dim } as CSSProperties} />
      </div>
    )
  }
  const mask = blurMask(banner.blur, banner.blurSize)
  const showBlur = banner.blur !== 'none' && banner.blurAmount > 0
  return (
    <div className={`pl-banner ${className ?? ''}`} aria-hidden="true">
      <img src={banner.url ?? undefined} alt="" draggable={false} style={frameStyle(banner.frame)} />
      {showBlur && (
        <div
          className="pl-banner-blur"
          style={{
            backdropFilter: `blur(${banner.blurAmount}px)`,
            WebkitBackdropFilter: `blur(${banner.blurAmount}px)`,
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        />
      )}
      <div className="pl-banner-shade" style={{ '--dim': banner.dim } as CSSProperties} />
    </div>
  )
}
