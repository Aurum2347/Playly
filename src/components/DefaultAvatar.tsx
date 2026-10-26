import { useMemo } from 'react'
import { gradientFromSeed } from '../lib/gradients'
import './DefaultAvatar.css'

interface DefaultAvatarProps {
  /* Ник: от него зависит цвет, поэтому у каждого свой, но всегда один и тот же */
  seed: string
  className?: string
}

/** Аватарка, пока своя не загружена: градиент по нику и наушники */
export default function DefaultAvatar({ seed, className }: DefaultAvatarProps) {
  const g = useMemo(() => gradientFromSeed(seed), [seed])
  const letter = seed.trim().charAt(0).toUpperCase()

  return (
    <div className={`default-avatar ${className ?? ''}`} style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }} aria-hidden="true">
      <svg viewBox="0 0 64 64" className="default-avatar-art">
        <path className="da-band" d="M14 38v-6a18 18 0 0 1 36 0v6" />
        <rect className="da-cup" x="10" y="35" width="11" height="17" rx="5" />
        <rect className="da-cup" x="43" y="35" width="11" height="17" rx="5" />
        {letter && (
          <text className="da-letter" x="32" y="49" textAnchor="middle">
            {letter}
          </text>
        )}
      </svg>
    </div>
  )
}
