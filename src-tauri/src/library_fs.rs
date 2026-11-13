//! Файлы библиотеки: быстрый обход папки, проверка читаемости, поиск перемещённых файлов
//! и слежение за папкой библиотеки (режим «Автоматическая»).

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub exists: bool,
    pub size: u64,
    /// Файл открывается и из него читаются первые байты
    pub readable: bool,
}

/* Защита от бесконечных обходов: очень глубокие деревья и циклы через ссылки */
const MAX_DEPTH: u32 = 24;
/* Поиск перемещённых файлов не должен обходить весь диск бесконечно */
const FIND_LIMIT: usize = 400_000;

fn mtime_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn has_ext(path: &Path, exts: &[String]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            exts.iter().any(|x| *x == e)
        })
        .unwrap_or(false)
}

/// Обходит папку; visit возвращает false — обход прекращается
fn walk(dir: &Path, depth: u32, visit: &mut dyn FnMut(&Path, &fs::Metadata) -> bool) -> bool {
    if depth > MAX_DEPTH {
        return true;
    }
    let Ok(rd) = fs::read_dir(dir) else { return true };
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        /* Ссылки не разворачиваем: так не попадём в цикл */
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            if !walk(&path, depth + 1, visit) {
                return false;
            }
        } else if ft.is_file() {
            let Ok(meta) = entry.metadata() else { continue };
            if !visit(&path, &meta) {
                return false;
            }
        }
    }
    true
}

/// Все аудио- и видеофайлы папки (с подпапками): путь, размер, время изменения
#[tauri::command]
pub async fn scan_audio_dir(root: String, exts: Vec<String>) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&root);
        /* Папки нет (диск отключён, папку удалили) — это не «все файлы удалены» */
        if !root.is_dir() {
            return Err("missing".to_string());
        }
        let exts: Vec<String> = exts.iter().map(|e| e.to_ascii_lowercase()).collect();
        let mut out = Vec::new();
        walk(&root, 0, &mut |p, meta| {
            if has_ext(p, &exts) {
                out.push(FileEntry {
                    path: p.to_string_lossy().into_owned(),
                    size: meta.len(),
                    mtime: mtime_of(meta),
                });
            }
            true
        });
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn status_of(path: &str) -> FileStatus {
    let p = Path::new(path);
    let Ok(meta) = fs::metadata(p) else {
        return FileStatus { exists: false, size: 0, readable: false };
    };
    if !meta.is_file() {
        return FileStatus { exists: false, size: 0, readable: false };
    }
    let size = meta.len();
    let readable = size > 0
        && fs::File::open(p)
            .and_then(|mut f| {
                let mut buf = [0u8; 64];
                f.read(&mut buf)
            })
            .map(|n| n > 0)
            .unwrap_or(false);
    FileStatus { exists: true, size, readable }
}

/// Есть ли файлы, не пустые ли и читаются ли (импорт и воспроизведение)
#[tauri::command]
pub async fn file_status(paths: Vec<String>) -> Vec<FileStatus> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| status_of(p)).collect())
        .await
        .unwrap_or_default()
}

/// Ищет файлы с такими именами (без учёта регистра) в указанных папках.
/// Ключ ответа — имя в нижнем регистре
#[tauri::command]
pub async fn find_files_by_name(roots: Vec<String>, names: Vec<String>) -> HashMap<String, Vec<FileEntry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let wanted: std::collections::HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
        let mut found: HashMap<String, Vec<FileEntry>> = HashMap::new();
        if wanted.is_empty() {
            return found;
        }
        /* Одна и та же папка (или вложенная в уже просмотренную) обходится один раз */
        let mut roots: Vec<PathBuf> = roots.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
        roots.sort_by_key(|p| p.components().count());
        let mut used: Vec<PathBuf> = Vec::new();
        let mut seen = 0usize;
        for root in roots {
            if used.iter().any(|u| root.starts_with(u)) {
                continue;
            }
            used.push(root.clone());
            let keep_going = walk(&root, 0, &mut |p, meta| {
                seen += 1;
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    let key = name.to_lowercase();
                    if wanted.contains(&key) {
                        found.entry(key).or_default().push(FileEntry {
                            path: p.to_string_lossy().into_owned(),
                            size: meta.len(),
                            mtime: mtime_of(meta),
                        });
                    }
                }
                seen < FIND_LIMIT
            });
            if !keep_going {
                break;
            }
        }
        found
    })
    .await
    .unwrap_or_default()
}

/* ===== Точные копии файлов (поиск дубликатов) ===== */

fn hash_file(path: &str) -> Option<String> {
    use std::hash::Hasher;
    let mut f = fs::File::open(path).ok()?;
    /* Два независимых хеша по всему содержимому: случайное совпадение практически исключено */
    let mut a = std::collections::hash_map::DefaultHasher::new();
    let mut b = std::collections::hash_map::DefaultHasher::new();
    b.write_u64(0x9e37_79b9_7f4a_7c15);
    let mut buf = vec![0u8; 1 << 16];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        a.write(&buf[..n]);
        b.write(&buf[..n]);
        total += n as u64;
    }
    Some(format!("{:x}-{:016x}{:016x}", total, a.finish(), b.finish()))
}

/// Отпечатки содержимого файлов (None — файл не прочитался). Одинаковый отпечаток — одинаковые байты
#[tauri::command]
pub async fn hash_files(paths: Vec<String>) -> Vec<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| hash_file(p)).collect())
        .await
        .unwrap_or_default()
}

/* ===== Слежение за папкой библиотеки ===== */

/// Событие для главного окна: в папке что-то поменялось (пачка событий уже собрана)
pub const LIBRARY_FS_EVENT: &str = "library://fs-changed";
/* Пока события идут подряд (копирование сотни файлов), ждём тишины, но не дольше MAX_BATCH */
const QUIET: Duration = Duration::from_millis(1500);
const MAX_BATCH: Duration = Duration::from_secs(6);

#[derive(Default)]
pub struct LibraryWatch(Mutex<Option<notify::RecommendedWatcher>>);

/// Начать следить за папкой. Ошибка — слежение недоступно, окно перейдёт на периодическое сканирование
#[tauri::command]
pub fn watch_library_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, LibraryWatch>,
    path: String,
) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("missing".into());
    }
    let (tx, rx) = mpsc::channel::<usize>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            /* Чтение файлов и смену атрибутов не считаем изменением библиотеки */
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            let _ = tx.send(ev.paths.len().max(1));
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *slot = Some(watcher);

    /* Собираем пачку событий и отправляем одно уведомление. Поток завершится, когда watcher удалят (tx закроется) */
    thread::spawn(move || loop {
        let Ok(first) = rx.recv() else { break };
        let started = Instant::now();
        let mut count = first;
        loop {
            match rx.recv_timeout(QUIET) {
                Ok(n) => {
                    count += n;
                    if started.elapsed() > MAX_BATCH {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        let _ = app.emit_to("main", LIBRARY_FS_EVENT, count);
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_library_folder(state: tauri::State<'_, LibraryWatch>) {
    if let Ok(mut slot) = state.0.lock() {
        *slot = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reports_missing_empty_and_readable_files() {
        let dir = std::env::temp_dir().join(format!("playly-status-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let empty = dir.join("empty.mp3");
        let full = dir.join("full.mp3");
        fs::write(&empty, b"").unwrap();
        fs::write(&full, b"ID3 some bytes").unwrap();
        let missing = status_of(&dir.join("nope.mp3").to_string_lossy());
        assert!(!missing.exists && !missing.readable);
        let e = status_of(&empty.to_string_lossy());
        assert!(e.exists && !e.readable);
        let f = status_of(&full.to_string_lossy());
        assert!(f.exists && f.readable);
        let _ = fs::remove_dir_all(&dir);
    }
}
