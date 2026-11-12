import { invoke } from '@tauri-apps/api/core'

/* ===== Файлы библиотеки в папке данных Playly =====
 * Пишутся атомарно (через временный файл) с резервной копией .json.bak.
 * Если основной файл повреждён, Rust отдаёт резервную копию, поэтому
 * битый tracks.json больше не превращается в «пустую библиотеку».
 */
export type LibraryFile = 'settings.json' | 'tracks.json' | 'playlists.json' | 'history.json' | 'listening-history.json'

/** Разобранный JSON или null, если файла ещё нет (или не читаются ни он, ни копия) */
export async function readLibraryJson(name: LibraryFile): Promise<unknown> {
  const text = await invoke<string | null>('read_library_json', { name })
  return text == null ? null : JSON.parse(text)
}

export function writeLibraryJson(name: LibraryFile, data: unknown, pretty = false): Promise<void> {
  return invoke('write_library_json', { name, contents: JSON.stringify(data, null, pretty ? 2 : undefined) })
}
