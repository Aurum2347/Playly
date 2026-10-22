import { getCurrentWebview } from '@tauri-apps/api/webview'

/* ===== Масштаб приложения: строго 100–200 % ===== */
export const UI_SCALE_MIN = 100
export const UI_SCALE_MAX = 200
export const UI_SCALE_DEFAULT = 100
export const UI_SCALE_STEP = 5

export function clampUiScale(value: unknown): number {
  const n = typeof value === 'number' && isFinite(value) ? value : UI_SCALE_DEFAULT
  const stepped = Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, stepped))
}

/**
 * Масштабирует содержимое WebView (как зум браузера). Само окно не трогаем:
 * ни размер, ни развёрнутое состояние не меняются, а вёрстка подстраивается
 * под уменьшившийся CSS-вьюпорт медиазапросами.
 */
export async function applyUiScale(percent: number): Promise<void> {
  const scale = clampUiScale(percent) / 100
  document.documentElement.style.setProperty('--ui-scale', String(scale))
  try {
    await getCurrentWebview().setZoom(scale)
  } catch (e) {
    console.warn('Не удалось изменить масштаб:', e)
  }
}
