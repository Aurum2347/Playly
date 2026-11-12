/* Что играет сейчас и с какого места — для окон, которые открываются из разных экранов
   (например, редактор текста ставит метку текущего момента). Заполняет App */

type Clock = { trackPath: () => string | null; position: () => number }

let clock: Clock = { trackPath: () => null, position: () => 0 }

export function setPlaybackClock(next: Clock) {
  clock = next
}

/** Позиция в секундах, если сейчас звучит именно этот файл, иначе null */
export function positionOf(filePath: string): number | null {
  return clock.trackPath() === filePath ? clock.position() : null
}
