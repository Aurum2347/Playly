/*
 * Чистая логика библиотеки без обращений к диску: сравнение путей, поиск перемещённых файлов,
 * синхронизация с отслеживаемой папкой и группы дубликатов. Диском занимается useLibrary.
 */

export interface DiskFile {
  path: string
  size: number
  mtime: number
}

/* Пути Windows не различают регистр и оба вида слешей */
const caseless = typeof navigator === 'undefined' || /windows/i.test(navigator.userAgent)

export function normPath(p: string): string {
  const s = p.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  return caseless ? s.toLowerCase() : s
}

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
export const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
const stemOf = (p: string) => baseName(p).replace(/\.[^.]+$/, '')
/** Имя .lrc, которое Playly ищет рядом с треком */
export const lrcNameFor = (p: string) => `${stemOf(p)}.lrc`
export const sidecarLrc = (p: string) => p.replace(/\.[^.\\/]+$/, '') + '.lrc'

export function isInside(path: string, folder: string): boolean {
  const f = normPath(folder)
  return f !== '' && normPath(path).startsWith(f + '/')
}

/**
 * Где искать перемещённые файлы: папка библиотеки, а также прежняя папка файла и папка над ней
 * (обычно файл переносят в соседнюю папку). Корни дисков не обходим — это слишком долго.
 */
export function searchRoots(oldPaths: string[], libraryFolder: string): string[] {
  const out = new Map<string, string>()
  const add = (p: string) => {
    if (!p || /^[a-z]:$/i.test(p) || p === '/' || !/[\\/]/.test(p)) return
    out.set(normPath(p), p)
  }
  add(libraryFolder)
  for (const p of oldPaths) {
    const parent = dirName(p)
    add(parent)
    add(dirName(parent))
  }
  return [...out.values()]
}

/* Перенос в пределах диска сохраняет время изменения файла — по нему отличаем «тот самый» файл */
const sameTime = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) < 2000

/** Выбрать новый путь трека: один кандидат или ровно один с тем же временем изменения; иначе — спросить */
export function pickCandidate(oldMtime: number, candidates: DiskFile[]): DiskFile | null {
  /*
   * Единственный файл с тем же именем ещё не значит «тот самый»: у «01.mp3» из другого альбома
   * имя совпадёт, а песня другая. Без совпадения времени берём его, только если время не записано
   */
  if (candidates.length === 1 && (oldMtime <= 0 || sameTime(candidates[0].mtime, oldMtime))) return candidates[0]
  const timed = candidates.filter((c) => sameTime(c.mtime, oldMtime))
  return timed.length === 1 ? timed[0] : null
}

/**
 * Найденный .lrc для трека на новом месте: null — рядом с треком (его найдут и так) или не нашёлся.
 * Из нескольких берём лежащий в той же папке, что и трек, иначе — единственный.
 */
export function pickLrc(trackPath: string, lrcs: DiskFile[]): string | null {
  if (lrcs.length === 0) return null
  const sidecar = normPath(sidecarLrc(trackPath))
  if (lrcs.some((l) => normPath(l.path) === sidecar)) return null
  const dir = normPath(dirName(trackPath))
  const near = lrcs.filter((l) => normPath(dirName(l.path)) === dir)
  if (near.length === 1) return near[0].path
  return lrcs.length === 1 ? lrcs[0].path : null
}

export interface SyncTrack {
  id: number
  filePath: string
  fileModifiedAt: number
}

export interface FolderDiff {
  /* Новые файлы — импортировать */
  added: string[]
  /* Трек переехал внутри папки: id → новый файл */
  moved: Map<number, DiskFile>
  /* Файлов больше нет ни на месте, ни под другим путём */
  removed: number[]
}

/** Сравнить треки из папки библиотеки с тем, что сейчас лежит на диске */
export function diffFolder(folder: string, tracks: SyncTrack[], files: DiskFile[], busy: Set<string> = new Set()): FolderDiff {
  const onDisk = new Set(files.map((f) => normPath(f.path)))
  const known = new Set(tracks.map((t) => normPath(t.filePath)))
  const fresh = files.filter((f) => !known.has(normPath(f.path)) && !busy.has(normPath(f.path)))
  const gone = tracks.filter((t) => isInside(t.filePath, folder) && !onDisk.has(normPath(t.filePath)))

  const byName = new Map<string, DiskFile[]>()
  for (const f of fresh) {
    const key = baseName(normPath(f.path))
    byName.set(key, [...(byName.get(key) ?? []), f])
  }
  const moved = new Map<number, DiskFile>()
  const taken = new Set<string>()
  for (const t of gone) {
    const cands = (byName.get(baseName(normPath(t.filePath))) ?? []).filter((f) => !taken.has(normPath(f.path)))
    const pick = pickCandidate(t.fileModifiedAt, cands)
    if (!pick) continue
    moved.set(t.id, pick)
    taken.add(normPath(pick.path))
  }
  return {
    added: fresh.filter((f) => !taken.has(normPath(f.path))).map((f) => f.path),
    moved,
    removed: gone.filter((t) => !moved.has(t.id)).map((t) => t.id),
  }
}

/* ===== Дубликаты ===== */

export interface DupTrack {
  id: number
  title: string
  artist: string
  duration: string
  filePath: string
}

export interface DuplicateGroup {
  kind: 'exact' | 'similar'
  ids: number[]
}

const durationSec = (d: string) => d.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0)

/* «Song (Remastered) [Official]» и «song» — одно и то же название */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Группы повторов. exact — одинаковое содержимое файлов (hashes: id → отпечаток),
 * similar — разные файлы с одинаковыми названием и исполнителем и почти одинаковой длительностью.
 */
export function findDuplicates(tracks: DupTrack[], hashes: Map<number, string>): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const byHash = new Map<string, number[]>()
  for (const t of tracks) {
    const h = hashes.get(t.id)
    if (h) byHash.set(h, [...(byHash.get(h) ?? []), t.id])
  }
  const exactOf = new Map<number, string>()
  for (const [h, ids] of byHash) {
    if (ids.length < 2) continue
    groups.push({ kind: 'exact', ids })
    ids.forEach((id) => exactOf.set(id, h))
  }

  const byMeta = new Map<string, DupTrack[]>()
  for (const t of tracks) {
    const title = normTitle(t.title)
    if (!title) continue
    const key = `${title}\u0000${normTitle(t.artist)}`
    byMeta.set(key, [...(byMeta.get(key) ?? []), t])
  }
  for (const list of byMeta.values()) {
    if (list.length < 2) continue
    /* Внутри одного названия — кучки с близкой длительностью (±3 с) */
    const sorted = [...list].sort((a, b) => durationSec(a.duration) - durationSec(b.duration))
    let bucket: DupTrack[] = []
    const flush = () => {
      /* Точные копии одного файла уже показаны отдельной группой: здесь оставляем по одной */
      const seen = new Set<string>()
      const ids = bucket
        .filter((t) => {
          const h = exactOf.get(t.id)
          if (!h) return true
          if (seen.has(h)) return false
          seen.add(h)
          return true
        })
        .map((t) => t.id)
      if (ids.length > 1) groups.push({ kind: 'similar', ids })
      bucket = []
    }
    for (const t of sorted) {
      const last = bucket[bucket.length - 1]
      if (last && Math.abs(durationSec(t.duration) - durationSec(last.duration)) > 3) flush()
      bucket.push(t)
    }
    flush()
  }
  return groups
}
