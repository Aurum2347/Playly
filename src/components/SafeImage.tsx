import { useEffect, useState, type ImgHTMLAttributes, type Ref } from 'react'
import { usePrefs } from '../lib/prefs'
import { freezeImage, mightAnimate } from '../lib/staticImage'

export default function SafeImage({ src, onError, ref, ...props }: ImgHTMLAttributes<HTMLImageElement> & { ref?: Ref<HTMLImageElement> }) {
  const [failed, setFailed] = useState<unknown>(null)
  /* Экономия ресурсов: вместо анимации — первый кадр (статичные картинки не меняются) */
  const { powerSave } = usePrefs()
  const freeze = powerSave && typeof src === 'string' && mightAnimate(src)
  const [frozen, setFrozen] = useState<{ src: string; url: string } | null>(null)
  useEffect(() => {
    if (!freeze || typeof src !== 'string') return
    let alive = true
    void freezeImage(src).then((url) => { if (alive) setFrozen({ src, url }) })
    return () => { alive = false }
  }, [freeze, src])

  if (!src || failed === src) return <span className={`image-fallback ${props.className ?? ''}`} style={props.style} role={props.alt ? 'img' : undefined} aria-label={props.alt || undefined} aria-hidden={!props.alt || undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
  /* Пока кадр готовится, анимацию не показываем даже на мгновение */
  const shown = freeze ? (frozen?.src === src ? frozen.url : undefined) : src
  return <img {...props} src={shown} ref={ref} onError={(event) => { if (shown === src) setFailed(src); onError?.(event) }} />
}
