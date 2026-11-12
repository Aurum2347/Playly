import { invoke } from '@tauri-apps/api/core'

/* ===== Своя иконка приложения: цвет фона, цвет знака и форма ===== */

export interface IconStyle {
  background: string
  foreground: string
  round: boolean
}

export const DEFAULT_ICON: IconStyle = { background: '#171719', foreground: '#ffffff', round: false }

/* Готовые сочетания: [фон, знак] */
export const ICON_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ['#000000', '#ffffff'],
  ['#ffffff', '#000000'],
  ['#242424', '#dedede'],
  ['#ededed', '#464646'],
  ['#000000', '#f49a13'],
  ['#075a37', '#ff7a08'],
  ['#11cc56', '#171719'],
  ['#332d29', '#ffddcc'],
  ['#ed2f35', '#ffd0c5'],
  ['#ff5105', '#ffffff'],
  ['#5557fc', '#f0f0f0'],
  ['#111610', '#73b67a'],
]

const SIZE = 128
const RADIUS = 26
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)

export function normalizeIcon(raw: unknown): IconStyle {
  const r = (raw ?? {}) as Partial<IconStyle>
  return {
    background: isColor(r.background) ? r.background.toLowerCase() : DEFAULT_ICON.background,
    foreground: isColor(r.foreground) ? r.foreground.toLowerCase() : DEFAULT_ICON.foreground,
    round: r.round === true,
  }
}

export const sameIcon = (a: IconStyle, b: IconStyle) =>
  a.background.toLowerCase() === b.background.toLowerCase() &&
  a.foreground.toLowerCase() === b.foreground.toLowerCase() &&
  a.round === b.round

/** Рисует иконку 128×128: плашка нужной формы и перекрашенный логотип по центру */
async function renderIcon(style: IconStyle, logo: SVGSVGElement) {
  const clone = logo.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', '102')
  clone.setAttribute('height', '90')
  clone.querySelectorAll('path').forEach((path) => path.setAttribute('fill', style.foreground))

  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D недоступен')

  ctx.fillStyle = style.background
  ctx.beginPath()
  if (style.round) ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
  else ctx.roundRect(0, 0, SIZE, SIZE, RADIUS)
  ctx.fill()
  ctx.drawImage(image, 13, 19, 102, 90)

  return {
    rgba: Array.from(ctx.getImageData(0, 0, SIZE, SIZE).data),
    png: canvas.toDataURL('image/png').split(',')[1],
  }
}

/** Ставит иконку окнам и трею и сохраняет её файлом для ярлыка */
export async function applyIcon(style: IconStyle, logo: SVGSVGElement) {
  await invoke('set_application_icon', await renderIcon(style, logo))
}

/** Возвращает стандартную иконку Playly */
export const resetIcon = () => invoke('reset_application_icon')

/** Ярлык на рабочем столе с последней применённой иконкой */
export const createIconShortcut = () => invoke('create_icon_shortcut')
