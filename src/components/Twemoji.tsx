import { useEffect, useRef } from 'react'
import twemoji from 'twemoji'

interface TwemojiProps {
  text: string
  className?: string
}

export default function Twemoji({ text, className }: TwemojiProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current) return

    const html = twemoji.parse(text, {
      base: '/flags/',
      ext: '.svg',
      folder: 'svg',
    })

    ref.current.innerHTML = html
  }, [text])

  return <span ref={ref} className={className} />
}