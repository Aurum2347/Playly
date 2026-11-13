/*
 * Режим экономии ресурсов: анимированные картинки (GIF, анимированный WebP) показываются первым кадром.
 * Кадр рисуется один раз и кешируется; обычные картинки возвращаются как есть.
 */

const cache = new Map<string, Promise<string>>()
const MAX_CACHE = 300

/** Может ли картинка оказаться анимированной (по адресу этого не понять у blob — проверим тип) */
export function mightAnimate(src: string): boolean {
  return src.startsWith('blob:') || /\.(gif|webp)(?:[?#]|$)/i.test(src)
}

async function firstFrame(src: string): Promise<string> {
  const res = await fetch(src)
  const blob = await res.blob()
  const animated = blob.type === 'image/gif' || blob.type === 'image/webp' || /\.(gif|webp)(?:[?#]|$)/i.test(src)
  if (!animated) return src
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return png ? URL.createObjectURL(png) : src
  } finally {
    bitmap.close()
  }
}

export function freezeImage(src: string): Promise<string> {
  let job = cache.get(src)
  if (!job) {
    job = firstFrame(src).catch(() => src)
    cache.set(src, job)
    if (cache.size > MAX_CACHE) {
      const [oldSrc, oldJob] = cache.entries().next().value as [string, Promise<string>]
      cache.delete(oldSrc)
      void oldJob.then((u) => { if (u !== oldSrc && u.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(u), 5000) })
    }
  }
  return job
}
