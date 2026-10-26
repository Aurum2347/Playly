import { customIdOf, type BuiltinParticle, type ParticleBehavior, type ParticleKind } from './appearance'
import { spriteFrame, type ParticleSprite } from './particleSprites'

/*
 * Частицы на фоне приложения. Всё рисуется на одном canvas: спрайты подготавливаются заранее,
 * поэтому даже сотни частиц стоят дёшево. Когда окно скрыто, анимация останавливается.
 * Размер поля берётся у самого canvas — так же работает и маленький предпросмотр в настройках.
 */

/* Своя частица, уже готовая к отрисовке */
export interface CustomSpec {
  behavior: ParticleBehavior
  count: number
  sprite: ParticleSprite
}

export interface FieldOptions {
  kind: ParticleKind
  density: number
  speed: number
  size: number
  opacity: number
  custom?: CustomSpec | null
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /* Размер (радиус или длина), px */
  r: number
  rot: number
  vr: number
  /* Фаза покачивания / мерцания */
  phase: number
  freq: number
  alpha: number
  sprite: number
  /* Для своих частиц с плавным появлением: возраст и срок жизни, с */
  age: number
  life: number
}

/* Сколько частиц на экран 1280×720 при плотности 1 */
const BASE_COUNT: Record<BuiltinParticle, number> = {
  snow: 140,
  sakura: 42,
  rain: 230,
  leaves: 26,
  stars: 170,
  fireflies: 38,
}

const FADE = 0.6
const MAX_DPR = 1.5
const EDGE = 60

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const DEG = Math.PI / 180

function makeSprite(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (ctx) draw(ctx, size)
  return c
}

function softDot(color: string, inner = 0.35) {
  return makeSprite(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, color)
    g.addColorStop(inner, color)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

function petal(from: string, to: string) {
  return makeSprite(64, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, s, s)
    g.addColorStop(0, from)
    g.addColorStop(1, to)
    ctx.fillStyle = g
    ctx.beginPath()
    /* Лепесток сакуры: округлый с выемкой на конце */
    ctx.moveTo(s * 0.5, s * 0.92)
    ctx.bezierCurveTo(s * 0.05, s * 0.7, s * 0.1, s * 0.15, s * 0.42, s * 0.1)
    ctx.lineTo(s * 0.5, s * 0.2)
    ctx.lineTo(s * 0.58, s * 0.1)
    ctx.bezierCurveTo(s * 0.9, s * 0.15, s * 0.95, s * 0.7, s * 0.5, s * 0.92)
    ctx.fill()
  })
}

function leaf(color: string, vein: string) {
  return makeSprite(64, (ctx, s) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(s * 0.5, s * 0.04)
    ctx.bezierCurveTo(s * 0.95, s * 0.3, s * 0.85, s * 0.8, s * 0.5, s * 0.96)
    ctx.bezierCurveTo(s * 0.15, s * 0.8, s * 0.05, s * 0.3, s * 0.5, s * 0.04)
    ctx.fill()
    ctx.strokeStyle = vein
    ctx.lineWidth = s * 0.035
    ctx.beginPath()
    ctx.moveTo(s * 0.5, s * 0.1)
    ctx.lineTo(s * 0.5, s * 0.92)
    ctx.stroke()
  })
}

let spriteCache: Record<string, HTMLCanvasElement[]> | null = null

function sprites() {
  if (spriteCache) return spriteCache
  spriteCache = {
    snow: [softDot('rgba(255,255,255,0.95)', 0.45)],
    sakura: [petal('#ffd6e3', '#ff9fbd'), petal('#ffe4ec', '#ffb3c9'), petal('#ffc2d6', '#f58db0')],
    leaves: [
      leaf('#e8833a', 'rgba(120,50,10,0.45)'),
      leaf('#d9552b', 'rgba(110,30,10,0.45)'),
      leaf('#e9b443', 'rgba(130,80,10,0.45)'),
      leaf('#b8642b', 'rgba(90,40,10,0.45)'),
    ],
    stars: [softDot('rgba(255,255,255,1)', 0.18), softDot('rgba(200,220,255,1)', 0.18)],
    fireflies: [softDot('rgba(220,255,120,1)', 0.12), softDot('rgba(255,236,140,1)', 0.12)],
  }
  return spriteCache
}

export class ParticleField {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private opts: FieldOptions = { kind: 'none', density: 1, speed: 1, size: 1, opacity: 0.8 }
  /* Эффект, который сейчас на экране (во время смены — уходящий), и его своя частица */
  private shown: ParticleKind = 'none'
  private shownCustom: CustomSpec | null = null
  private particles: Particle[] = []
  /* 0..1 — общая прозрачность при плавной смене эффекта */
  private fade = 0
  private raf = 0
  private last = 0
  private w = 0
  private h = 0
  private dpr = 1
  private time = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    this.ctx = ctx
    this.resize()
  }

  configure(next: FieldOptions) {
    const prev = this.opts
    this.opts = next
    const sameKind = next.kind === this.shown
    if (sameKind && next.custom && next.custom !== this.shownCustom) {
      /* Поменяли настройки своей частицы — пересоздаём её без затухания */
      this.shownCustom = next.custom
      this.particles = []
      this.fillTo(this.targetCount())
    } else if (sameKind && (next.density !== prev.density || next.size !== prev.size)) {
      this.particles = []
      this.fillTo(this.targetCount())
    }
    this.ensureRunning()
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    this.w = this.canvas.clientWidth || window.innerWidth
    this.h = this.canvas.clientHeight || window.innerHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    if (this.shown !== 'none') this.fillTo(this.targetCount())
    this.ensureRunning()
  }

  /** Остановить анимацию (окно скрыто) или продолжить */
  setPaused(paused: boolean) {
    if (paused) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else {
      this.ensureRunning()
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private isCustom() {
    return customIdOf(this.shown) !== null
  }

  private targetCount(): number {
    if (this.shown === 'none') return 0
    const area = (this.w * this.h) / (1280 * 720)
    const base = this.isCustom() ? this.shownCustom?.count ?? 0 : BASE_COUNT[this.shown as BuiltinParticle]
    return Math.round(base * this.opts.density * Math.max(0.15, area))
  }

  private fillTo(n: number) {
    if (this.particles.length > n) this.particles.length = n
    while (this.particles.length < n) this.particles.push(this.spawn(true))
  }

  private ensureRunning() {
    if (this.raf || document.hidden) return
    if (this.shown === 'none' && this.opts.kind === 'none') {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      return
    }
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private blank(): Particle {
    return {
      x: rand(0, this.w),
      y: rand(0, this.h),
      vx: 0,
      vy: 0,
      r: 3,
      rot: rand(0, Math.PI * 2),
      vr: 0,
      phase: rand(0, Math.PI * 2),
      freq: rand(0.4, 1.2),
      alpha: 1,
      sprite: 0,
      age: 0,
      life: 0,
    }
  }

  /* initial — разбросать по всему экрану, а не только у края */
  private spawn(initial: boolean): Particle {
    if (this.isCustom()) return this.spawnCustom(initial)
    const k = this.shown as BuiltinParticle
    const s = this.opts.size
    const list = sprites()[k] ?? []
    const p = this.blank()
    p.y = initial ? rand(0, this.h) : rand(-60, -10)
    p.sprite = Math.floor(Math.random() * Math.max(1, list.length))
    switch (k) {
      case 'snow': {
        const depth = Math.random()
        p.r = (1.2 + depth * 3.2) * s
        p.vy = 25 + depth * 55
        p.vx = rand(-8, 8)
        p.alpha = 0.45 + depth * 0.55
        break
      }
      case 'sakura':
        p.r = rand(7, 13) * s
        p.vy = rand(28, 55)
        p.vx = rand(10, 35)
        p.vr = rand(-1.6, 1.6)
        p.alpha = rand(0.75, 1)
        break
      case 'leaves':
        p.r = rand(11, 19) * s
        p.vy = rand(35, 70)
        p.vx = rand(-15, 25)
        p.vr = rand(-1.4, 1.4)
        p.alpha = rand(0.8, 1)
        break
      case 'rain':
        p.r = rand(12, 26) * s
        p.vy = rand(650, 950)
        p.vx = -p.vy * 0.12
        p.alpha = rand(0.25, 0.6)
        if (!initial) p.y = rand(-120, -20)
        break
      case 'stars':
        p.r = rand(0.6, 2) * s
        p.y = rand(0, this.h)
        p.freq = rand(0.3, 1.4)
        p.alpha = rand(0.4, 1)
        break
      case 'fireflies':
        p.r = rand(2, 4) * s
        p.y = rand(this.h * 0.25, this.h)
        p.vx = rand(-12, 12)
        p.vy = rand(-10, 10)
        p.freq = rand(0.5, 1.5)
        break
    }
    return p
  }

  /* ===== Свои частицы ===== */

  private spawnCustom(initial: boolean): Particle {
    const spec = this.shownCustom
    const p = this.blank()
    if (!spec) return p
    const b = spec.behavior
    p.r = (rand(b.sizeMin, b.sizeMax) / 2) * this.opts.size
    p.alpha = rand(b.opacityMin, b.opacityMax)
    p.vr = rand(-b.spin, b.spin) * Math.PI * 2
    p.freq = b.swayFreq * rand(0.7, 1.3)
    p.phase = rand(0, 1000)
    const speed = rand(b.speedMin, b.speedMax)
    switch (b.motion) {
      case 'flow': {
        const a = (b.direction + rand(-b.spread, b.spread)) * DEG
        /* 0° — вниз, 90° — вправо */
        p.vx = Math.sin(a) * speed
        p.vy = Math.cos(a) * speed
        if (!initial) this.placeAtEntry(p)
        break
      }
      case 'float': {
        const a = rand(0, Math.PI * 2)
        p.vx = Math.cos(a) * speed * 0.3
        p.vy = Math.sin(a) * speed * 0.3
        p.life = rand(4, 10)
        p.age = initial ? rand(0, p.life) : 0
        break
      }
      case 'twinkle':
        p.life = rand(2, 6)
        p.age = initial ? rand(0, p.life) : 0
        break
      case 'wander':
        p.vx = rand(-1, 1) * speed * 0.4
        p.vy = rand(-1, 1) * speed * 0.4
        p.life = rand(5, 12)
        p.age = initial ? rand(0, p.life) : 0
        break
    }
    return p
  }

  /* Новая частица потока появляется у края, откуда «приходит» поток */
  private placeAtEntry(p: Particle) {
    const x = rand(0, this.w)
    const y = rand(0, this.h)
    const sp = Math.hypot(p.vx, p.vy) || 1
    const dx = p.vx / sp
    const dy = p.vy / sp
    const m = EDGE + p.r * 2
    const tx = dx > 0.001 ? (x + m) / dx : dx < -0.001 ? (this.w + m - x) / -dx : Infinity
    const ty = dy > 0.001 ? (y + m) / dy : dy < -0.001 ? (this.h + m - y) / -dy : Infinity
    const t = Math.min(tx, ty)
    p.x = x - dx * t
    p.y = y - dy * t
  }

  private stepCustom(p: Particle, i: number, dt: number) {
    const b = this.shownCustom?.behavior
    if (!b) return
    p.rot += p.vr * dt
    const { w, h } = this
    const m = EDGE + p.r * 2
    switch (b.motion) {
      case 'flow':
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.x < -m * 1.5 || p.x > w + m * 1.5 || p.y < -m * 1.5 || p.y > h + m * 1.5) this.particles[i] = this.spawn(false)
        return
      case 'wander': {
        const lim = Math.max(10, b.speedMax * 0.5)
        p.vx = Math.max(-lim, Math.min(lim, p.vx + rand(-1, 1) * lim * dt * 2))
        p.vy = Math.max(-lim, Math.min(lim, p.vy + rand(-1, 1) * lim * dt * 2))
        p.x += p.vx * dt
        p.y += p.vy * dt
        break
      }
      case 'float':
        p.x += p.vx * dt
        p.y += p.vy * dt
        break
      case 'twinkle':
        break
    }
    /* Парящие и блуждающие не улетают за край: выходят с другой стороны */
    if (p.x < -m) p.x = w + m
    else if (p.x > w + m) p.x = -m
    if (p.y < -m) p.y = h + m
    else if (p.y > h + m) p.y = -m
    p.age += dt
    if (p.life > 0 && p.age >= p.life) this.particles[i] = this.spawn(false)
  }

  private drawCustom(base: number) {
    const spec = this.shownCustom
    if (!spec) return
    const { ctx } = this
    const b = spec.behavior
    ctx.imageSmoothingEnabled = spec.sprite.smoothing !== 'pixelated'
    for (const p of this.particles) {
      let a = p.alpha
      if (p.life > 0 && b.fade) a *= Math.sin(Math.PI * Math.min(1, p.age / p.life))
      if (b.motion === 'twinkle') a *= 0.5 + 0.5 * Math.sin(this.time * p.freq * 3 + p.phase)
      if (a <= 0.01) continue
      const frame = spriteFrame(spec.sprite, this.time * 1000 + p.phase * 97)
      const k = (p.r * 2) / Math.max(frame.w, frame.h)
      const dw = frame.w * k
      const dh = frame.h * k
      /* Покачивание поперёк направления движения */
      let ox = 0
      let oy = 0
      if (b.sway > 0 && b.motion === 'flow') {
        const sp = Math.hypot(p.vx, p.vy) || 1
        const off = Math.sin(this.time * p.freq * 2 + p.phase) * b.sway
        ox = (-p.vy / sp) * off
        oy = (p.vx / sp) * off
      }
      ctx.globalAlpha = Math.min(1, a * base)
      ctx.save()
      ctx.translate(p.x + ox, p.y + oy)
      if (p.vr !== 0) ctx.rotate(p.rot)
      if (b.flip) ctx.scale(0.3 + 0.7 * Math.abs(Math.cos(this.time * p.freq * 2 + p.phase)), 1)
      ctx.drawImage(frame.image, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    }
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = 1
  }

  /* ===== Кадр ===== */

  private frame = (now: number) => {
    this.raf = 0
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    /* Плавная смена эффекта: сначала гаснет старый, потом проявляется новый */
    if (this.shown !== this.opts.kind) {
      this.fade = Math.max(0, this.fade - dt / FADE)
      if (this.fade === 0) {
        this.shown = this.opts.kind
        this.shownCustom = this.opts.custom ?? null
        this.particles = []
        this.fillTo(this.targetCount())
      }
    } else if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / FADE)
    }

    this.step(dt * this.opts.speed)
    this.draw()

    if (this.shown === 'none' && this.opts.kind === 'none') return
    if (!document.hidden) this.raf = requestAnimationFrame(this.frame)
  }

  private step(dt: number) {
    const { w, h } = this
    const custom = this.isCustom()
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (custom) {
        this.stepCustom(p, i, dt)
        continue
      }
      switch (this.shown) {
        case 'snow':
          p.x += (p.vx + Math.sin(this.time * p.freq + p.phase) * 14) * dt
          p.y += p.vy * dt
          break
        case 'sakura':
        case 'leaves':
          p.x += (p.vx + Math.sin(this.time * p.freq * 1.6 + p.phase) * 30) * dt
          p.y += p.vy * dt
          p.rot += p.vr * dt
          break
        case 'rain':
          p.x += p.vx * dt
          p.y += p.vy * dt
          break
        case 'stars':
          break
        case 'fireflies':
          p.vx += rand(-20, 20) * dt
          p.vy += rand(-20, 20) * dt
          p.vx = Math.max(-25, Math.min(25, p.vx))
          p.vy = Math.max(-25, Math.min(25, p.vy))
          p.x += p.vx * dt
          p.y += p.vy * dt
          if (p.x < -20) p.x = w + 20
          if (p.x > w + 20) p.x = -20
          if (p.y < -20) p.y = h + 20
          if (p.y > h + 20) p.y = -20
          break
      }
      if (this.shown === 'snow' || this.shown === 'sakura' || this.shown === 'leaves' || this.shown === 'rain') {
        if (p.y > h + 40 || p.x < -80 || p.x > w + 80) this.particles[i] = this.spawn(false)
      }
    }
  }

  private draw() {
    const { ctx, dpr } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (this.shown === 'none' || this.fade === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const base = this.opts.opacity * this.fade

    if (this.isCustom()) {
      this.drawCustom(base)
      return
    }

    const list = sprites()[this.shown] ?? []

    if (this.shown === 'rain') {
      ctx.lineCap = 'round'
      ctx.lineWidth = 1.1 * this.opts.size
      ctx.strokeStyle = `rgba(185, 205, 255, ${0.55 * base})`
      ctx.beginPath()
      for (const p of this.particles) {
        const k = p.r / p.vy
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k)
      }
      ctx.stroke()
      return
    }

    for (const p of this.particles) {
      let a = p.alpha
      if (this.shown === 'stars') a *= 0.55 + 0.45 * Math.sin(this.time * p.freq * 2 + p.phase)
      if (this.shown === 'fireflies') a *= Math.max(0, Math.sin(this.time * p.freq + p.phase)) ** 2
      if (a <= 0.01) continue
      ctx.globalAlpha = Math.min(1, a * base)
      const img = list[p.sprite] ?? list[0]
      if (!img) continue
      if (this.shown === 'sakura' || this.shown === 'leaves') {
        /* Поворот и «переворот» в полёте: сжатие по ширине создаёт ощущение объёма */
        const flip = Math.cos(this.time * p.freq * 2 + p.phase)
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.scale(0.35 + 0.65 * Math.abs(flip), 1)
        ctx.drawImage(img, -p.r, -p.r, p.r * 2, p.r * 2)
        ctx.restore()
      } else {
        /* Мягкие светящиеся точки: спрайт чуть больше самой частицы */
        const d = p.r * (this.shown === 'fireflies' ? 7 : this.shown === 'stars' ? 5 : 2.4)
        ctx.drawImage(img, p.x - d / 2, p.y - d / 2, d, d)
      }
    }
    ctx.globalAlpha = 1
  }
}
