import { useEffect, useState } from 'react'

const cache = new Map<string, string | null>()

/* Средний «живой» цвет обложки: насыщенные пиксели весят больше серых, совсем тёмные и белые не учитываются */
function extract(img: HTMLImageElement): string | null {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i]
    const pg = data[i + 1]
    const pb = data[i + 2]
    const max = Math.max(pr, pg, pb)
    const min = Math.min(pr, pg, pb)
    if (max < 28 || min > 235) continue
    const w = 0.15 + (max - min) / 255
    r += pr * w
    g += pg * w
    b += pb * w
    total += w
  }
  if (total === 0) return null
  return `${Math.round(r / total)}, ${Math.round(g / total)}, ${Math.round(b / total)}`
}

/** Возвращает "r, g, b" для rgba(var(--tint), a) или null, пока цвет неизвестен */
export function useCoverColor(src?: string | null): string | null {
  const [color, setColor] = useState<{ src: string; value: string | null } | null>(null)

  useEffect(() => {
    if (!src || cache.has(src)) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      let value: string | null
      try {
        value = extract(img)
      } catch {
        value = null
      }
      cache.set(src, value)
      if (cache.size > 100) cache.delete(cache.keys().next().value as string)
      if (!cancelled) setColor({ src, value })
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])

  if (!src) return null
  if (cache.has(src)) return cache.get(src) ?? null
  return color?.src === src ? color.value : null
}
