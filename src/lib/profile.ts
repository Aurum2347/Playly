import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readFile, readTextFile, remove, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { DEFAULT_FRAME, normalizeFrame, type ImageFrame } from './imageFrame'
import { pickVisual, type GifPurpose } from './media'

export type AvatarShape = 'circle' | 'square'

/* Фон карточки и баннер профиля: ничего, своя картинка (можно GIF) или градиент */
export type LookMode = 'none' | 'image' | 'gradient'
/* С какого края картинка плавно исчезает */
export type FadeEdge = 'none' | 'left' | 'right' | 'both'
/* Где картинка размыта */
export type BlurEdge = FadeEdge | 'all'

export type LookKind = 'card' | 'banner'

export interface LookGradient {
  from: string
  to: string
  /* Направление, градусы */
  angle: number
}

export interface ProfileLook {
  mode: LookMode
  /* Имя файла в папке profile */
  file: string | null
  /* Загруженная картинка (blob-url); в profile.json не сохраняется */
  url?: string | null
  frame: ImageFrame
  gradient: LookGradient
  fade: FadeEdge
  /* Ширина зоны исчезновения от края, % */
  fadeSize: number
  blur: BlurEdge
  /* Ширина зоны размытия от края, % */
  blurSize: number
  /* Сила размытия, px */
  blurAmount: number
  /* Затемнение для читаемости текста, 0–0.8 */
  dim: number
}

/* Новая картинка ещё не записана на диск: файл появится только после «Сохранить» */
export interface PendingImage {
  bytes: Uint8Array
  ext: string
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export const LOOK_DEFAULTS: Record<LookKind, ProfileLook> = {
  card: {
    mode: 'none',
    file: null,
    frame: DEFAULT_FRAME,
    gradient: { from: '#5865f2', to: '#eb459e', angle: 120 },
    fade: 'left',
    fadeSize: 70,
    blur: 'none',
    blurSize: 50,
    blurAmount: 6,
    dim: 0.3,
  },
  banner: {
    mode: 'none',
    file: null,
    frame: DEFAULT_FRAME,
    gradient: { from: '#5865f2', to: '#eb459e', angle: 135 },
    fade: 'none',
    fadeSize: 60,
    blur: 'none',
    blurSize: 50,
    blurAmount: 10,
    dim: 0,
  },
}

/* Всё, что нужно для предпросмотра оформления профиля */
export interface ProfileLooks {
  card: ProfileLook | null
  banner: ProfileLook | null
  avatarUrl: string | null
  avatarShape: AvatarShape
  avatarFrame: ImageFrame
}

export interface ProfileFile {
  avatarFile?: string
  avatarShape?: AvatarShape
  avatarFrame?: ImageFrame
  card?: Omit<ProfileLook, 'url'>
  banner?: Omit<ProfileLook, 'url'>
}

export function imageMime(path: string): string {
  switch (path.split('.').pop()?.toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

export function bytesToUrl(bytes: Uint8Array, ext: string): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: imageMime(`a.${ext}`) }))
}

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export function normalizeLook(raw: unknown, kind: LookKind): ProfileLook {
  const d = LOOK_DEFAULTS[kind]
  const r = (raw ?? {}) as Partial<ProfileLook>
  const g = (r.gradient ?? {}) as Partial<LookGradient>
  const file = typeof r.file === 'string' && r.file ? r.file : null
  const mode: LookMode = r.mode === 'gradient' ? 'gradient' : r.mode === 'image' && file ? 'image' : 'none'
  return {
    mode,
    file,
    frame: normalizeFrame(r.frame),
    gradient: {
      from: isColor(g.from) ? g.from : d.gradient.from,
      to: isColor(g.to) ? g.to : d.gradient.to,
      angle: clamp(g.angle, 0, 360, d.gradient.angle),
    },
    fade: (['none', 'left', 'right', 'both'] as const).includes(r.fade as FadeEdge) ? (r.fade as FadeEdge) : d.fade,
    fadeSize: clamp(r.fadeSize, 10, 100, d.fadeSize),
    blur: (['none', 'left', 'right', 'both', 'all'] as const).includes(r.blur as BlurEdge) ? (r.blur as BlurEdge) : d.blur,
    blurSize: clamp(r.blurSize, 10, 100, d.blurSize),
    blurAmount: clamp(r.blurAmount, 1, 40, d.blurAmount),
    dim: clamp(r.dim, 0, 0.8, d.dim),
  }
}

export const gradientCss = (g: LookGradient) => `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`

/** Есть ли что показывать: выбран градиент или картинка уже загружена */
export const lookVisible = (look: ProfileLook | null | undefined): look is ProfileLook =>
  !!look && (look.mode === 'gradient' || (look.mode === 'image' && !!look.url))

/* ===== profile.json ===== */

let profileDirCache: string | null = null

export async function getProfileDir(): Promise<string> {
  if (profileDirCache) return profileDirCache
  const dir = await join(await appDataDir(), 'playly', 'profile')
  await mkdir(dir, { recursive: true })
  profileDirCache = dir
  return dir
}

export async function readProfileFile(): Promise<ProfileFile> {
  try {
    const path = await join(await getProfileDir(), 'profile.json')
    if (!(await exists(path))) return {}
    return JSON.parse(await readTextFile(path)) as ProfileFile
  } catch {
    return {}
  }
}

/* Правки profile.json идут по очереди: две одновременные («прочитать, поправить, записать») затирали друг друга */
let profileQueue: Promise<void> = Promise.resolve()

/** Сливает patch в profile.json; null удаляет поле */
export function patchProfileFile(patch: { [K in keyof ProfileFile]?: ProfileFile[K] | null }): Promise<void> {
  const job = profileQueue.catch(() => {}).then(async () => {
    const current = (await readProfileFile()) as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete current[key]
      else if (value !== undefined) current[key] = value
    }
    await writeTextFile(await join(await getProfileDir(), 'profile.json'), JSON.stringify(current, null, 2))
  })
  profileQueue = job
  return job
}

export function notifyProfileUpdated() {
  window.dispatchEvent(new Event('playly-profile-updated'))
}

/** Файл из папки profile как blob-url (или null, если его нет) */
export async function loadProfileImage(file: string | null | undefined): Promise<string | null> {
  if (!file) return null
  try {
    const path = file.includes('/') || file.includes('\\') ? file : await join(await getProfileDir(), file)
    if (!(await exists(path))) return null
    return bytesToUrl(await readFile(path), path.split('.').pop() ?? 'png')
  } catch {
    return null
  }
}

/**
 * Выбор картинки для фона (видео превращается в GIF): читается в память,
 * на диск попадёт только при сохранении
 */
export async function pickImage(
  filterName: string,
  purpose: GifPurpose = 'banner'
): Promise<(PendingImage & { url: string }) | null> {
  const picked = await pickVisual({ filterName, purpose, maxBytes: MAX_IMAGE_BYTES })
  if (!picked) return null
  return { bytes: picked.bytes, ext: picked.ext, url: bytesToUrl(picked.bytes, picked.ext) }
}

/**
 * Сохраняет фон карточки или баннер. Новая картинка пишется под уникальным именем,
 * а старая удаляется только после того, как profile.json уже ссылается на новую.
 */
export async function saveLook(kind: LookKind, look: ProfileLook, pending: PendingImage | null): Promise<void> {
  const dir = await getProfileDir()
  const before = normalizeLook((await readProfileFile())[kind], kind)
  let file = look.file
  if (pending) {
    file = `${kind}-${Date.now()}.${pending.ext}`
    await writeFile(await join(dir, file), pending.bytes)
  }
  if (look.mode !== 'image') file = null
  const stored: Omit<ProfileLook, 'url'> = { ...look, file, mode: look.mode === 'image' && !file ? 'none' : look.mode }
  delete (stored as Partial<ProfileLook>).url
  await patchProfileFile({ [kind]: stored })

  if (before.file && before.file !== file) {
    const oldPath = await join(dir, before.file)
    if (await exists(oldPath)) await remove(oldPath).catch(() => {})
  }
  notifyProfileUpdated()
}
