/* Типы для gifenc (пакет поставляется без них) — только то, что используется в Playly */
declare module 'gifenc' {
  export type Palette = number[][]
  export type ColorFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface FrameOptions {
    palette?: Palette
    /* Задержка кадра, мс */
    delay?: number
    /* 0 — бесконечный повтор, -1 — без повтора */
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    first?: boolean
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: ColorFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
  ): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: ColorFormat): Uint8Array
}
