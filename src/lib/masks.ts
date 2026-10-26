/* Маски CSS для баннеров: чёрное — видно (или размыто), прозрачное — нет */

export type EdgeMode = 'none' | 'left' | 'right' | 'both' | 'all'

/**
 * Маска для слоя размытия: чёрное — размыто, прозрачное — чётко.
 * Сильнее всего размыт самый край, к середине размытие плавно сходит на нет.
 */
export function blurMask(mode: EdgeMode, size: number): string | undefined {
  const s = Math.max(5, Math.min(100, size))
  const hard = (v: number) => (v * 0.35).toFixed(1)
  switch (mode) {
    case 'left':
      return `linear-gradient(to right, #000 0%, #000 ${hard(s)}%, transparent ${s}%)`
    case 'right':
      return `linear-gradient(to left, #000 0%, #000 ${hard(s)}%, transparent ${s}%)`
    case 'both': {
      const h = s / 2
      return `linear-gradient(to right, #000 0%, #000 ${hard(h)}%, transparent ${h}%, transparent ${100 - h}%, #000 ${100 - +hard(h)}%, #000 100%)`
    }
    default:
      return undefined
  }
}

/**
 * Маска плавного исчезновения: у выбранного края картинки нет совсем,
 * к отметке size% она проявляется полностью.
 */
export function fadeMask(mode: EdgeMode, size: number): string | undefined {
  const s = Math.max(10, Math.min(100, size))
  switch (mode) {
    case 'left':
      return `linear-gradient(to right, transparent 0%, #000 ${s}%)`
    case 'right':
      return `linear-gradient(to left, transparent 0%, #000 ${s}%)`
    case 'both': {
      const h = s / 2
      return `linear-gradient(to right, transparent 0%, #000 ${h}%, #000 ${100 - h}%, transparent 100%)`
    }
    default:
      return undefined
  }
}
