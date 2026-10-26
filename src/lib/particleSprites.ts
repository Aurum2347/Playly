import { join } from '@tauri-apps/api/path'
import { exists, readFile } from '@tauri-apps/plugin-fs'
import { particlesDir, type ParticleShape, type ParticleSmoothing, type ParticleSource } from './appearance'

/*
 * Спрайты своих частиц. Формы рисуются кодом, картинки читаются из папки particles.
 * Анимированный GIF раскладывается на кадры (WebCodecs ImageDecoder): canvas сам по себе
 * рисует у GIF только первый кадр, поэтому без раскладки частицы-гифки стояли бы на месте.
 */

export interface SpriteFrame {
  image: CanvasImageSource
  w: number
  h: number
  /* Время конца кадра от начала анимации, мс */
  until: number
}

export interface ParticleSprite {
  frames: SpriteFrame[]
  /* Длительность всей анимации, мс (0 — картинка статична) */
  total: number
  smoothing: ParticleSmoothing
}

/* Больше не нужно: частица на экране редко крупнее ~100 px */
const MAX_SIDE = 128
const MAX_FRAMES = 120
const cache = new Map<string, Promise<ParticleSprite>>()

function shapeCanvas(shape: ParticleShape, color: string): HTMLCanvasElement {
  const s = 96
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const glow = (r: number, inner: number) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r)
    g.addColorStop(0, color)
    g.addColorStop(inner, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  }
  ctx.fillStyle = color
  ctx.shadowColor = color
  switch (shape) {
    case 'dot':
      glow(s / 2, 0.55)
      break
    case 'glow':
      glow(s / 2, 0.12)
      break
    case 'star': {
      ctx.shadowBlur = 12
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s * 0.42 : s * 0.18
        const a = (Math.PI / 5) * i - Math.PI / 2
        ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'heart': {
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(s * 0.5, s * 0.84)
      ctx.bezierCurveTo(s * 0.08, s * 0.56, s * 0.12, s * 0.16, s * 0.5, s * 0.32)
      ctx.bezierCurveTo(s * 0.88, s * 0.16, s * 0.92, s * 0.56, s * 0.5, s * 0.84)
      ctx.fill()
      break
    }
    case 'note': {
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.ellipse(s * 0.36, s * 0.7, s * 0.15, s * 0.11, -0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(s * 0.46, s * 0.16, s * 0.07, s * 0.54)
      ctx.beginPath()
      ctx.moveTo(s * 0.53, s * 0.16)
      ctx.quadraticCurveTo(s * 0.82, s * 0.24, s * 0.74, s * 0.48)
      ctx.quadraticCurveTo(s * 0.72, s * 0.32, s * 0.53, s * 0.3)
      ctx.fill()
      break
    }
    case 'square': {
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.roundRect(s * 0.22, s * 0.22, s * 0.56, s * 0.56, s * 0.1)
      ctx.fill()
      break
    }
  }
  return c
}

/* Минимальное описание ImageDecoder — в стандартных типах его может не быть */
interface DecodedFrame {
  image: VideoFrame
}
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode(opts: { frameIndex: number }): Promise<DecodedFrame>
  close(): void
}
type ImageDecoderCtor = new (init: { data: Uint8Array; type: string }) => ImageDecoderLike

function fitSize(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

async function decodeAnimated(bytes: Uint8Array, mime: string, smoothing: ParticleSmoothing): Promise<ParticleSprite | null> {
  const Decoder = (window as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder
  if (!Decoder) return null
  const decoder = new Decoder({ data: bytes, type: mime })
  try {
    await decoder.tracks.ready
    const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_FRAMES)
    const frames: SpriteFrame[] = []
    let t = 0
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      const size = fitSize(image.displayWidth, image.displayHeight)
      const bitmap = await createImageBitmap(image, {
        resizeWidth: size.w,
        resizeHeight: size.h,
        resizeQuality: smoothing === 'pixelated' ? 'pixelated' : 'high',
      })
      /* duration — в микросекундах; у кадров без задержки ставим привычные для GIF 100 мс */
      t += Math.max(20, (image.duration ?? 100_000) / 1000)
      image.close()
      frames.push({ image: bitmap, w: size.w, h: size.h, until: t })
    }
    return { frames, total: frames.length > 1 ? t : 0, smoothing }
  } finally {
    decoder.close()
  }
}

async function loadImage(file: string, smoothing: ParticleSmoothing): Promise<ParticleSprite> {
  const path = await join(await particlesDir(), file)
  if (!(await exists(path))) throw new Error(`no particle image ${file}`)
  const bytes = await readFile(path)
  const ext = file.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg'
  if (ext === 'gif' || ext === 'webp') {
    try {
      const anim = await decodeAnimated(bytes, mime, smoothing)
      if (anim) return anim
    } catch (e) {
      console.warn('Не удалось разобрать анимацию частицы, берём первый кадр:', e)
    }
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const first = await createImageBitmap(blob)
  const size = fitSize(first.width, first.height)
  const bitmap = await createImageBitmap(first, {
    resizeWidth: size.w,
    resizeHeight: size.h,
    resizeQuality: smoothing === 'pixelated' ? 'pixelated' : 'high',
  })
  first.close()
  return { frames: [{ image: bitmap, w: size.w, h: size.h, until: 0 }], total: 0, smoothing }
}

/** Спрайт для источника частицы (с кешем: один файл раскладывается на кадры один раз) */
export function loadParticleSprite(source: ParticleSource): Promise<ParticleSprite> {
  const key = source.type === 'shape' ? `s:${source.shape}:${source.color}` : `i:${source.file}:${source.smoothing}`
  let job = cache.get(key)
  if (!job) {
    job =
      source.type === 'shape'
        ? Promise.resolve({ frames: [{ image: shapeCanvas(source.shape, source.color), w: 96, h: 96, until: 0 }], total: 0, smoothing: 'smooth' as const })
        : loadImage(source.file, source.smoothing)
    job.catch(() => cache.delete(key))
    cache.set(key, job)
  }
  return job
}

/** Кадр анимации на момент t (мс) со сдвигом фазы, чтобы частицы не двигались синхронно */
export function spriteFrame(sprite: ParticleSprite, tMs: number): SpriteFrame {
  if (sprite.total <= 0 || sprite.frames.length === 1) return sprite.frames[0]
  const local = ((tMs % sprite.total) + sprite.total) % sprite.total
  return sprite.frames.find((f) => local < f.until) ?? sprite.frames[sprite.frames.length - 1]
}
