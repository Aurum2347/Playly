/* Что показывать в статусе Discord — настраивается в «Язык и система» */
export interface DiscordParts {
  /* Название трека; без него — просто «Слушает музыку» */
  title: boolean
  artist: boolean
  /* Альбом в подсказке у иконки */
  album: boolean
  /* Полоса времени */
  progress: boolean
  /* Кнопки GitHub и «Искать трек», кликабельные название и исполнитель */
  buttons: boolean
  /* Показывать статус на паузе (иначе он убирается) */
  paused: boolean
  /* Показывать «Использую Playly», когда ничего не играет */
  idle: boolean
}

export const DISCORD_PART_KEYS: Array<keyof DiscordParts> = ['title', 'artist', 'album', 'progress', 'buttons', 'paused', 'idle']

export const DEFAULT_DISCORD_PARTS: DiscordParts = {
  title: true,
  artist: true,
  album: true,
  progress: true,
  buttons: true,
  paused: true,
  idle: true,
}

export function normalizeDiscordParts(raw: unknown): DiscordParts {
  const r = (raw ?? {}) as Partial<Record<keyof DiscordParts, unknown>>
  const out = { ...DEFAULT_DISCORD_PARTS }
  for (const key of DISCORD_PART_KEYS) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
  }
  return out
}
