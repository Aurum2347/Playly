import { useState, type ImgHTMLAttributes, type Ref } from 'react'

export default function SafeImage({ src, onError, ref, ...props }: ImgHTMLAttributes<HTMLImageElement> & { ref?: Ref<HTMLImageElement> }) {
  const [failed, setFailed] = useState<unknown>(null)
  if (!src || failed === src) return <span className={`image-fallback ${props.className ?? ''}`} style={props.style} role={props.alt ? 'img' : undefined} aria-label={props.alt || undefined} aria-hidden={!props.alt || undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
  return <img {...props} src={src} ref={ref} onError={(event) => { setFailed(src); onError?.(event) }} />
}
