import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { DEFAULT_FRAME, normalizeFrame, type ImageFrame } from './imageFrame'

/* ===== Фон приложения ===== */

/* Нет фона, своя картинка (можно GIF) или обложка играющего трека */
export type BackdropMode = 'none' | 'image' | 'cover'

export interface AppBackdrop {
  mode: BackdropMode
  /* Имя файла в папке playly/background */
  file: string | null
  /* blob-url картинки; в settings.json не сохраняется */
  url?: string | null
  frame: ImageFrame
  /* Размытие, px */
  blur: number
  /* Затемнение 0–0.9 */
  dim: number
  /* Виньетка 0–1 */
  vignette: number
  /* Насыщенность и яркость, % */
  saturation: number
  brightness: number
  /* Насколько плотные панели интерфейса поверх фона, 0.2–1 */
  uiOpacity: number
}

export const BACKDROP_DEFAULTS: Record<Exclude<BackdropMode, 'none'>, Omit<AppBackdrop, 'mode' | 'file' | 'url' | 'frame'>> = {
  image: { blur: 0, dim: 0.45, vignette: 0.45, saturation: 100, brightness: 100, uiOpacity: 0.55 },
  /* Обложка маленькая — её сильно размываем, чтобы получилось мягкое цветное пятно */
  cover: { blur: 60, dim: 0.5, vignette: 0.5, saturation: 140, brightness: 95, uiOpacity: 0.5 },
}

export const DEFAULT_BACKDROP: AppBackdrop = {
  mode: 'none',
  file: null,
  frame: DEFAULT_FRAME,
  ...BACKDROP_DEFAULTS.image,
}

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

export function normalizeBackdrop(raw: unknown): AppBackdrop {
  const r = (raw ?? {}) as Partial<AppBackdrop>
  const file = typeof r.file === 'string' && r.file ? r.file : null
  const mode: BackdropMode = r.mode === 'cover' ? 'cover' : r.mode === 'image' && file ? 'image' : 'none'
  const d = mode === 'cover' ? BACKDROP_DEFAULTS.cover : BACKDROP_DEFAULTS.image
  return {
    mode,
    file,
    frame: normalizeFrame(r.frame),
    blur: num(r.blur, 0, 80, d.blur),
    dim: num(r.dim, 0, 0.9, d.dim),
    vignette: num(r.vignette, 0, 1, d.vignette),
    saturation: num(r.saturation, 0, 200, d.saturation),
    brightness: num(r.brightness, 40, 160, d.brightness),
    uiOpacity: num(r.uiOpacity, 0.2, 1, d.uiOpacity),
  }
}

async function backgroundDir(): Promise<string> {
  const dir = await join(await appDataDir(), 'playly', 'background')
  await mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}

const mimeOf = (name: string) => {
  switch (name.split('.').pop()?.toLowerCase()) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    default: return 'image/jpeg'
  }
}

export async function loadBackdropUrl(file: string | null): Promise<string | null> {
  if (!file) return null
  try {
    const path = await join(await backgroundDir(), file)
    if (!(await exists(path))) return null
    return URL.createObjectURL(new Blob([(await readFile(path)) as unknown as BlobPart], { type: mimeOf(file) }))
  } catch {
    return null
  }
}

/** Сохраняет новую картинку фона и удаляет прежнюю; возвращает имя файла */
export async function saveBackdropImage(bytes: Uint8Array, ext: string, previous: string | null): Promise<string> {
  const dir = await backgroundDir()
  const name = `bg-${Date.now()}.${ext}`
  await writeFile(await join(dir, name), bytes)
  if (previous && previous !== name) {
    const old = await join(dir, previous)
    if (await exists(old)) await remove(old).catch(() => {})
  }
  return name
}

export async function removeBackdropImage(file: string | null): Promise<void> {
  if (!file) return
  try {
    const path = await join(await backgroundDir(), file)
    if (await exists(path)) await remove(path)
  } catch {
    /* файла уже нет */
  }
}

/* ===== Частицы ===== */

export type BuiltinParticle = 'snow' | 'sakura' | 'rain' | 'leaves' | 'stars' | 'fireflies'
export const BUILTIN_PARTICLES: BuiltinParticle[] = ['snow', 'sakura', 'rain', 'leaves', 'stars', 'fireflies']

/* Эффект: 'none', встроенный или свой — 'custom:<id>' */
export type ParticleKind = 'none' | BuiltinParticle | `custom:${string}`
export const PARTICLE_KINDS: ParticleKind[] = ['none', ...BUILTIN_PARTICLES]

export const customKind = (id: string): ParticleKind => `custom:${id}`
export const customIdOf = (kind: ParticleKind): string | null => (kind.startsWith('custom:') ? kind.slice(7) : null)

/* ===== Свои частицы ===== */

/* Как движутся: потоком в одну сторону, парят на месте, мерцают или блуждают, как светлячки */
export type ParticleMotion = 'flow' | 'float' | 'twinkle' | 'wander'
export const PARTICLE_MOTIONS: ParticleMotion[] = ['flow', 'float', 'twinkle', 'wander']

export type ParticleShape = 'dot' | 'glow' | 'star' | 'heart' | 'note' | 'square'
export const PARTICLE_SHAPES: ParticleShape[] = ['dot', 'glow', 'star', 'heart', 'note', 'square']

/* Масштабирование картинки: плавное или «ближайший сосед» (для пиксель-арта) */
export type ParticleSmoothing = 'smooth' | 'pixelated'

export type ParticleSource =
  | { type: 'shape'; shape: ParticleShape; color: string }
  | { type: 'image'; file: string; smoothing: ParticleSmoothing }

export interface ParticleBehavior {
  motion: ParticleMotion
  /* Направление потока, градусы: 0 — вниз, 90 — вправо, 180 — вверх, -90 — влево */
  direction: number
  /* Разброс направления, ± градусы */
  spread: number
  speedMin: number
  speedMax: number
  sizeMin: number
  sizeMax: number
  /* Покачивание поперёк движения: амплитуда (px) и частота */
  sway: number
  swayFreq: number
  /* Вращение, оборотов в секунду (наибольшее) */
  spin: number
  /* «Переворот» в полёте, как у лепестков */
  flip: boolean
  opacityMin: number
  opacityMax: number
  /* Плавное появление и исчезновение (для парящих, мерцающих и блуждающих) */
  fade: boolean
}

export interface CustomParticle {
  id: string
  name: string
  source: ParticleSource
  behavior: ParticleBehavior
  /* Сколько частиц на экран 1280×720 при плотности 100 % */
  count: number
}

export const DEFAULT_BEHAVIOR: ParticleBehavior = {
  motion: 'flow',
  direction: 0,
  spread: 10,
  speedMin: 30,
  speedMax: 70,
  sizeMin: 8,
  sizeMax: 16,
  sway: 20,
  swayFreq: 0.8,
  spin: 0.3,
  flip: false,
  opacityMin: 0.6,
  opacityMax: 1,
  fade: true,
}

export function newCustomParticle(name: string): CustomParticle {
  return {
    id: Date.now().toString(36),
    name,
    source: { type: 'shape', shape: 'star', color: '#ffe08a' },
    behavior: { ...DEFAULT_BEHAVIOR },
    count: 60,
  }
}

/* Правило: пока играет один из этих треков, вместо обычного эффекта — свой */
export interface ParticleRule {
  id: string
  kind: ParticleKind
  trackIds: number[]
}

/* Порыв ветра: direction — куда дует (0° вниз, 90° вправо), duration — секунды, strength — пкс/с */
export interface WindPhase {
  direction: number
  duration: number
  strength: number
}

export const WIND_MAX_PHASES = 5
export const WIND_LIMITS = {
  duration: { min: 1, max: 120 },
  strength: { min: 0, max: 150 },
} as const

function normalizeWind(raw: unknown): WindPhase[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .slice(0, WIND_MAX_PHASES)
    .map((p) => {
      /* В ранней версии сила умножалась на отдельную «скорость»: переносим её в силу */
      const legacy = typeof p.speed === 'number' && Number.isFinite(p.speed) ? Math.max(0.1, Math.min(3, p.speed)) : 1
      const strength = typeof p.strength === 'number' && Number.isFinite(p.strength) ? p.strength * legacy : 20
      return {
        direction: Math.round(num(p.direction, 0, 360, 90)) % 360,
        duration: Math.round(num(p.duration, WIND_LIMITS.duration.min, WIND_LIMITS.duration.max, 8)),
        strength: Math.round(num(strength, WIND_LIMITS.strength.min, WIND_LIMITS.strength.max, 20)),
      }
    })
}

export interface ParticleSettings {
  wind?: WindPhase[]
  /* Эффект по умолчанию */
  kind: ParticleKind
  /* Множители: 1 — обычное значение */
  density: number
  speed: number
  size: number
  opacity: number
  /* Размытие слоя частиц, px — «глубина резкости» */
  blur: number
  /* Показывать частицы только во время воспроизведения */
  onlyWhilePlaying: boolean
  rules: ParticleRule[]
  custom: CustomParticle[]
}

export const DEFAULT_PARTICLES: ParticleSettings = {
  kind: 'none',
  density: 1,
  speed: 1,
  size: 1,
  opacity: 0.8,
  blur: 0,
  onlyWhilePlaying: false,
  rules: [],
  custom: [],
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

function normalizeCustom(raw: unknown): CustomParticle | null {
  const r = raw as Partial<CustomParticle> | null
  if (!r || typeof r.id !== 'string' || !r.id) return null
  const s = (r.source ?? {}) as Partial<ParticleSource> & Record<string, unknown>
  let source: ParticleSource
  if (s.type === 'image' && typeof s.file === 'string' && s.file) {
    source = { type: 'image', file: s.file, smoothing: s.smoothing === 'pixelated' ? 'pixelated' : 'smooth' }
  } else {
    source = {
      type: 'shape',
      shape: PARTICLE_SHAPES.includes(s.shape as ParticleShape) ? (s.shape as ParticleShape) : 'dot',
      color: isColor(s.color) ? s.color : '#ffffff',
    }
  }
  const b = (r.behavior ?? {}) as Partial<ParticleBehavior>
  const d = DEFAULT_BEHAVIOR
  const speedMin = num(b.speedMin, 0, 1200, d.speedMin)
  const sizeMin = num(b.sizeMin, 1, 160, d.sizeMin)
  const opacityMin = num(b.opacityMin, 0.05, 1, d.opacityMin)
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Particles',
    source,
    behavior: {
      motion: PARTICLE_MOTIONS.includes(b.motion as ParticleMotion) ? (b.motion as ParticleMotion) : d.motion,
      direction: num(b.direction, -180, 180, d.direction),
      spread: num(b.spread, 0, 90, d.spread),
      speedMin,
      speedMax: Math.max(speedMin, num(b.speedMax, 0, 1200, d.speedMax)),
      sizeMin,
      sizeMax: Math.max(sizeMin, num(b.sizeMax, 1, 160, d.sizeMax)),
      sway: num(b.sway, 0, 120, d.sway),
      swayFreq: num(b.swayFreq, 0.05, 4, d.swayFreq),
      spin: num(b.spin, 0, 3, d.spin),
      flip: b.flip === true,
      opacityMin,
      opacityMax: Math.max(opacityMin, num(b.opacityMax, 0.05, 1, d.opacityMax)),
      fade: b.fade !== false,
    },
    count: num(r.count, 2, 400, 60),
  }
}

export function normalizeParticles(raw: unknown): ParticleSettings {
  const r = (raw ?? {}) as Partial<ParticleSettings>
  const custom = Array.isArray(r.custom) ? r.custom.map(normalizeCustom).filter((x): x is CustomParticle => !!x) : []
  const ids = new Set(custom.map((c) => c.id))
  /* Свой эффект мог быть удалён — тогда ссылки на него не действуют */
  const valid = (k: unknown): k is ParticleKind => {
    if (typeof k !== 'string') return false
    const id = customIdOf(k as ParticleKind)
    return id !== null ? ids.has(id) : PARTICLE_KINDS.includes(k as ParticleKind)
  }
  const rules = Array.isArray(r.rules)
    ? r.rules
        .filter((x): x is ParticleRule => !!x && valid(x.kind) && Array.isArray(x.trackIds))
        .map((x) => ({
          id: typeof x.id === 'string' && x.id ? x.id : `r${Math.random().toString(36).slice(2, 9)}`,
          kind: x.kind,
          trackIds: x.trackIds.filter((id) => typeof id === 'number'),
        }))
    : []
  return {
    wind: normalizeWind(r.wind),
    kind: valid(r.kind) ? r.kind : 'none',
    density: num(r.density, 0.25, 3, 1),
    speed: num(r.speed, 0.25, 3, 1),
    size: num(r.size, 0.5, 2, 1),
    opacity: num(r.opacity, 0.1, 1, 0.8),
    blur: num(r.blur, 0, 12, 0),
    onlyWhilePlaying: r.onlyWhilePlaying === true,
    rules,
    custom,
  }
}

/** Какой эффект показывать сейчас: правило для играющего трека важнее эффекта по умолчанию */
export function activeParticleKind(p: ParticleSettings, trackId: number | null, isPlaying: boolean): ParticleKind {
  if (p.onlyWhilePlaying && !isPlaying) return 'none'
  if (trackId !== null) {
    const rule = p.rules.find((r) => r.trackIds.includes(trackId))
    if (rule) return rule.kind
  }
  return p.kind
}

/* ===== Картинки своих частиц: папка playly/particles ===== */

export async function particlesDir(): Promise<string> {
  const dir = await join(await appDataDir(), 'playly', 'particles')
  await mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}

export async function saveParticleImage(bytes: Uint8Array, ext: string): Promise<string> {
  const name = `p-${Date.now().toString(36)}.${ext}`
  await writeFile(await join(await particlesDir(), name), bytes)
  return name
}

export async function removeParticleImage(file: string): Promise<void> {
  try {
    const path = await join(await particlesDir(), file)
    if (await exists(path)) await remove(path)
  } catch {
    /* файла уже нет */
  }
}
