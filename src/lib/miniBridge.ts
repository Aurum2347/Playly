/*
 * Связь главного окна и мини-плеера (отдельное окно Tauri у трея).
 * Главное окно — источник правды: оно шлёт состояние, мини-плеер шлёт команды.
 */

export const MINI_STATE_EVENT = 'mini:state'
export const MINI_COMMAND_EVENT = 'mini:command'
/* Мини-плеер открылся и просит прислать состояние */
export const MINI_HELLO_EVENT = 'mini:hello'

export interface MiniTrack {
  id: number
  title: string
  artist: string
  /* Имена файлов в папке covers: окна не делят blob-url, поэтому мини-плеер читает файлы сам */
  coverFile: string | null
  animCoverFile: string | null
  liked: boolean
}

export interface MiniState {
  track: MiniTrack | null
  isPlaying: boolean
  /* Позиция на момент at (мс, Date.now()); дальше мини-плеер досчитывает сам */
  position: number
  at: number
  duration: number
  rate: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  lang: string
}

export type MiniCommand =
  | { type: 'toggle' | 'next' | 'prev' | 'like' | 'shuffle' | 'repeat' | 'mute' }
  | { type: 'seek'; time: number }
  | { type: 'volume'; value: number }

/** Позиция «сейчас» с учётом времени, прошедшего с последнего обновления */
export function livePosition(s: MiniState, now = Date.now()): number {
  if (!s.isPlaying) return s.position
  const p = s.position + ((now - s.at) / 1000) * (s.rate || 1)
  return s.duration > 0 ? Math.min(s.duration, p) : p
}
