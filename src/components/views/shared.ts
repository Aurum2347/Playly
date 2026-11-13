import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { getPrefs } from '../../lib/prefs'
import { nativeMenusAvailable, popupNativeMenu } from '../../lib/nativeMenu'

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/**
 * Shift+клик: диапазон от опорной строки до нажатой (в порядке списка на экране).
 * Опора — последняя нажатая строка; если её нет в списке (поиск, удаление, выделение из меню) —
 * последняя выделенная, затем играющий трек. Без опоры диапазона нет — строка выделяется одна.
 */
export function selectionRange(
  ids: number[],
  target: number,
  anchor: number | null,
  selected: Set<number>,
  playing: number | null,
): { anchor: number; ids: number[] } | null {
  const b = ids.indexOf(target)
  if (b < 0) return null
  const candidates = [anchor, ...[...selected].reverse(), playing]
  for (const c of candidates) {
    if (c === null || c === target) continue
    const a = ids.indexOf(c)
    if (a >= 0) return { anchor: c, ids: ids.slice(Math.min(a, b), Math.max(a, b) + 1) }
  }
  return null
}

export const parseDuration = (dur: string | undefined | null): number => {
  if (!dur) return 0
  return dur.split(':').reduce((acc, part) => {
    const n = Number(part)
    return acc * 60 + (Number.isFinite(n) ? n : 0)
  }, 0)
}

export function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const inlineRow: CSSProperties = { display: 'flex', gap: 8, marginBottom: 16 }
export const inlineInput: CSSProperties = {
  flex: 1, minWidth: 0, padding: '9px 12px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, color: '#f0f0f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
}
export const inlineButton: CSSProperties = {
  padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.06)', color: '#e0e0e0', fontSize: 13, fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
}

/* Держит элемент смонтированным ещё ms после закрытия, чтобы успела проиграться анимация исчезновения */
export function usePresence(open: boolean, ms = 150) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(timer)
  }, [open, ms])

  return { mounted: open || mounted, closing: !open && mounted }
}

const MENU_PADDING = 8

export function computeMenuPosition(clientX: number, clientY: number, w: number, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = clientX + MENU_PADDING
  let y = clientY + MENU_PADDING

  if (vw - clientX < w + MENU_PADDING) {
    x = clientX >= w + MENU_PADDING ? clientX - w - MENU_PADDING : vw - w - MENU_PADDING
  }

  const spaceBelow = vh - clientY
  const spaceAbove = clientY
  if (spaceBelow < h + MENU_PADDING && (spaceAbove >= h + MENU_PADDING || spaceAbove > spaceBelow)) {
    y = clientY - h - MENU_PADDING
  }

  x = Math.max(MENU_PADDING, Math.min(x, vw - w - MENU_PADDING))
  y = Math.max(MENU_PADDING, Math.min(y, vh - h - MENU_PADDING))
  return { x, y }
}

interface MenuState<T> {
  open: boolean
  measuring: boolean
  seq: number
  anchor: { x: number; y: number }
  pos: { x: number; y: number }
  target: T | null
}

export type ContextMenuApi<T> = ReturnType<typeof useContextMenu<T>>

export function useContextMenu<T>() {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MenuState<T>>({
    open: false, measuring: false, seq: 0, anchor: { x: 0, y: 0 }, pos: { x: 0, y: 0 }, target: null,
  })

  useLayoutEffect(() => {
    if (!state.measuring || !ref.current) return
    const el = ref.current
    /* Экономия ресурсов: вместо стилизованного меню — системное с теми же пунктами */
    if (getPrefs().powerSave && nativeMenusAvailable()) {
      el.dataset.nativeMenu = '1'
      const seq = state.seq
      void popupNativeMenu(el, state.anchor, () =>
        setState((s) => (s.seq === seq && s.open ? { ...s, open: false } : s))
      ).then((ok) => {
        /* Системное меню не открылось — показываем обычное */
        if (!ok) delete el.dataset.nativeMenu
      })
    } else {
      delete el.dataset.nativeMenu
    }
    const rect = el.getBoundingClientRect()
    const pos = computeMenuPosition(state.anchor.x, state.anchor.y, rect.width, rect.height)
    setState((s) => ({ ...s, measuring: false, pos }))
  }, [state.seq, state.measuring, state.anchor])

  const open = (e: React.MouseEvent, target: T) => {
    e.preventDefault()
    e.stopPropagation()
    const anchor = { x: e.clientX, y: e.clientY }
    setState((s) => ({
      open: true, measuring: true, seq: s.seq + 1, anchor,
      pos: { x: anchor.x + MENU_PADDING, y: anchor.y + MENU_PADDING }, target,
    }))
  }

  const close = useCallback(() => setState((s) => (s.open ? { ...s, open: false } : s)), [])

  return {
    ref,
    isOpen: state.open,
    isMeasuring: state.measuring,
    pos: state.pos,
    target: state.target,
    open,
    close,
  }
}
