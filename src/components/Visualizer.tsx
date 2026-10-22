import { useEffect, useRef } from 'react'

interface VisualizerProps {
  getAnalyser: () => AnalyserNode | null | undefined
  isPlaying: boolean
  /* "r, g, b" — цвет полос; без него берётся цвет текста темы */
  tint?: string | null
  bars?: number
  className?: string
}

const MIN_HZ = 32
const MAX_HZ = 16000

/**
 * Спектр в виде симметричных полос. Частоты разбиты логарифмически (как слышит ухо),
 * у полос быстрая атака и медленный спад — так картинка «дышит», а не дёргается.
 */
export default function Visualizer({ getAnalyser, isPlaying, tint, bars = 56, className }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playingRef = useRef(isPlaying)
  const tintRef = useRef(tint)

  useEffect(() => {
    playingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    tintRef.current = tint
  }, [tint])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const levels = new Float32Array(bars)
    let freq: Uint8Array<ArrayBuffer> | null = null
    let bins: Array<[number, number]> = []
    let binsFor = 0
    let raf = 0
    let width = 0
    let height = 0
    let frame = 0
    const readFallback = () =>
      getComputedStyle(canvas).getPropertyValue('--viz-fallback').trim() || '240, 240, 240'
    let fallback = readFallback()

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const buildBins = (analyser: AnalyserNode) => {
      const nyquist = analyser.context.sampleRate / 2
      const count = analyser.frequencyBinCount
      bins = []
      for (let i = 0; i < bars; i++) {
        const f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / bars)
        const f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (i + 1) / bars)
        const a = Math.min(count - 1, Math.floor((f0 / nyquist) * count))
        const b = Math.min(count, Math.max(a + 1, Math.ceil((f1 / nyquist) * count)))
        bins.push([a, b])
      }
      freq = new Uint8Array(new ArrayBuffer(count))
      binsFor = count
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const analyser = getAnalyser()
      if (analyser && (binsFor !== analyser.frequencyBinCount || !freq)) buildBins(analyser)
      if (analyser && freq && playingRef.current) analyser.getByteFrequencyData(freq)

      ctx.clearRect(0, 0, width, height)
      /* Цвет темы перечитываем изредка: getComputedStyle на каждом кадре дорогой */
      if (++frame % 60 === 1) fallback = readFallback()
      const color = tintRef.current ?? fallback

      const gap = Math.max(2, width / bars / 3.2)
      const barW = Math.max(2, (width - gap * (bars - 1)) / bars)
      const mid = height / 2
      let peak = 0

      for (let i = 0; i < bars; i++) {
        let target = 0
        if (freq && playingRef.current && bins[i]) {
          const [a, b] = bins[i]
          let sum = 0
          for (let k = a; k < b; k++) sum += freq[k]
          /* Лёгкий подъём верхов — иначе правая половина почти всегда пустая */
          const tilt = 0.85 + (i / bars) * 0.45
          target = Math.min(1, (sum / (b - a) / 255) * tilt)
          target = Math.pow(target, 1.6)
        }
        const prev = levels[i]
        levels[i] = target > prev ? prev + (target - prev) * 0.55 : prev + (target - prev) * 0.12
        peak = Math.max(peak, levels[i])

        const h = Math.max(2, levels[i] * (height * 0.92))
        const x = i * (barW + gap)
        const alpha = 0.35 + levels[i] * 0.65
        ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(3)})`
        const r = Math.min(barW / 2, h / 2)
        ctx.beginPath()
        ctx.roundRect(x, mid - h / 2, barW, h, r)
        ctx.fill()
      }

      canvas.style.setProperty('--viz-energy', peak.toFixed(3))
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [getAnalyser, bars])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
