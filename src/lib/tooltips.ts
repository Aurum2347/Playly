/*
 * Подсказки при наведении в стиле Playly вместо системных.
 *
 * Компонентам ничего делать не нужно: обычный атрибут title сразу переносится в data-tip
 * (системная подсказка тогда не появляется), а этот слой показывает свою. Так подсказки
 * одинаково выглядят во всех окнах и работают и для старого кода, и для нового.
 * Строки через \n: первая - основная, остальные - пояснение помельче.
 */
import '../styles/tooltip.css'

const SHOW_DELAY = 420
/* Сразу после другой подсказки следующая показывается почти мгновенно, как в системных панелях */
const WARM_DELAY = 60
const WARM_WINDOW = 700
const GAP = 8
const EDGE = 8

let tip: HTMLDivElement | null = null
let target: HTMLElement | null = null
let showTimer = 0
let lastHidden = 0

function convert(el: Element) {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return
  const text = el.getAttribute('title')
  if (text === null) return
  removeAttr.call(el, 'title')
  if (text.trim() === '') {
    dropTitleTip(el)
    return
  }
  el.setAttribute('data-tip', text)
  el.setAttribute('data-tip-title', '')
  /* Кнопка-значок без текста: подсказка была её единственным названием для экранного диктора */
  const autoAria = el.hasAttribute('data-aria-auto')
  if ((autoAria || !el.hasAttribute('aria-label')) && !el.textContent?.trim()) {
    el.setAttribute('aria-label', text.replace(/\n/g, '. '))
    el.setAttribute('data-aria-auto', '')
  }
  if (el === target && tip) render(text)
}

/* Подсказка и название для диктора, взятые из title, уходят вместе с ним */
function dropTitleTip(el: Element) {
  if (!el.hasAttribute('data-tip-title')) return
  removeAttr.call(el, 'data-tip-title')
  removeAttr.call(el, 'data-tip')
  if (el.hasAttribute('data-aria-auto')) {
    removeAttr.call(el, 'data-aria-auto')
    removeAttr.call(el, 'aria-label')
  }
}

/*
 * title уже перенесён в data-tip, поэтому когда React убирает title (title={cond ? x : undefined}),
 * атрибута нет и MutationObserver ничего не видит. Перехватываем само удаление,
 * иначе осталась бы старая подсказка
 */
const removeAttr = Element.prototype.removeAttribute
function patchTitleRemoval() {
  Element.prototype.removeAttribute = function (this: Element, name: string) {
    if (name === 'title' && !this.hasAttribute('title')) dropTitleTip(this)
    return removeAttr.call(this, name)
  }
}

/*
 * Кнопки-значки, у которых есть только aria-label (название для экранного диктора), тоже
 * получают подсказку: иначе непонятно, что делает кнопка. Если aria-label поменяется
 * (например, «Пауза» -> «Играть»), подсказка обновится вместе с ним.
 */
const LABELLED = 'button[aria-label], a[aria-label], [role="button"][aria-label], [role="menuitem"][aria-label], [role="switch"][aria-label]'

function adoptLabel(el: Element) {
  if (!(el instanceof HTMLElement) || !el.matches(LABELLED)) return
  const own = el.hasAttribute('data-tip') && !el.hasAttribute('data-tip-auto')
  if (own) return
  const label = el.getAttribute('aria-label')?.trim()
  if (!label || el.textContent?.trim()) {
    if (el.hasAttribute('data-tip-auto')) {
      el.removeAttribute('data-tip')
      el.removeAttribute('data-tip-auto')
    }
    return
  }
  if (el.getAttribute('data-tip') === label) return
  el.setAttribute('data-tip', label)
  el.setAttribute('data-tip-auto', '')
}

function sweep(root: ParentNode) {
  if (root instanceof Element && root.hasAttribute('title')) convert(root)
  root.querySelectorAll?.('[title]').forEach(convert)
  if (root instanceof Element) adoptLabel(root)
  root.querySelectorAll?.('[aria-label]').forEach(adoptLabel)
}

function ensureTip(): HTMLDivElement {
  if (tip) return tip
  tip = document.createElement('div')
  tip.className = 'pl-tip'
  tip.setAttribute('role', 'tooltip')
  tip.innerHTML = '<div class="pl-tip-body"></div><span class="pl-tip-arrow"></span>'
  document.body.appendChild(tip)
  return tip
}

function render(text: string) {
  const body = ensureTip().querySelector('.pl-tip-body') as HTMLDivElement
  const [main, ...rest] = text.split('\n').map((s) => s.trim()).filter(Boolean)
  body.textContent = ''
  const m = document.createElement('div')
  m.className = 'pl-tip-main'
  m.textContent = main ?? ''
  body.appendChild(m)
  for (const line of rest) {
    const s = document.createElement('div')
    s.className = 'pl-tip-sub'
    s.textContent = line
    body.appendChild(s)
  }
}

function place(el: HTMLElement) {
  const t = ensureTip()
  const r = el.getBoundingClientRect()
  t.style.left = '0px'
  t.style.top = '0px'
  t.style.maxWidth = `${Math.min(300, window.innerWidth - EDGE * 2)}px`
  const w = t.offsetWidth
  const h = t.offsetHeight
  /* Над элементом, если помещается; иначе под ним */
  let below = r.top - GAP - h < EDGE
  if (below && r.bottom + GAP + h > window.innerHeight - EDGE) below = r.top > window.innerHeight - r.bottom
  const top = below ? r.bottom + GAP : r.top - GAP - h
  const center = r.left + r.width / 2
  const left = Math.max(EDGE, Math.min(window.innerWidth - EDGE - w, center - w / 2))
  t.style.left = `${Math.round(left)}px`
  t.style.top = `${Math.round(Math.max(EDGE, top))}px`
  t.classList.toggle('below', below)
  /* Стрелка смотрит на центр элемента, даже если подсказку прижало к краю окна */
  t.style.setProperty('--arrow-x', `${Math.round(Math.max(12, Math.min(w - 12, center - left)))}px`)
}

function show(el: HTMLElement) {
  const text = el.getAttribute('data-tip')
  if (!text || !el.isConnected) return
  target = el
  render(text)
  place(el)
  const t = ensureTip()
  t.classList.remove('visible')
  void t.offsetWidth
  t.classList.add('visible')
}

function hide() {
  window.clearTimeout(showTimer)
  showTimer = 0
  if (target && tip?.classList.contains('visible')) lastHidden = performance.now()
  target = null
  tip?.classList.remove('visible')
}

function schedule(el: HTMLElement) {
  window.clearTimeout(showTimer)
  target = el
  const warm = performance.now() - lastHidden < WARM_WINDOW
  showTimer = window.setTimeout(() => {
    if (target === el) show(el)
  }, warm ? WARM_DELAY : SHOW_DELAY)
}

const tipOwner = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? (node.closest('[data-tip]') as HTMLElement | null) : null

let installed = false

/** Включить подсказки Playly в этом окне (один раз при запуске) */
export function installTooltips() {
  if (installed || typeof document === 'undefined') return
  installed = true
  patchTitleRemoval()
  sweep(document.body)
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.attributeName === 'title') convert(r.target as Element)
        else if (r.attributeName === 'aria-label') adoptLabel(r.target as Element)
        else if (r.target === target && tip?.classList.contains('visible')) {
          const text = target.getAttribute('data-tip')
          if (text) render(text)
          else hide()
        }
      } else r.addedNodes.forEach((n) => n instanceof Element && sweep(n))
    }
    /* Элемент с подсказкой убрали со страницы (закрылось меню, сменился экран) */
    if (target && !target.isConnected) hide()
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', 'data-tip', 'aria-label'] })

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = tipOwner(e.target)
    if (el === target) return
    if (!el) {
      hide()
      return
    }
    if (tip?.classList.contains('visible')) {
      lastHidden = performance.now()
      tip.classList.remove('visible')
    }
    schedule(el)
  })
  document.addEventListener('pointerout', (e) => {
    if (!target) return
    const to = e.relatedTarget as Node | null
    if (!to || !target.contains(to)) {
      if (tipOwner(to) !== target) hide()
    }
  })
  /* Клавиатура: подсказка у элемента в фокусе (только при навигации с клавиатуры) */
  document.addEventListener('focusin', (e) => {
    const el = tipOwner(e.target)
    if (el && (e.target as Element).matches?.(':focus-visible')) schedule(el)
  })
  document.addEventListener('focusout', () => hide())
  const hideNow = () => hide()
  document.addEventListener('pointerdown', hideNow, true)
  document.addEventListener('wheel', hideNow, { capture: true, passive: true })
  document.addEventListener('scroll', hideNow, true)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') hide()
  }, true)
  document.addEventListener('contextmenu', hideNow, true)
  window.addEventListener('blur', hideNow)
  window.addEventListener('resize', hideNow)
}
