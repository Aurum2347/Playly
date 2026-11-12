/* ===== Сообщения пользователю из любого места кода (в том числе вне React) =====
 * reportError: действие не выполнено, нужно внимание (окно с подробностями).
 * notify: короткое уведомление внизу экрана, исчезает само (например, «трек пропущен»).
 * Текст задаётся ключом из раздела feedback файлов перевода; переводит FeedbackHost.
 */

export type FeedbackKind = 'error' | 'notice'

export interface FeedbackMessage {
  kind: FeedbackKind
  /* Ключ внутри feedback.* (ru.ts / en.ts) */
  key: string
  vars?: Record<string, unknown>
  details?: string
}

export const FEEDBACK_EVENT = 'playly-feedback'

function describe(error: unknown): string {
  if (error == null) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function emit(message: FeedbackMessage) {
  window.dispatchEvent(new CustomEvent<FeedbackMessage>(FEEDBACK_EVENT, { detail: message }))
}

export function reportError(key: string, error?: unknown, vars?: Record<string, unknown>) {
  console.error(`[playly] ${key}`, error ?? '')
  emit({ kind: 'error', key, vars, details: describe(error) })
}

export function notify(key: string, vars?: Record<string, unknown>) {
  emit({ kind: 'notice', key, vars })
}
