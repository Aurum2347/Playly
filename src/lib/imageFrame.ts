import { useCallback, useEffect, useRef, type CSSProperties, type RefObject } from 'react'

/**
 * Кадр изображения без пересохранения файла: масштаб и точка, которая остаётся в фокусе.
 * Хранятся только эти числа, поэтому кадрирование обратимо и работает даже для GIF.
 */
export interface ImageFrame {
  /* 1 — картинка ровно закрывает рамку, больше — приближение */
  zoom: number
  /* Фокус в процентах (0–100), как у object-position */
  x: number
  y: number
}

export const DEFAULT_FRAME: ImageFrame = { zoom: 1, x: 50, y: 50 }
export const FRAME_MIN_ZOOM = 1
export const FRAME_MAX_ZOOM = 4

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function normalizeFrame(value: unknown): ImageFrame {
  const f = (value ?? {}) as Partial<ImageFrame>
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d)
  return {
    zoom: clamp(num(f.zoom, 1), FRAME_MIN_ZOOM, FRAME_MAX_ZOOM),
    x: clamp(num(f.x, 50), 0, 100),
    y: clamp(num(f.y, 50), 0, 100),
  }
}

/**
 * Стиль для <img>, заполняющего рамку: object-fit: cover задаёт базовое кадрирование,
 * а масштаб вокруг той же точки фокуса никогда не оставляет пустых краёв.
 */
export function frameStyle(frame: ImageFrame | null | undefined): CSSProperties {
  const f = frame ?? DEFAULT_FRAME
  return {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: `${f.x}% ${f.y}%`,
    transformOrigin: `${f.x}% ${f.y}%`,
    transform: f.zoom !== 1 ? `scale(${f.zoom})` : undefined,
    display: 'block',
  }
}

/**
 * Рисует кадр в canvas точно так же, как его показывает frameStyle
 * (пригодится, если нужен готовый файл, а не параметры).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  frame: ImageFrame,
  boxW: number,
  boxH: number
) {
  const s0 = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight)
  const dw = img.naturalWidth * s0
  const dh = img.naturalHeight * s0
  const px = frame.x / 100
  const py = frame.y / 100
  const ox = boxW * px
  const oy = boxH * py
  const left = ox + ((boxW - dw) * px - ox) * frame.zoom
  const top = oy + ((boxH - dh) * py - oy) * frame.zoom
  ctx.drawImage(img, left, top, dw * frame.zoom, dh * frame.zoom)
}

/**
 * Перетаскивание и масштаб колёсиком внутри рамки. Сдвиг считается так,
 * чтобы картинка ехала ровно за курсором (1:1), с учётом масштаба и запаса по краям.
 */
export function usePanZoom(
  boxRef: RefObject<HTMLElement | null>,
  frame: ImageFrame,
  onChange: (f: ImageFrame) => void
) {
  const frameRef = useRef(frame)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    frameRef.current = frame
    onChangeRef.current = onChange
  })

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const box = boxRef.current
      /* Картинка ищется внутри рамки: слоёв поверх неё может быть сколько угодно */
      const img = box?.querySelector('img') ?? null
      if (!box || !img || !img.naturalWidth) return
      e.preventDefault()
      const rect = box.getBoundingClientRect()
      const W = rect.width
      const H = rect.height
      const s0 = Math.max(W / img.naturalWidth, H / img.naturalHeight)
      const overX = img.naturalWidth * s0 - W
      const overY = img.naturalHeight * s0 - H
      const start = { x: e.clientX, y: e.clientY, frame: frameRef.current }
      const target = e.currentTarget as HTMLElement
      try { target.setPointerCapture(e.pointerId) } catch { /* окно потеряло фокус */ }
      document.body.classList.add('is-panning')

      const move = (ev: PointerEvent) => {
        const z = start.frame.zoom
        /* Сколько пикселей проезжает картинка при сдвиге фокуса на 100 % */
        const spanX = W * (z - 1) + overX * z
        const spanY = H * (z - 1) + overY * z
        const dx = ev.clientX - start.x
        const dy = ev.clientY - start.y
        onChangeRef.current({
          zoom: z,
          x: spanX > 0.5 ? clamp(start.frame.x - (dx / spanX) * 100, 0, 100) : start.frame.x,
          y: spanY > 0.5 ? clamp(start.frame.y - (dy / spanY) * 100, 0, 100) : start.frame.y,
        })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        document.body.classList.remove('is-panning')
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [boxRef]
  )

  /* Колёсико: слушаем нативно с passive: false, иначе нельзя отменить прокрутку страницы */
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = frameRef.current
      const zoom = clamp(f.zoom * Math.exp(-e.deltaY * 0.0015), FRAME_MIN_ZOOM, FRAME_MAX_ZOOM)
      if (zoom !== f.zoom) onChangeRef.current({ ...f, zoom })
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => box.removeEventListener('wheel', onWheel)
  }, [boxRef])

  return { onPointerDown }
}
