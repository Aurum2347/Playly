import type { PlaylistBanner } from '../App'

/** Есть ли что показать у баннера плейлиста: градиент или уже загруженная картинка */
export const bannerVisible = (b: PlaylistBanner | null | undefined): b is PlaylistBanner =>
  !!b && (b.mode === 'gradient' ? !!b.gradient : !!b.url)
