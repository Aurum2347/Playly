import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions } from '@tauri-apps/api/menu'
import { LogicalPosition } from '@tauri-apps/api/dpi'

/*
 * Системное контекстное меню вместо стилизованного (режим экономии ресурсов).
 * Пункты берутся из уже отрисованного стилизованного меню: каждая его кнопка становится пунктом,
 * разделитель — разделителем, а выбор пункта нажимает исходную кнопку. Так у обоих меню
 * всегда одинаковые пункты и одна и та же логика.
 */

export const nativeMenusAvailable = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

type Item = MenuItemOptions | PredefinedMenuItemOptions

function collect(root: Element, out: Item[]) {
  for (const node of Array.from(root.children)) {
    if (node instanceof HTMLButtonElement) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      out.push({ text, enabled: !node.disabled, action: () => node.click() })
    } else if (/divider|separator/i.test(node.className.toString())) {
      if (out.length > 0 && !('item' in out[out.length - 1])) out.push({ item: 'Separator' })
    } else {
      collect(node, out)
    }
  }
}

/** Показать системное меню с пунктами из root; onDone — меню закрылось (с выбором или без) */
export async function popupNativeMenu(root: HTMLElement, at: { x: number; y: number }, onDone: () => void): Promise<boolean> {
  const items: Item[] = []
  collect(root, items)
  while (items.length > 0 && 'item' in items[items.length - 1]) items.pop()
  if (items.length === 0) return false
  try {
    const menu = await Menu.new({ items })
    /* Координаты мыши — в CSS-пикселях с учётом масштаба интерфейса (зум WebView), меню ждёт логические */
    const zoom = parseFloat(document.documentElement.style.getPropertyValue('--ui-scale')) || 1
    await menu.popup(new LogicalPosition(at.x * zoom, at.y * zoom))
    /* Событие выбора пункта приходит отдельно и может отстать от закрытия меню */
    setTimeout(onDone, 250)
    return true
  } catch (e) {
    console.warn('Системное меню недоступно:', e)
    return false
  }
}
