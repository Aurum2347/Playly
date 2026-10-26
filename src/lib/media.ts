import { useSyncExternalStore } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { drawFrame, frameStyle, type ImageFrame } from './imageFrame'

/* ===== Форматы ===== */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
/* Видео, которые умеет открыть встроенный движок (WebView2 / WebKit); из них делаются GIF */
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']

export const fileExt = (path: string) => path.split('.').pop()?.toLowerCase() ?? ''
export const isVideoPath = (path: string) => VIDEO_EXTENSIONS.includes(fileExt(path))
export const isGifBytes = (b: Uint8Array) => b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46

/* ===== Окно «Видео → GIF»: запрос из любого места, ответ — когда пользователь сохранит ===== */

/* Для чего нужна анимация: от этого зависят пропорции по умолчанию и нужна ли статичная заставка */
export type GifPurpose = 'cover' | 'track' | 'avatar' | 'banner' | 'background'

export interface VideoGifResult {
  gif: Uint8Array
  /* Статичный кадр (JPEG) — заставка трека в списках */
  poster: Uint8Array
}

export interface VideoGifRequest {
  id: number
  path: string
  purpose: GifPurpose
  resolve: (r: VideoGifResult | null) => void
}

let request: VideoGifRequest | null = null
let requestSeq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Открывает окно настройки анимации из видео; null — пользователь передумал */
export function requestVideoGif(path: string, purpose: GifPurpose): Promise<VideoGifResult | null> {
  /* Предыдущий запрос (если окно почему-то осталось открытым) считаем отменённым */
  request?.resolve(null)
  return new Promise((resolve) => {
    const id = ++requestSeq
    request = {
      id,
      path,
      purpose,
      resolve: (r) => {
        if (request?.id === id) request = null
        resolve(r)
        emit()
      },
    }
    emit()
  })
}

export function useVideoGifRequest(): VideoGifRequest | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => request
  )
}

/* ===== Выбор картинки или видео ===== */

export interface PickedVisual {
  bytes: Uint8Array
  ext: string
  /* Для GIF и видео — статичный первый (или выбранный) кадр */
  poster?: Uint8Array
}

/**
 * Диалог выбора картинки; видео сразу открывает окно «Видео → GIF».
 * Возвращает байты (GIF для видео) или null, если ничего не выбрали или файл слишком большой.
 */
export async function pickVisual(opts: {
  filterName: string
  purpose: GifPurpose
  maxBytes?: number
}): Promise<PickedVisual | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: opts.filterName, extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] }],
  })
  if (!selected || Array.isArray(selected)) return null
  if (isVideoPath(selected)) {
    const result = await requestVideoGif(selected, opts.purpose)
    return result ? { bytes: result.gif, ext: 'gif', poster: result.poster } : null
  }
  const raw = fileExt(selected) || 'png'
  const ext = raw === 'jpeg' ? 'jpg' : raw
  const bytes = await readFile(selected)
  if (bytes.length === 0 || (opts.maxBytes && bytes.length > opts.maxBytes)) return null
  return { bytes, ext, poster: ext === 'gif' ? (await firstFramePoster(bytes)) ?? undefined : undefined }
}

/* ===== Кадры и кодирование ===== */

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('toBlob failed'))
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
      },
      'image/jpeg',
      quality
    )
  })
}

/** Первый кадр GIF как JPEG — статичная заставка */
export async function firstFramePoster(gif: Uint8Array, maxSide = 600): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([gif as unknown as BlobPart], { type: 'image/gif' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await canvasToJpeg(canvas)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface LoadedVideo {
  el: HTMLVideoElement
  /* Освободить память (blob) */
  dispose: () => void
}

function waitVideo(el: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(el.error ?? new Error('video error'))
    }
    const cleanup = () => {
      el.removeEventListener('loadeddata', ok)
      el.removeEventListener('error', fail)
    }
    el.addEventListener('loadeddata', ok)
    el.addEventListener('error', fail)
  })
}

/* Можно ли читать пиксели кадра (иначе canvas «заражён» чужим источником) */
function canReadPixels(el: HTMLVideoElement): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 2
    const ctx = c.getContext('2d')
    ctx?.drawImage(el, 0, 0, 2, 2)
    ctx?.getImageData(0, 0, 1, 1)
    return true
  } catch {
    return false
  }
}

/**
 * Открывает видеофайл. Сначала — потоком через asset-протокол (не грузит гигабайты в память);
 * если кадры так прочитать нельзя, читаем файл целиком в blob.
 */
export async function loadVideo(path: string): Promise<LoadedVideo> {
  const make = () => {
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    return el
  }

  try {
    const el = make()
    el.crossOrigin = 'anonymous'
    el.src = convertFileSrc(path)
    await waitVideo(el)
    if (canReadPixels(el)) return { el, dispose: () => el.removeAttribute('src') }
    el.removeAttribute('src')
  } catch {
    /* попробуем через blob */
  }

  const bytes = await readFile(path)
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: videoMime(path) }))
  const el = make()
  el.src = url
  try {
    await waitVideo(el)
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  return {
    el,
    dispose: () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    },
  }
}

export function videoMime(path: string): string {
  switch (fileExt(path)) {
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    case 'mov': return 'video/quicktime'
    default: return 'video/mp4'
  }
}

export function seekVideo(el: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - t) < 0.0005 && el.readyState >= 2) return resolve()
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('seeked', finish)
      clearTimeout(timer)
      resolve()
    }
    /* Некоторые контейнеры не присылают seeked для крайних точек — не ждём вечно */
    const timer = setTimeout(finish, 2500)
    el.addEventListener('seeked', finish)
    el.currentTime = t
  })
}

export interface Segment {
  start: number
  end: number
}

export interface GifOptions {
  segments: Segment[]
  frame: ImageFrame
  width: number
  height: number
  fps: number
  onProgress?: (done: number, total: number) => void
  shouldStop?: () => boolean
}

export const segmentsLength = (segs: Segment[]) => segs.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0)
export const gifFrameCount = (segs: Segment[], fps: number) =>
  segs.reduce((acc, s) => acc + Math.max(0, Math.ceil((s.end - s.start) * fps - 1e-6)), 0)

/** Кодирует выбранные фрагменты видео в зацикленный GIF. null — кодирование отменили */
export async function encodeGif(el: HTMLVideoElement, o: GifOptions): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = o.width
  canvas.height = o.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d unavailable')

  const gif = GIFEncoder()
  const delay = Math.round(1000 / o.fps)
  const total = gifFrameCount(o.segments, o.fps)
  let done = 0
  el.pause()

  for (const seg of o.segments) {
    const frames = Math.ceil((seg.end - seg.start) * o.fps - 1e-6)
    for (let i = 0; i < frames; i++) {
      if (o.shouldStop?.()) return null
      await seekVideo(el, Math.min(seg.end, seg.start + i / o.fps))
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, o.width, o.height)
      drawFrame(ctx, el, o.frame, o.width, o.height)
      const { data } = ctx.getImageData(0, 0, o.width, o.height)
      const palette = quantize(data, 256, { format: 'rgb444' })
      const index = applyPalette(data, palette, 'rgb444')
      gif.writeFrame(index, o.width, o.height, { palette, delay, repeat: 0 })
      done += 1
      o.onProgress?.(done, total)
      /* Отдаём управление интерфейсу, чтобы полоса прогресса успевала обновляться */
      if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0))
    }
  }
  gif.finish()
  return gif.bytes()
}

/** Кадр видео в момент t, кадрированный как анимация, — JPEG для статичной заставки */
export async function capturePoster(
  el: HTMLVideoElement,
  t: number,
  frame: ImageFrame,
  width: number,
  height: number
): Promise<Uint8Array> {
  await seekVideo(el, t)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  drawFrame(ctx, el, frame, width, height)
  return canvasToJpeg(canvas)
}

/* ===== Предпросмотр в окне «Анимация из видео» (DOM-операции над <video> вне React) ===== */

/** Вставляет видео в рамку предпросмотра; возвращает функцию, которая его оттуда убирает */
export function mountPreview(el: HTMLVideoElement, box: Element, onTime: (t: number) => void): () => void {
  el.className = 'vg-video'
  box.prepend(el)
  const handler = () => onTime(el.currentTime)
  el.addEventListener('timeupdate', handler)
  return () => {
    el.removeEventListener('timeupdate', handler)
    el.remove()
  }
}

/** Кадрирование видео тем же стилем, что и у картинок */
export function applyFrame(el: HTMLVideoElement, frame: ImageFrame) {
  const style = el.style as unknown as Record<string, string>
  for (const [key, value] of Object.entries(frameStyle(frame))) style[key] = value === undefined ? '' : String(value)
}

export function setVideoTime(el: HTMLVideoElement, t: number) {
  el.currentTime = t
}

/** Проигрывает фрагменты по кругу (как будет в GIF); возвращает функцию остановки */
export function loopSegments(el: HTMLVideoElement, segments: Segment[]): () => void {
  let idx = 0
  let raf = 0
  el.currentTime = segments[0].start
  void el.play().catch(() => {})
  const tick = () => {
    const seg = segments[idx]
    if (seg && (el.currentTime >= seg.end || el.currentTime < seg.start - 0.25)) {
      idx = (idx + 1) % segments.length
      el.currentTime = segments[idx].start
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(raf)
    el.pause()
  }
}
