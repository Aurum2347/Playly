import { useEffect, type RefObject } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readFile, readTextFile, writeTextFile, mkdir, remove } from '@tauri-apps/plugin-fs'

/* ===== Служебные флаги (не трогать) ===== */
export const DEBUG_DIAGNOSTICS_SCREEN = true

export type ThemeMode = 'dark' | 'light' | 'system'

export interface CustomFontSetting {
  file: string
  name: string
}

export const CUSTOM_FONT_FAMILY = 'PlaylyCustomFont'

export function imageMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

export const sliderPercent = (val: number, min: number, max: number) =>
  ((val - min) / (max - min)) * 100

/* ===== settings.json ===== */
export async function getSettingsPath(): Promise<string> {
  const appDir = await appDataDir()
  const playlyDir = await join(appDir, 'playly')
  try {
    await mkdir(playlyDir, { recursive: true })
  } catch {
    // папка уже может существовать
  }
  return await join(playlyDir, 'settings.json')
}

export async function readSettingsRaw(): Promise<Record<string, unknown>> {
  try {
    const path = await getSettingsPath()
    if (!(await exists(path))) return {}
    return JSON.parse(await readTextFile(path)) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Сливает patch в settings.json, не затирая остальные поля */
export async function writeSettingsRaw(patch: Record<string, unknown>): Promise<void> {
  try {
    const current = await readSettingsRaw()
    const next = { ...current, ...patch }
    await writeTextFile(await getSettingsPath(), JSON.stringify(next, null, 2))
  } catch (e) {
    console.error('Не удалось сохранить настройки:', e)
  }
}

export async function removeSettingsKeys(keys: string[]): Promise<void> {
  try {
    const current = await readSettingsRaw()
    keys.forEach((k) => delete current[k])
    await writeTextFile(await getSettingsPath(), JSON.stringify(current, null, 2))
  } catch (e) {
    console.error('Не удалось сохранить настройки:', e)
  }
}

/* ===== Тема ===== */
export async function loadThemeSetting(): Promise<ThemeMode> {
  const data = await readSettingsRaw()
  if (data.theme === 'light' || data.theme === 'system') return data.theme
  return 'dark'
}

export async function saveThemeSetting(theme: ThemeMode): Promise<void> {
  await writeSettingsRaw({ theme })
}

export function getResolvedTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    return 'dark'
  }
  return theme
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return
  try {
    localStorage.setItem('playly-theme-cache', theme)
  } catch {
    // ignore
  }
  document.documentElement.dataset.theme = getResolvedTheme(theme)
}

/* ===== Свой шрифт ===== */
let fontsDirCache: string | null = null

export async function getFontsDir(): Promise<string> {
  if (fontsDirCache) return fontsDirCache
  const appDir = await appDataDir()
  const playlyDir = await join(appDir, 'playly')
  const fontsDir = await join(playlyDir, 'fonts')
  await mkdir(fontsDir, { recursive: true })
  fontsDirCache = fontsDir
  return fontsDir
}

export async function readFontSetting(): Promise<CustomFontSetting | null> {
  const data = await readSettingsRaw()
  const cf = data.customFont as CustomFontSetting | undefined
  if (cf && typeof cf.file === 'string' && cf.file) {
    return { file: cf.file, name: typeof cf.name === 'string' ? cf.name : cf.file }
  }
  return null
}

export async function writeFontSetting(value: CustomFontSetting | null): Promise<void> {
  if (value === null) await removeSettingsKeys(['customFont'])
  else await writeSettingsRaw({ customFont: value })
}

export function removeCustomFontFaces(): void {
  const toDelete: FontFace[] = []
  document.fonts.forEach((f) => {
    if (f.family === CUSTOM_FONT_FAMILY || f.family === `'${CUSTOM_FONT_FAMILY}'`) {
      toDelete.push(f)
    }
  })
  toDelete.forEach((f) => document.fonts.delete(f))
}

export async function activateFont(filePath: string): Promise<void> {
  const bytes = await readFile(filePath)
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
  const face = new FontFace(CUSTOM_FONT_FAMILY, `url(${url})`)
  await face.load()
  removeCustomFontFaces()
  document.fonts.add(face)
  document.body.style.fontFamily = `'${CUSTOM_FONT_FAMILY}', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
}

export function deactivateFont(): void {
  removeCustomFontFaces()
  document.body.style.fontFamily = ''
}

export async function deleteFontFiles(): Promise<void> {
  try {
    const fontsDir = await getFontsDir()
    for (const ext of ['ttf', 'otf', 'woff', 'woff2']) {
      const p = await join(fontsDir, `custom.${ext}`)
      if (await exists(p)) await remove(p)
    }
  } catch (e) {
    console.error('Ошибка удаления файлов шрифта:', e)
  }
}

/* ===== Хук: закрыть dropdown по клику вне ===== */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  })
}