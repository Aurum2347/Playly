// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media_audio;
mod storage;
use base64::Engine as _;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::MimeType;
use lofty::tag::{Accessor, ItemKey};
use std::fs;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{command, Emitter, Manager};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub duration_secs: u64,
    pub cover: Option<String>,
}

#[command]
fn get_track_metadata(path: String) -> Result<TrackMeta, String> {
    let tagged_file = lofty::read_from_path(&path)
        .map_err(|e| format!("Не удалось прочитать {}: {}", path, e))?;
    let duration_secs = tagged_file.properties().duration().as_secs();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album, genre) = match tag {
        Some(t) => (
            t.title().map(|s| s.into_owned()),
            t.artist().map(|s| s.into_owned()),
            t.album().map(|s| s.into_owned()),
            t.genre().map(|s| s.into_owned()),
        ),
        None => (None, None, None, None),
    };

    let cover = tag.and_then(|t| {
        let pics = t.pictures();
        pics.first()
            .filter(|pic| pic.data().len() <= 2 * 1024 * 1024)
            .map(|pic| {
                let mime_str = match pic.mime_type() {
                    Some(MimeType::Png) => "image/png",
                    Some(MimeType::Jpeg) => "image/jpeg",
                    Some(MimeType::Tiff) => "image/tiff",
                    Some(MimeType::Bmp) => "image/bmp",
                    Some(MimeType::Gif) => "image/gif",
                    _ => "image/jpeg",
                };
                let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
                format!("data:{};base64,{}", mime_str, b64)
            })
    });

    Ok(TrackMeta {
        title,
        artist,
        album,
        genre,
        duration_secs,
        cover,
    })
}

/// Текст песни: сначала файл .lrc рядом с треком, затем встроенный тег (USLT / LYRICS / ©lyr)
#[command]
fn get_track_lyrics(path: String) -> Option<String> {
    let sidecar = std::path::Path::new(&path).with_extension("lrc");
    if sidecar.is_file() {
        if let Ok(bytes) = fs::read(&sidecar) {
            let text = String::from_utf8_lossy(&bytes);
            let text = text.trim_start_matches('\u{feff}');
            return Some(text.to_string());
        }
    }

    let tagged_file = lofty::read_from_path(&path).ok()?;
    tagged_file
        .tags()
        .iter()
        .filter_map(|t| t.get_string(&ItemKey::Lyrics))
        .find(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
}

#[command]
fn get_file_mtime(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("metadata {}: {}", path, e))?;
    let mtime = meta
        .modified()
        .map_err(|e| format!("modified {}: {}", path, e))?;
    let millis = mtime
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(millis)
}

/// Когда файл или папка появились на диске (мс). Нужна, чтобы узнать, с какого дня человек пользуется Playly
#[command]
fn get_path_created(path: String) -> Option<u64> {
    let meta = fs::metadata(&path).ok()?;
    let time = meta.created().or_else(|_| meta.modified()).ok()?;
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// Показать главное окно поверх остальных: из трея, из свёрнутого состояния или из-за других программ
fn reveal_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        /* Windows не всегда отдаёт фокус чужому процессу — на мгновение поднимаем окно выше всех */
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
    }
}

#[command]
fn reveal_item_in_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Файл не найден: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Не удалось открыть проводник: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Не удалось открыть Finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        /* Файловый менеджер с выделенным файлом (Nautilus, Dolphin, Nemo, Thunar поддерживают FileManager1);
           если такого нет — просто открываем папку */
        let uri = format!("file://{}", urlencoding::encode(&path).replace("%2F", "/"));
        let selected = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:{}", uri),
                "string:",
            ])
            .status()
            .is_ok_and(|s| s.success());
        if !selected {
            let parent = p.parent().ok_or("Не удалось определить родительскую папку")?;
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Не удалось открыть папку: {}", e))?;
        }
    }
    Ok(())
}


const DISCORD_CLIENT_ID: &str = "1380279748072312903";
/// Discord принимает обновления не чаще раза в несколько секунд — более частые склеиваются в одно
const MIN_SEND_INTERVAL: Duration = Duration::from_millis(2000);
/// Discord закрыт или ещё не запущен: пробуем подключиться снова с такой паузой
const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);
/// Картинка в карточке активности (внешние https-ссылки Discord подтягивает сам)
const LARGE_IMAGE_URL: &str = "https://raw.githubusercontent.com/Aurum2347/Playly/main/app-icon.png";
const GITHUB_URL: &str = "https://github.com/Aurum2347/Playly";

/* Ограничения Discord: строки активности 2–128 символов, подпись кнопки до 32, ссылка до 512 */
const TEXT_MAX: usize = 128;
const BUTTON_LABEL_MAX: usize = 32;
const URL_MAX: usize = 512;
/// Сколько символов «Название - Исполнитель» попадает в поисковую ссылку (кириллица кодируется в 6 знаков)
const SEARCH_QUERY_MAX: usize = 70;

enum RpcCmd {
    Track {
        title: String,
        artist: String,
        album: String,
        /* Секунды уже с учётом скорости воспроизведения */
        duration_secs: f64,
        position_secs: f64,
        playing: bool,
        status: String,
        search_label: String,
        /* Когда пришла команда: позиция могла устареть, пока команда ждала отправки */
        issued_at: Instant,
        /* Что показывать — настраивается в «Язык и система» */
        show_progress: bool,
        show_buttons: bool,
        show_links: bool,
    },
    Idle {
        details: String,
        status: String,
        show_buttons: bool,
    },
    Clear,
}

struct RpcState {
    tx: mpsc::Sender<RpcCmd>,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Обрезает строку до лимита Discord и дополняет слишком короткую: иначе вся активность отклоняется
fn fit_text(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    let mut out: String = if trimmed.chars().count() > max {
        let mut cut: String = trimmed.chars().take(max - 1).collect();
        cut.push('…');
        cut
    } else {
        trimmed.to_string()
    };
    if out.is_empty() {
        out.push_str("♪♪");
    } else if out.chars().count() < 2 {
        out.push_str(" ♪");
    }
    out
}

fn search_url(query: &str) -> Option<String> {
    let q: String = query.trim().chars().take(SEARCH_QUERY_MAX).collect();
    if q.is_empty() {
        return None;
    }
    let url = format!("https://www.google.com/search?q={}", urlencoding::encode(&q));
    (url.len() <= URL_MAX).then_some(url)
}

fn build_activity(cmd: &RpcCmd) -> Option<activity::Activity<'static>> {
    let assets = |text: &str| {
        activity::Assets::new()
            .large_image(LARGE_IMAGE_URL)
            .large_text(fit_text(text, TEXT_MAX))
    };
    match cmd {
        RpcCmd::Track {
            title,
            artist,
            album,
            duration_secs,
            position_secs,
            playing,
            status,
            search_label,
            issued_at,
            show_progress,
            show_buttons,
            show_links,
        } => {
            /* Ссылки на поиск имеют смысл, только когда видны название и исполнитель */
            let track_search = if *show_links { search_url(&format!("{} - {}", title, artist)) } else { None };
            let mut buttons = Vec::new();
            if *show_buttons {
                buttons.push(activity::Button::new("GitHub", GITHUB_URL));
                if let Some(url) = track_search.clone() {
                    buttons.push(activity::Button::new(fit_text(search_label, BUTTON_LABEL_MAX), url));
                }
            }
            let mut payload = activity::Activity::new()
                .activity_type(activity::ActivityType::Listening)
                /* В списке участников: «Слушает <название трека>», а не «Слушает Playly» */
                .status_display_type(activity::StatusDisplayType::Details)
                .details(fit_text(title, TEXT_MAX))
                .state(fit_text(status, TEXT_MAX))
                .assets(assets(if album.trim().is_empty() { "Playly" } else { album }))
                .buttons(buttons);
            /* Название и исполнитель кликабельны — ведут в поиск */
            if let Some(url) = track_search {
                payload = payload.details_url(url);
            }
            if *show_links {
                if let Some(url) = search_url(artist) {
                    payload = payload.state_url(url);
                }
            }
            if *show_progress && *playing && *duration_secs > 0.0 {
                /* Пока команда ждала отправки, трек продолжал играть */
                let elapsed = issued_at.elapsed().as_secs_f64();
                let dur_ms = (duration_secs * 1000.0) as i64;
                let pos_ms = (((position_secs + elapsed) * 1000.0) as i64).clamp(0, dur_ms);
                let start = now_millis() - pos_ms;
                payload = payload.timestamps(activity::Timestamps::new().start(start).end(start + dur_ms));
            }
            Some(payload)
        }
        RpcCmd::Idle { details, status, show_buttons } => {
            let buttons = if *show_buttons { vec![activity::Button::new("GitHub", GITHUB_URL)] } else { Vec::new() };
            Some(
                activity::Activity::new()
                    .activity_type(activity::ActivityType::Listening)
                    .details(fit_text(details, TEXT_MAX))
                    .state(fit_text(status, TEXT_MAX))
                    .assets(assets("Playly"))
                    .buttons(buttons),
            )
        }
        RpcCmd::Clear => None,
    }
}

/// Отправляет команду, при необходимости переподключаясь. false — Discord недоступен, стоит повторить позже
fn rpc_send(client: &mut Option<DiscordIpcClient>, cmd: &RpcCmd) -> bool {
    for _attempt in 0..2 {
        if client.is_none() {
            /* Очищать нечего, если мы и не были подключены */
            if matches!(cmd, RpcCmd::Clear) {
                return true;
            }
            let mut c = DiscordIpcClient::new(DISCORD_CLIENT_ID);
            match c.connect() {
                Ok(()) => {
                    println!("[RPC] Подключено к Discord");
                    *client = Some(c);
                }
                Err(e) => {
                    eprintln!("[RPC] Discord недоступен: {}", e);
                    return false;
                }
            }
        }

        let Some(cl) = client.as_mut() else { return false };
        let result = match build_activity(cmd) {
            Some(payload) => cl.set_activity(payload),
            None => cl.clear_activity(),
        };
        match result {
            Ok(()) => return true,
            Err(e) => {
                /* Соединение оборвалось (например, Discord перезапустили) — пробуем ещё раз с новым */
                eprintln!("[RPC] Ошибка отправки: {}", e);
                if let Some(mut old) = client.take() {
                    let _ = old.close();
                }
            }
        }
    }
    false
}

fn rpc_worker(rx: mpsc::Receiver<RpcCmd>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut last_send = Instant::now() - MIN_SEND_INTERVAL;
    /* Последняя команда, которую ещё не удалось доставить */
    let mut pending: Option<RpcCmd> = None;

    loop {
        /* Есть недоставленная команда — просыпаемся сами и пробуем снова, даже если новых нет */
        let incoming = if pending.is_some() {
            match rx.recv_timeout(RECONNECT_INTERVAL) {
                Ok(c) => Some(c),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => break,
            }
        };
        if let Some(c) = incoming {
            pending = Some(c);
        }

        /* Склеиваем частые обновления: отправится только самое свежее */
        loop {
            let since = last_send.elapsed();
            if since >= MIN_SEND_INTERVAL {
                break;
            }
            match rx.recv_timeout(MIN_SEND_INTERVAL - since) {
                Ok(newer) => pending = Some(newer),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }

        let Some(cmd) = pending.as_ref() else { continue };
        if rpc_send(&mut client, cmd) {
            last_send = Instant::now();
            pending = None;
        }
    }

    if let Some(mut c) = client {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}

/* Аргументы приходят из JS по именам — собирать их в структуру незачем */
#[allow(clippy::too_many_arguments)]
#[command]
fn discord_update_presence(
    state: tauri::State<'_, RpcState>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_secs: f64,
    is_playing: bool,
    position_secs: f64,
    status: String,
    search_label: String,
    show_progress: Option<bool>,
    show_buttons: Option<bool>,
    show_links: Option<bool>,
) -> bool {
    state
        .tx
        .send(RpcCmd::Track {
            title,
            artist,
            album: album.unwrap_or_default(),
            duration_secs: duration_secs.max(0.0),
            position_secs: position_secs.max(0.0),
            playing: is_playing,
            status,
            search_label,
            issued_at: Instant::now(),
            show_progress: show_progress.unwrap_or(true),
            show_buttons: show_buttons.unwrap_or(true),
            show_links: show_links.unwrap_or(true),
        })
        .is_ok()
}

#[command]
fn discord_idle_presence(
    state: tauri::State<'_, RpcState>,
    details: String,
    status: String,
    show_buttons: Option<bool>,
) -> bool {
    state
        .tx
        .send(RpcCmd::Idle { details, status, show_buttons: show_buttons.unwrap_or(true) })
        .is_ok()
}

#[command]
fn discord_clear_presence(state: tauri::State<'_, RpcState>) -> bool {
    state.tx.send(RpcCmd::Clear).is_ok()
}


/* ===== Кеш ===== */

const APP_IDENTIFIER: &str = "com.playly.player";
/// Метка: при следующем запуске удалить кеш WebView (сейчас его файлы заняты работающим окном)
const WIPE_MARKER: &str = "wipe-webview-cache";

/// Папки WebView, которые можно безболезненно удалить: всё это пересоздаётся само
const WEBVIEW_CACHE_DIRS: &[&str] = &[
    "GrShaderCache",
    "ShaderCache",
    "GraphiteDawnCache",
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
];

#[derive(serde::Serialize)]
pub struct FileSize {
    name: String,
    size: u64,
}

fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|e| dir_size(&e.path())).sum())
        .unwrap_or(0)
}

/// Папка данных WebView: на Windows это WebView2 в %LOCALAPPDATA%, на Linux — кеш WebKitGTK
fn webview_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(|d| std::path::PathBuf::from(d).join(APP_IDENTIFIER).join("EBWebView"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("XDG_CACHE_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".cache")))
            .map(|d| d.join(APP_IDENTIFIER))
    }
}

fn webview_cache_paths() -> Vec<std::path::PathBuf> {
    let Some(root) = webview_data_dir() else { return Vec::new() };
    if cfg!(target_os = "windows") {
        WEBVIEW_CACHE_DIRS.iter().map(|d| root.join(d)).collect()
    } else {
        vec![root]
    }
}

/// Размер файла или папки целиком, байты
#[command]
fn path_size(path: String) -> u64 {
    dir_size(std::path::Path::new(&path))
}

/// Файлы папки с размерами (без вложенных папок)
#[command]
fn list_dir_sizes(path: String) -> Vec<FileSize> {
    fs::read_dir(&path)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let meta = e.metadata().ok()?;
                    meta.is_file().then(|| FileSize {
                        name: e.file_name().to_string_lossy().into_owned(),
                        size: meta.len(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[command]
fn webview_cache_size() -> u64 {
    webview_cache_paths().iter().map(|p| dir_size(p)).sum()
}

#[command]
fn schedule_webview_cache_wipe(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(WIPE_MARKER), b"1").map_err(|e| e.to_string())
}

/// Вызывается до создания окон: файлы кеша ещё никем не заняты
fn wipe_webview_cache_if_requested(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_local_data_dir() else { return };
    let marker = dir.join(WIPE_MARKER);
    if !marker.exists() {
        return;
    }
    let _ = fs::remove_file(&marker);
    for p in webview_cache_paths() {
        let _ = fs::remove_dir_all(&p);
    }
}

/* ===== Мини-плеер ===== */

const MINI_LABEL: &str = "mini";
/* Размер по умолчанию и пределы изменения размера (логические пиксели) */
const MINI_WIDTH: f64 = 400.0;
const MINI_HEIGHT: f64 = 204.0;
const MINI_MIN: (f64, f64) = (300.0, 132.0);
const MINI_MAX: (f64, f64) = (720.0, 420.0);
/// Отступ от панели задач и краёв окна
const MINI_MARGIN: f64 = 12.0;
/// Высота нижнего плеера в главном окне: мини-плеер встаёт над ним
const MAIN_PLAYER_HEIGHT: f64 = 96.0;

/// Через сколько после потери фокуса проверять, не вернулся ли он (клик внутри WebView, начало перетаскивания)
const MINI_BLUR_CHECK: Duration = Duration::from_millis(150);
/// Окно двигали или тянули за край не раньше этого — считаем, что взаимодействие ещё идёт
const MINI_INTERACTION_GRACE: Duration = Duration::from_millis(600);
/// Окно перестало двигаться — пора вернуть его в границы экрана
const MINI_SETTLE: Duration = Duration::from_millis(250);

#[derive(Default)]
struct MiniState {
    /* Закреплённый мини-плеер не прячется, когда теряет фокус */
    pinned: std::sync::atomic::AtomicBool,
    /* Пользователь сам перетащил окно — больше не ставим его к трею, пока не попросят */
    user_placed: std::sync::atomic::AtomicBool,
    /* Когда окно спряталось из-за потери фокуса: клик по иконке трея сначала забирает фокус */
    hidden_at: std::sync::Mutex<Option<Instant>>,
    /* Последнее перемещение / изменение размера / нажатие на шапку или уголок */
    interaction_at: std::sync::Mutex<Option<Instant>>,
    /* Уже идёт слежка «не ушёл ли пользователь в другое окно» */
    blur_watch: std::sync::atomic::AtomicBool,
    /* Мини-плеер хоть раз был активным окном с момента показа: только тогда его можно прятать */
    armed: std::sync::atomic::AtomicBool,
    /* Номер последнего перемещения: окно встаёт в границы экрана, только когда движение закончилось */
    move_seq: std::sync::atomic::AtomicU64,
}

impl MiniState {
    fn touch(&self) {
        *self.interaction_at.lock().unwrap() = Some(Instant::now());
    }

    fn interacting(&self) -> bool {
        self.interaction_at
            .lock()
            .unwrap()
            .is_some_and(|t| t.elapsed() < MINI_INTERACTION_GRACE)
    }

    fn interacted_within(&self, d: Duration) -> bool {
        self.interaction_at.lock().unwrap().is_some_and(|t| t.elapsed() < d)
    }
}

/// Мини-плеер — активное окно Windows? Клик внутри WebView отдаёт фокус клавиатуры дочернему окну,
/// и tao считает окно «не в фокусе» (is_focused() == false), хотя пользователь работает именно с ним.
/// Поэтому смотрим, чьё окно на переднем плане
#[cfg(target_os = "windows")]
fn mini_in_foreground(w: &tauri::WebviewWindow) -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetAncestor(hwnd: isize, flags: u32) -> isize;
    }
    const GA_ROOT: u32 = 2;
    let Ok(hwnd) = w.hwnd() else { return false };
    let fg = unsafe { GetForegroundWindow() };
    fg != 0 && unsafe { GetAncestor(fg, GA_ROOT) } == hwnd.0 as isize
}

#[cfg(not(target_os = "windows"))]
fn mini_in_foreground(w: &tauri::WebviewWindow) -> bool {
    w.is_focused().unwrap_or(false)
}

/// Прямоугольник рабочей области (без панели задач) монитора, ближайшего к точке
fn nearest_work_area(app: &tauri::AppHandle, x: f64, y: f64) -> Option<(f64, f64, f64, f64)> {
    let monitors = app.available_monitors().ok()?;
    let rect = |m: &tauri::Monitor| {
        let a = m.work_area();
        (a.position.x as f64, a.position.y as f64, a.size.width as f64, a.size.height as f64)
    };
    monitors
        .iter()
        .map(rect)
        .min_by(|a, b| {
            /* Расстояние от точки до прямоугольника: 0, если точка внутри */
            let dist = |(rx, ry, rw, rh): (f64, f64, f64, f64)| {
                let dx = (rx - x).max(0.0).max(x - (rx + rw));
                let dy = (ry - y).max(0.0).max(y - (ry + rh));
                dx * dx + dy * dy
            };
            dist(*a).total_cmp(&dist(*b))
        })
}

/// Мини-плеер не должен уезжать за край: ставим его целиком в рабочую область того монитора,
/// на котором (или ближе всего к которому) оказался его центр — так его можно спокойно переносить между экранами
fn keep_mini_on_screen(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else { return };
    let (x, y) = (pos.x as f64, pos.y as f64);
    let (ww, wh) = (size.width as f64, size.height as f64);
    let Some((ax, ay, aw, ah)) = nearest_work_area(app, x + ww / 2.0, y + wh / 2.0) else { return };
    let nx = x.clamp(ax, (ax + aw - ww).max(ax));
    let ny = y.clamp(ay, (ay + ah - wh).max(ay));
    if (nx - x).abs() >= 1.0 || (ny - y).abs() >= 1.0 {
        let _ = w.set_position(tauri::PhysicalPosition::new(nx.round() as i32, ny.round() as i32));
    }
}

/// Пока мини-плеер открыт, следит, не ушёл ли пользователь в другое окно, и тогда прячет его.
/// Прятать сразу по событию «потерял фокус» нельзя: на Windows оно приходит и при клике внутри окна,
/// и при перетаскивании, и при изменении размера
fn watch_mini_blur(app: tauri::AppHandle, w: tauri::WebviewWindow) {
    let state = app.state::<MiniState>();
    if state.blur_watch.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    thread::spawn(move || {
        let state = app.state::<MiniState>();
        loop {
            thread::sleep(MINI_BLUR_CHECK);
            if state.pinned.load(std::sync::atomic::Ordering::Relaxed) || !w.is_visible().unwrap_or(false) {
                break;
            }
            if mini_in_foreground(&w) {
                state.armed.store(true, std::sync::atomic::Ordering::Relaxed);
                continue;
            }
            /* Окно ещё двигают или тянут за край — ждём */
            if state.interacting() {
                continue;
            }
            /* Windows не всегда отдаёт фокус показанному окну: пока мини-плеер ни разу не был активным,
               не прячем его — иначе он исчезал бы сам через долю секунды */
            if !state.armed.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            if state.interacted_within(MINI_INTERACTION_GRACE * 2) {
                /* Перетаскивание только что закончилось: возвращаем окну фокус, чтобы клик мимо снова его прятал */
                let _ = w.set_focus();
                continue;
            }
            let _ = w.hide();
            *state.hidden_at.lock().unwrap() = Some(Instant::now());
            break;
        }
        state.blur_watch.store(false, std::sync::atomic::Ordering::Release);
    });
}

fn mini_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        return Some(w);
    }
    let w = tauri::WebviewWindowBuilder::new(app, MINI_LABEL, tauri::WebviewUrl::App("index.html".into()))
        .title("Playly")
        .inner_size(MINI_WIDTH, MINI_HEIGHT)
        .min_inner_size(MINI_MIN.0, MINI_MIN.1)
        .max_inner_size(MINI_MAX.0, MINI_MAX.1)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("[mini] Не удалось создать окно: {}", e))
        .ok()?;

    let handle = app.clone();
    let win = w.clone();
    w.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false) => {
            let state = handle.state::<MiniState>();
            if !state.pinned.load(std::sync::atomic::Ordering::Relaxed) {
                /* Фокус был у окна — значит, его можно прятать, когда пользователь уйдёт */
                state.armed.store(true, std::sync::atomic::Ordering::Relaxed);
                watch_mini_blur(handle.clone(), win.clone());
            }
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let state = handle.state::<MiniState>();
            state.touch();
            let seq = state.move_seq.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
            let (app, w) = (handle.clone(), win.clone());
            thread::spawn(move || {
                thread::sleep(MINI_SETTLE);
                if app.state::<MiniState>().move_seq.load(std::sync::atomic::Ordering::Acquire) == seq {
                    keep_mini_on_screen(&app, &w);
                }
            });
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = win.hide();
        }
        _ => {}
    });
    Some(w)
}

/// Куда поставить мини-плеер:
///  • открыт кликом по трею — рядом с иконкой, над панелью задач (или под ней, если она сверху);
///  • открыт из главного окна — в его правом нижнем углу, над нижним плеером.
fn place_mini(app: &tauri::AppHandle, w: &tauri::WebviewWindow, anchor: Option<tauri::PhysicalPosition<f64>>) {
    let size = w.outer_size().ok();
    let main = app
        .get_webview_window("main")
        .filter(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(false));
    let monitor = anchor
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| main.as_ref().and_then(|m| m.current_monitor().ok().flatten()))
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let (ww, wh) = size
        .map(|s| (s.width as f64, s.height as f64))
        .unwrap_or((MINI_WIDTH * scale, MINI_HEIGHT * scale));
    let margin = MINI_MARGIN * scale;

    let (x, y) = match (anchor, main) {
        (Some(p), _) => {
            let y = if p.y > ay + ah / 2.0 { ay + ah - wh - margin } else { ay + margin };
            (p.x - ww / 2.0, y)
        }
        (None, Some(m)) => {
            let pos = m.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((ax, ay));
            let sz = m.outer_size().map(|s| (s.width as f64, s.height as f64)).unwrap_or((aw, ah));
            (pos.0 + sz.0 - ww - margin * 2.0, pos.1 + sz.1 - wh - MAIN_PLAYER_HEIGHT * scale - margin)
        }
        /* Главное окно спрятано — в правый нижний угол экрана, как уведомления */
        (None, None) => (ax + aw - ww - margin, ay + ah - wh - margin),
    };
    let x = x.clamp(ax + margin, (ax + aw - ww - margin).max(ax + margin));
    let y = y.clamp(ay + margin, (ay + ah - wh - margin).max(ay + margin));
    let _ = w.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// Окно WebView нельзя создавать из обработчика событий главного потока (на Windows это зависание),
/// поэтому при первом открытии мини-плеер создаётся в отдельном потоке
static MINI_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
#[command]
fn set_mini_enabled(app: tauri::AppHandle, enabled: bool) {
    MINI_ENABLED.store(enabled, std::sync::atomic::Ordering::SeqCst);
    if !enabled { hide_mini_player(app); }
}
fn toggle_mini(app: &tauri::AppHandle, anchor: Option<tauri::PhysicalPosition<f64>>) {
    if !MINI_ENABLED.load(std::sync::atomic::Ordering::SeqCst) { return; }
    match app.get_webview_window(MINI_LABEL) {
        Some(w) => toggle_mini_window(app, &w, anchor),
        None => {
            let app = app.clone();
            thread::spawn(move || {
                if let Some(w) = mini_window(&app) {
                    toggle_mini_window(&app, &w, anchor);
                }
            });
        }
    }
}

fn toggle_mini_window(app: &tauri::AppHandle, w: &tauri::WebviewWindow, anchor: Option<tauri::PhysicalPosition<f64>>) {
    let state = app.state::<MiniState>();
    /* Окно только что спряталось из-за этого же клика — значит, его хотели закрыть */
    let just_hidden = state
        .hidden_at
        .lock()
        .unwrap()
        .take()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(350));
    if just_hidden || w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    show_mini_window(app, w, anchor);
}

fn show_mini_window(app: &tauri::AppHandle, w: &tauri::WebviewWindow, anchor: Option<tauri::PhysicalPosition<f64>>) {
    let state = app.state::<MiniState>();
    if w.is_visible().unwrap_or(false) {
        let _ = w.set_focus();
        return;
    }
    if !state.user_placed.load(std::sync::atomic::Ordering::Relaxed) {
        place_mini(app, w, anchor);
    }
    let _ = w.show();
    let _ = w.set_focus();
    state.armed.store(false, std::sync::atomic::Ordering::Relaxed);
    watch_mini_blur(app.clone(), w.clone());
}

/// Показать мини-плеер (из меню трея): в отличие от toggle_mini, уже открытый не прячется
fn open_mini(app: &tauri::AppHandle, anchor: Option<tauri::PhysicalPosition<f64>>) {
    if !MINI_ENABLED.load(std::sync::atomic::Ordering::SeqCst) { return; }
    match app.get_webview_window(MINI_LABEL) {
        Some(w) => show_mini_window(app, &w, anchor),
        None => {
            let app = app.clone();
            thread::spawn(move || {
                if let Some(w) = mini_window(&app) {
                    show_mini_window(&app, &w, anchor);
                }
            });
        }
    }
}

#[command]
fn toggle_mini_player(app: tauri::AppHandle) {
    toggle_mini(&app, None);
}

#[command]
fn hide_mini_player(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        let _ = w.hide();
    }
}

#[command]
fn set_mini_pinned(app: tauri::AppHandle, state: tauri::State<'_, MiniState>, pinned: bool) {
    state.pinned.store(pinned, std::sync::atomic::Ordering::Relaxed);
    /* Открепили — снова следим, чтобы клик мимо прятал окно */
    if !pinned {
        if let Some(w) = app.get_webview_window(MINI_LABEL) {
            watch_mini_blur(app.clone(), w);
        }
    }
}

/// Пользователь начал перетаскивать мини-плеер — запоминаем, что место выбрано им
#[command]
fn mini_user_moved(state: tauri::State<'_, MiniState>) {
    state.user_placed.store(true, std::sync::atomic::Ordering::Relaxed);
    state.touch();
}

/// Нажали на уголок изменения размера: окно не должно спрятаться, пока его тянут
#[command]
fn mini_touch(state: tauri::State<'_, MiniState>) {
    state.touch();
}

/// «Вернуть на место»: снова ставить мини-плеер к трею / в угол главного окна
#[command]
fn reset_mini_position(app: tauri::AppHandle, state: tauri::State<'_, MiniState>) {
    state.user_placed.store(false, std::sync::atomic::Ordering::Relaxed);
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        place_mini(&app, &w, None);
    }
}

#[command]
fn show_main_window(app: tauri::AppHandle) {
    hide_mini_player(app.clone());
    reveal_main_window(&app);
}

/* ===== Обновление портативной версии ===== */
/*
 * Установленная версия обновляется установщиком (это делает сам плагин). Портативный Playly.exe
 * установщиком обновлять нельзя — он поставил бы вторую копию. Поэтому для него:
 *   1. из latest.json берётся запись PORTABLE_TARGET — новый .exe с подписью;
 *   2. он скачивается и проверяется тем же ключом, что и установщик, и кладётся рядом как *.update.exe;
 *   3. по команде «перезапустить» текущий .exe переименовывается в *.old.exe (Windows это позволяет
 *      даже работающему файлу), новый встаёт на его место, и Playly запускается заново;
 *   4. при следующем запуске *.old.exe удаляется.
 */

const PORTABLE_TARGET: &str = "windows-x86_64-portable";

fn exe_sibling(ext: &str) -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.with_extension(ext))
}

/// Портативная копия: рядом с .exe нет деинсталлятора, который кладёт установщик
#[command]
fn is_portable() -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| !dir.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

/// Может ли Playly обновиться сам: на Windows — да (установщик или подмена .exe),
/// на Linux — только AppImage; пакеты .deb и .rpm обновляются вручную
#[command]
fn can_self_update() -> bool {
    if cfg!(target_os = "windows") {
        return true;
    }
    cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_some()
}

/// Скачать новый .exe и проверить подпись. Прогресс: {event: "Started", total} и {event: "Progress", chunk}
#[command]
async fn portable_download(
    app: tauri::AppHandle,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    if !is_portable() {
        return Err("Подмена файла доступна только портативной версии для Windows".into());
    }
    let update = app
        .updater_builder()
        .target(PORTABLE_TARGET)
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "В релизе нет портативной версии".to_string())?;
    let mut started = false;
    let bytes = update
        .download(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = on_progress.send(serde_json::json!({ "event": "Started", "total": total }));
                }
                let _ = on_progress.send(serde_json::json!({ "event": "Progress", "chunk": chunk }));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    storage::replace(&exe_sibling("update.exe")?, &bytes).map_err(|e| format!("Не удалось сохранить обновление рядом с Playly: {}", e))?;
    Ok(update.version)
}

/// Подменить .exe скачанным и перезапуститься
#[command]
fn portable_apply(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("В режиме разработки .exe не подменяется".into());
    }
    /* На Linux и у установленной версии исполняемый файл подменять нельзя — их обновляет установщик/пакет */
    if !is_portable() {
        return Err("Подмена файла доступна только портативной версии для Windows".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let staged = exe_sibling("update.exe")?;
    let old = exe_sibling("old.exe")?;
    if !staged.exists() {
        return Err("Обновление ещё не скачано".into());
    }
    let _ = fs::remove_file(&old);
    fs::rename(&exe, &old).map_err(|e| format!("Не удалось заменить Playly: {}", e))?;
    if let Err(e) = fs::rename(&staged, &exe) {
        fs::rename(&old, &exe).map_err(|restore| format!("Не удалось восстановить Playly: {restore}. Предыдущая версия: {}", old.display()))?;
        return Err(format!("Не удалось заменить Playly: {}", e));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // The helper restores the backup if the new app fails before reaching its main screen.
        let helper = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", include_str!("portable-restart.ps1")])
            .env("PLAYLY_UPDATE_EXE", &exe)
            .env("PLAYLY_UPDATE_BACKUP", &old)
            .env("PLAYLY_UPDATE_PID", std::process::id().to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
        if let Err(error) = helper {
            fs::rename(&exe, &staged).map_err(|e| format!("Не удалось отложить новую версию: {e}. Резервная копия: {}", old.display()))?;
            fs::rename(&old, &exe).map_err(|e| format!("Не удалось восстановить Playly: {e}. Резервная копия: {}", old.display()))?;
            return Err(format!("Не удалось запустить перезапуск: {error}"));
        }
    }
    app.exit(0);
    Ok(())
}

/// Остатки прошлого обновления: старый .exe и недокачанный/неустановленный новый
fn cleanup_portable_update() {
    for ext in ["update.exe", "update.playly-tmp"] {
        if let Ok(p) = exe_sibling(ext) {
            let _ = fs::remove_file(p);
        }
    }
}

#[command]
fn confirm_portable_update() {
    if let Ok(old) = exe_sibling("old.exe") { let _ = fs::remove_file(old); }
}

/// Полностью закрыть Playly (крестик окна только прячет его в трей)
#[command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/* ===== Меню трея ===== */
/*
 * На Windows системного меню у иконки трея нет: левый клик открывает Playly, правый — своё меню (см. «Своё меню трея»).
 * На Linux иконка трея (AppIndicator) о кликах не сообщает вовсе — там работает только меню,
 * поэтому те же действия собраны в него.
 */

/// Пункты меню трея — чтобы переводить их на язык интерфейса (на Windows список пуст)
#[derive(Default)]
struct TrayMenu(std::sync::Mutex<Vec<tauri::menu::MenuItem<tauri::Wry>>>);

#[cfg(target_os = "linux")]
fn tray_with_menu(
    app: &tauri::App,
    tray: TrayIconBuilder<tauri::Wry>,
) -> tauri::Result<TrayIconBuilder<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem};
    /* Подписи по умолчанию; главное окно сразу присылает их на языке интерфейса (set_tray_labels) */
    let open = MenuItem::with_id(app, "open", "Open Playly", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Mini player", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Playly", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &mini, &quit])?;
    *app.state::<TrayMenu>().0.lock().unwrap() = vec![open, mini, quit];
    Ok(tray.menu(&menu).on_menu_event(|app, event| match event.id().as_ref() {
        "open" => {
            hide_mini_player(app.clone());
            reveal_main_window(app);
        }
        "mini" => toggle_mini(app, None),
        "quit" => app.exit(0),
        _ => {}
    }))
}

#[cfg(not(target_os = "linux"))]
fn tray_with_menu(
    _app: &tauri::App,
    tray: TrayIconBuilder<tauri::Wry>,
) -> tauri::Result<TrayIconBuilder<tauri::Wry>> {
    Ok(tray)
}

/// Подписи пунктов меню трея: «Открыть Playly», «Мини-плеер», «Выйти» на языке интерфейса
#[command]
fn set_tray_labels(state: tauri::State<'_, TrayMenu>, open: String, mini: String, quit: String) {
    for (item, text) in state.0.lock().unwrap().iter().zip([open, mini, quit]) {
        let _ = item.set_text(text);
    }
}

/* ===== Своё меню трея (Windows) ===== */
/*
 * Системное меню Windows не оформить, поэтому по правому клику открывается маленькое прозрачное окно
 * с меню в стиле Playly (src/tray/TrayMenu.tsx). Как и мини-плеер, оно создаётся заранее и скрытым,
 * а прячется, когда пользователь уходит в другое окно или выбирает пункт.
 */

const TRAY_MENU_LABEL: &str = "traymenu";
/* Размер окна меню (логические пиксели): карточка меню плюс поля под тень */
const TRAY_MENU_WIDTH: f64 = 272.0;
const TRAY_MENU_HEIGHT: f64 = 268.0;
/// Как часто проверять, не ушёл ли пользователь из меню
const TRAY_MENU_CHECK: Duration = Duration::from_millis(80);

#[derive(Default)]
struct TrayMenuState {
    /* Где кликнули по иконке: туда же ставим мини-плеер, если его выберут в меню */
    anchor: std::sync::Mutex<Option<tauri::PhysicalPosition<f64>>>,
    /* Когда меню спряталось из-за потери фокуса: повторный клик по иконке должен его закрыть, а не открыть снова */
    hidden_at: std::sync::Mutex<Option<Instant>>,
    /* Номер показа: слежка за фокусом от прошлого показа сама завершается */
    show_seq: std::sync::atomic::AtomicU64,
}

fn tray_menu_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(TRAY_MENU_LABEL) {
        return Some(w);
    }
    tauri::WebviewWindowBuilder::new(app, TRAY_MENU_LABEL, tauri::WebviewUrl::App("index.html".into()))
        .title("Playly")
        .inner_size(TRAY_MENU_WIDTH, TRAY_MENU_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("[tray] Не удалось создать меню: {}", e))
        .ok()
}

fn hide_tray_menu_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(TRAY_MENU_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        }
    }
}

/// Меню встаёт углом к курсору: над панелью задач (или под ней, если она сверху), не выходя за экран
fn place_tray_menu(app: &tauri::AppHandle, w: &tauri::WebviewWindow, p: tauri::PhysicalPosition<f64>) {
    let monitor = app
        .monitor_from_point(p.x, p.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let (ww, wh) = (TRAY_MENU_WIDTH * scale, TRAY_MENU_HEIGHT * scale);
    /* Тень в окне — прозрачные поля по 8 px: сама карточка меню оказывается вплотную к курсору */
    let pad = 8.0 * scale;
    let x = if p.x + ww - pad > ax + aw { p.x - ww + pad } else { p.x - pad };
    let y = if p.y > ay + ah / 2.0 { p.y - wh + pad } else { p.y - pad };
    let x = x.clamp(ax, (ax + aw - ww).max(ax));
    let y = y.clamp(ay, (ay + ah - wh).max(ay));
    let _ = w.set_size(tauri::LogicalSize::new(TRAY_MENU_WIDTH, TRAY_MENU_HEIGHT));
    let _ = w.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

/// Следит, пока меню открыто: пользователь кликнул мимо (другое окно стало активным) — прячем
fn watch_tray_menu(app: tauri::AppHandle, w: tauri::WebviewWindow, seq: u64) {
    thread::spawn(move || {
        let state = app.state::<TrayMenuState>();
        let mut armed = false;
        loop {
            thread::sleep(TRAY_MENU_CHECK);
            if state.show_seq.load(std::sync::atomic::Ordering::Acquire) != seq || !w.is_visible().unwrap_or(false) {
                break;
            }
            if mini_in_foreground(&w) {
                armed = true;
                continue;
            }
            /* Windows может отдать фокус не сразу — прячем только после того, как меню хоть раз было активным */
            if armed {
                let _ = w.hide();
                *state.hidden_at.lock().unwrap() = Some(Instant::now());
                break;
            }
        }
    });
}

fn show_tray_menu_window(app: &tauri::AppHandle, w: &tauri::WebviewWindow, p: tauri::PhysicalPosition<f64>) {
    let state = app.state::<TrayMenuState>();
    let just_hidden = state
        .hidden_at
        .lock()
        .unwrap()
        .take()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(350));
    if just_hidden || w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    *state.anchor.lock().unwrap() = Some(p);
    place_tray_menu(app, w, p);
    let seq = state.show_seq.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
    /* Меню знает, что его открыли: перезапускает анимацию появления и просит свежее состояние */
    let _ = w.emit_to(TRAY_MENU_LABEL, "traymenu:shown", ());
    let _ = w.show();
    let _ = w.set_focus();
    watch_tray_menu(app.clone(), w.clone(), seq);
}

/// Правый клик по иконке трея. Окно WebView нельзя создавать в обработчике главного потока — только в отдельном
fn open_tray_menu(app: &tauri::AppHandle, p: tauri::PhysicalPosition<f64>) {
    match app.get_webview_window(TRAY_MENU_LABEL) {
        Some(w) => show_tray_menu_window(app, &w, p),
        None => {
            let app = app.clone();
            thread::spawn(move || {
                if let Some(w) = tray_menu_window(&app) {
                    /* Свежему окну нужно время, чтобы загрузить страницу, иначе мелькнёт пустая рамка */
                    thread::sleep(Duration::from_millis(250));
                    show_tray_menu_window(&app, &w, p);
                }
            });
        }
    }
}

/// Пункт меню трея: «show» — главное окно, «mini» — мини-плеер, «quit» — выйти, «close» — просто закрыть меню
#[command]
fn tray_menu_action(app: tauri::AppHandle, state: tauri::State<'_, TrayMenuState>, action: String) {
    hide_tray_menu_window(&app);
    match action.as_str() {
        "show" => {
            hide_mini_player(app.clone());
            reveal_main_window(&app);
        }
        "mini" => {
            let anchor = *state.anchor.lock().unwrap();
            open_mini(&app, anchor);
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Можно ли открыть мини-плеер (его отключают в настройках) — меню трея прячет пункт, если нет
#[command]
fn mini_enabled() -> bool {
    MINI_ENABLED.load(std::sync::atomic::Ordering::SeqCst)
}

fn main() {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || rpc_worker(rx));

    let builder = tauri::Builder::default();
    /* Должен быть первым: повторный запуск не открывает вторую копию, а показывает уже работающую */
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        /* Отдаём любой опубликованный релиз, даже старее текущей версии: что с ним делать, решает
           src/lib/updater.ts (новее — обновление, другой — «неизвестная версия», можно поставить релиз) */
        .plugin(tauri_plugin_updater::Builder::new().default_version_comparator(|_, _| true).build());

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(RpcState { tx })
        .manage(MiniState::default())
        .manage(TrayMenu::default())
        .manage(TrayMenuState::default())
        .setup(|app| {
            wipe_webview_cache_if_requested(app.handle());
            if is_portable() {
                cleanup_portable_update();
            }

            // Трей: левый клик — открыть Playly, правый — своё меню (Показать плеер / Мини-плеер / Выйти).
            // На Linux кликов нет — там меню (см. tray_with_menu)
            let icon = app
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| tauri::image::Image::new(&[0, 0, 0, 0], 1, 1));

            let tray = TrayIconBuilder::with_id("playly")
                .icon(icon)
                .tooltip("Playly")
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        hide_tray_menu_window(tray.app_handle());
                        hide_mini_player(tray.app_handle().clone());
                        reveal_main_window(tray.app_handle());
                    }
                    TrayIconEvent::Click {
                        button: MouseButton::Right,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } => open_tray_menu(tray.app_handle(), position),
                    _ => {}
                });
            let _tray = tray_with_menu(app, tray)?.build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            /* Мини-плеер создаётся заранее и скрытым (в отдельном потоке): по клику на трей он появляется мгновенно */
            let handle = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(3));
                mini_window(&handle);
                /* И меню трея — на Linux вместо него системное меню */
                if !cfg!(target_os = "linux") {
                    tray_menu_window(&handle);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media_audio::decode_media_audio,
            media_audio::cancel_media_decode,
            storage::save_track_lyrics,
            set_mini_enabled,
            storage::set_application_icon,
            storage::reset_application_icon,
            storage::create_icon_shortcut,
            storage::write_library_json,
            storage::read_library_json,
            storage::write_track_tags,
            get_track_metadata,
            get_file_mtime,
            get_path_created,
            get_track_lyrics,
            reveal_item_in_dir,
            discord_update_presence,
            discord_idle_presence,
            discord_clear_presence,
            path_size,
            list_dir_sizes,
            webview_cache_size,
            schedule_webview_cache_wipe,
            toggle_mini_player,
            hide_mini_player,
            set_mini_pinned,
            show_main_window,
            mini_user_moved,
            mini_touch,
            is_portable,
            can_self_update,
            portable_download,
            portable_apply,
            confirm_portable_update,
            reset_mini_position,
            quit_app,
            set_tray_labels,
            tray_menu_action,
            mini_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
