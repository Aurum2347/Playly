import type { CSSProperties } from 'react'
import type { BannerBlur, PlaylistBanner } from '../App'
import { frameStyle } from '../lib/imageFrame'
import './PlaylistBanner.css'

/**
 * Маска для слоя размытия: чёрное — размыто, прозрачное — чётко.
 * Сильнее всего размыт самый край, к середине размытие плавно сходит на нет.
 */
function blurMask(mode: BannerBlur, size: number): string | undefined {
  const s = Math.max(5, Math.min(100, size))
  const hard = (v: number) => (v * 0.35).toFixed(1)
  switch (mode) {
    case 'left':
      return `linear-gradient(to right, #000 0%, #000 ${hard(s)}%, transparent ${s}%)`
    case 'right':
      return `linear-gradient(to left, #000 0%, #000 ${hard(s)}%, transparent ${s}%)`
    case 'both': {
      const h = s / 2
      return `linear-gradient(to right, #000 0%, #000 ${hard(h)}%, transparent ${h}%, transparent ${100 - h}%, #000 ${100 - +hard(h)}%, #000 100%)`
    }
    default:
      return undefined
  }
}

interface BannerLayersProps {
  banner: PlaylistBanner
  className?: string
}

/** Слои баннера: картинка в своём кадре → размытие у краёв → затемнение для читаемости текста */
export function BannerLayers({ banner, className }: BannerLayersProps) {
  if (!banner.url) return null
  const mask = blurMask(banner.blur, banner.blurSize)
  const showBlur = banner.blur !== 'none' && banner.blurAmount > 0
  return (
    <div className={`pl-banner ${className ?? ''}`} aria-hidden="true">
      <img src={banner.url} alt="" draggable={false} style={frameStyle(banner.frame)} />
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
