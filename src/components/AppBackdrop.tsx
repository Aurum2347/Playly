import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { frameStyle } from '../lib/imageFrame'
import { customIdOf, type AppBackdrop as Backdrop, type CustomParticle, type ParticleKind } from '../lib/appearance'
import { ParticleField } from '../lib/particles'
import { loadParticleSprite, type ParticleSprite } from '../lib/particleSprites'
import './AppBackdrop.css'

/* Сколько длится перетекание одной обложки в другую */
const COVER_FADE_MS = 900

interface BackdropLayersProps {
  backdrop: Backdrop
  /* Обложка играющего трека — для режима «обложка» */
  coverUrl?: string | null
  className?: string
}

function imageFilter(b: Backdrop): string | undefined {
  const parts: string[] = []
  if (b.blur > 0) parts.push(`blur(${b.blur}px)`)
  if (b.saturation !== 100) parts.push(`saturate(${b.saturation}%)`)
  if (b.brightness !== 100) parts.push(`brightness(${b.brightness}%)`)
  return parts.length ? parts.join(' ') : undefined
}

/** Картинка фона со всеми эффектами; используется и в окне, и в предпросмотре настроек */
export function BackdropLayers({ backdrop: b, coverUrl, className }: BackdropLayersProps) {
  const src = b.mode === 'image' ? b.url : b.mode === 'cover' ? coverUrl : null

  /* При смене обложки старая какое-то время остаётся под новой и плавно уходит */
  const [layers, setLayers] = useState<Array<{ src: string; key: number }>>(src ? [{ src, key: 0 }] : [])
  const [prevSrc, setPrevSrc] = useState(src)
  if (src !== prevSrc) {
    setPrevSrc(src)
    setLayers((prev) => (src ? [...prev.slice(-1), { src, key: (prev.at(-1)?.key ?? 0) + 1 }] : []))
  }
  useEffect(() => {
    if (layers.length < 2) return
    const timer = setTimeout(() => setLayers((prev) => prev.slice(-1)), COVER_FADE_MS)
    return () => clearTimeout(timer)
  }, [layers])

  const filter = imageFilter(b)
  /* Размытые края становятся прозрачными — немного увеличиваем картинку, чтобы их не было видно */
  const bleed = b.blur > 0 ? Math.min(1.25, 1 + b.blur / 200) : 1

  return (
    <div className={`backdrop-layers ${className ?? ''}`} aria-hidden="true">
      {layers.map((l, i) => (
        <div
          key={l.key}
          className={`backdrop-image ${i === layers.length - 1 && layers.length > 1 ? 'entering' : ''}`}
          style={{ filter, transform: bleed !== 1 ? `scale(${bleed})` : undefined } as CSSProperties}
        >
          <img
            src={l.src}
            alt=""
            draggable={false}
            style={b.mode === 'image' ? frameStyle(b.frame) : { width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      ))}
      {b.dim > 0 && <div className="backdrop-dim" style={{ opacity: b.dim }} />}
      {b.vignette > 0 && <div className="backdrop-vignette" style={{ '--vignette': b.vignette } as CSSProperties} />}
    </div>
  )
}

/* Что рисовать: эффект и общие множители; своя частица описана отдельно */
export interface ParticleLayer {
  kind: ParticleKind
  density: number
  speed: number
  size: number
  opacity: number
  blur: number
  custom: CustomParticle | null
}

interface ParticleCanvasProps {
  layer: ParticleLayer
  className?: string
}

export function ParticleCanvas({ layer, className }: ParticleCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fieldRef = useRef<ParticleField | null>(null)
  /* Готовый спрайт своей частицы (картинка или кадры GIF) */
  const [spec, setSpec] = useState<{ def: CustomParticle; sprite: ParticleSprite } | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let field: ParticleField
    try {
      field = new ParticleField(canvas)
    } catch {
      return
    }
    fieldRef.current = field
    /* Размер поля — по самому canvas: в окне это весь экран, в настройках — маленький предпросмотр */
    const observer = new ResizeObserver(() => field.resize())
    observer.observe(canvas)
    const onVisibility = () => field.setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      field.dispose()
      fieldRef.current = null
    }
  }, [])

  const custom = customIdOf(layer.kind) !== null ? layer.custom : null
  useEffect(() => {
    if (!custom) return
    let alive = true
    loadParticleSprite(custom.source)
      .then((sprite) => alive && setSpec({ def: custom, sprite }))
      .catch((e) => console.error('Не удалось загрузить частицу:', e))
    return () => {
      alive = false
    }
  }, [custom])

  const ready = custom && spec?.def === custom ? spec : null
  useEffect(() => {
    fieldRef.current?.configure({
      kind: layer.kind,
      density: layer.density,
      speed: layer.speed,
      size: layer.size,
      opacity: layer.opacity,
      custom: ready ? { behavior: ready.def.behavior, count: ready.def.count, sprite: ready.sprite } : null,
    })
  }, [layer.kind, layer.density, layer.speed, layer.size, layer.opacity, ready])

  return (
    <canvas
      ref={ref}
      className={`particle-canvas ${className ?? ''}`}
      style={{ filter: layer.blur > 0 ? `blur(${layer.blur}px)` : undefined }}
      aria-hidden="true"
    />
  )
}

interface AppBackdropProps {
  backdrop: Backdrop
  coverUrl?: string | null
  particles: ParticleLayer
}

/** Всё, что лежит под интерфейсом: фон и частицы */
export default function AppBackdrop({ backdrop, coverUrl, particles }: AppBackdropProps) {
  return (
    <div className="app-backdrop">
      {backdrop.mode !== 'none' && <BackdropLayers backdrop={backdrop} coverUrl={coverUrl} />}
      <ParticleCanvas layer={particles} />
    </div>
  )
}
