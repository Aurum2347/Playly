//! Характеристики устройства (для рекомендации режима экономии), режим стримера
//! (окна Playly не попадают в захват экрана) и тихое уведомление «Playly работает в трее».

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSpecs {
    /// Объём оперативной памяти, МБ (0 — узнать не удалось)
    pub total_memory_mb: u64,
    /// Логических ядер процессора
    pub cpu_threads: u32,
}

#[cfg(target_os = "windows")]
fn total_memory_mb() -> u64 {
    #[repr(C)]
    #[allow(non_snake_case)]
    struct MemoryStatusEx {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buf: *mut MemoryStatusEx) -> i32;
    }
    let mut st = MemoryStatusEx {
        dwLength: std::mem::size_of::<MemoryStatusEx>() as u32,
        dwMemoryLoad: 0,
        ullTotalPhys: 0,
        ullAvailPhys: 0,
        ullTotalPageFile: 0,
        ullAvailPageFile: 0,
        ullTotalVirtual: 0,
        ullAvailVirtual: 0,
        ullAvailExtendedVirtual: 0,
    };
    if unsafe { GlobalMemoryStatusEx(&mut st) } != 0 {
        st.ullTotalPhys / (1024 * 1024)
    } else {
        0
    }
}

#[cfg(target_os = "linux")]
fn total_memory_mb() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<u64>().ok())
        })
        .map(|kb| kb / 1024)
        .unwrap_or(0)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn total_memory_mb() -> u64 {
    0
}

/// Грубая оценка железа: только объём памяти и число потоков процессора, не тест производительности
#[tauri::command]
pub fn system_specs() -> SystemSpecs {
    SystemSpecs {
        total_memory_mb: total_memory_mb(),
        cpu_threads: thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(0),
    }
}

/* ===== Режим стримера: скрытие окон от захвата экрана ===== */

static CAPTURE_HIDDEN: AtomicBool = AtomicBool::new(false);

/// Окна, которые показывает Playly: главное, мини-плеер, меню трея и уведомление
const WINDOWS: [&str; 4] = ["main", "mini", "traymenu", NOTICE_LABEL];

/// Применить текущий режим к окну (вызывается и для окон, созданных позже)
pub fn apply_capture_policy(w: &tauri::WebviewWindow) {
    /* На Windows 10 2004+ это WDA_EXCLUDEFROMCAPTURE: окно видно пользователю, но не попадает в OBS, Discord и снимки экрана */
    let _ = w.set_content_protected(CAPTURE_HIDDEN.load(Ordering::SeqCst));
}

#[tauri::command]
pub fn set_capture_hidden(app: tauri::AppHandle, hidden: bool) -> bool {
    CAPTURE_HIDDEN.store(hidden, Ordering::SeqCst);
    let mut ok = true;
    for label in WINDOWS {
        if let Some(w) = app.get_webview_window(label) {
            ok &= w.set_content_protected(hidden).is_ok();
        }
    }
    ok
}

/// Поддерживает ли система скрытие окна от захвата
#[tauri::command]
pub fn capture_hide_supported() -> bool {
    cfg!(any(target_os = "windows", target_os = "macos"))
}

/* ===== Уведомление «Playly продолжает работать в трее» ===== */
/*
 * Своё маленькое окно в углу экрана, а не системный тост: оно беззвучное, выглядит как Playly
 * и не требует регистрации приложения в системе уведомлений (портативная версия тоже работает).
 */

pub const NOTICE_LABEL: &str = "notice";
const NOTICE_WIDTH: f64 = 340.0;
const NOTICE_HEIGHT: f64 = 128.0;
const NOTICE_MARGIN: f64 = 12.0;

#[derive(Default)]
pub struct NoticeState {
    text: Mutex<Option<(String, String)>>,
}

fn notice_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(NOTICE_LABEL) {
        return Some(w);
    }
    let w = tauri::WebviewWindowBuilder::new(app, NOTICE_LABEL, tauri::WebviewUrl::App("index.html".into()))
        .title("Playly")
        .inner_size(NOTICE_WIDTH, NOTICE_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("[notice] Не удалось создать окно: {}", e))
        .ok()?;
    apply_capture_policy(&w);
    Some(w)
}

fn place_notice(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    let Some(monitor) = app.primary_monitor().ok().flatten() else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (area.position.x as f64, area.position.y as f64);
    let (aw, ah) = (area.size.width as f64, area.size.height as f64);
    let (ww, wh) = (NOTICE_WIDTH * scale, NOTICE_HEIGHT * scale);
    let m = NOTICE_MARGIN * scale;
    let _ = w.set_size(tauri::LogicalSize::new(NOTICE_WIDTH, NOTICE_HEIGHT));
    let _ = w.set_position(tauri::PhysicalPosition::new(
        (ax + aw - ww - m).round() as i32,
        (ay + ah - wh - m).round() as i32,
    ));
}

fn show_notice_window(app: &tauri::AppHandle, w: &tauri::WebviewWindow) {
    place_notice(app, w);
    let _ = w.emit_to(NOTICE_LABEL, "notice:shown", ());
    /* Без set_focus: уведомление не должно отбирать фокус у программы, в которой работает пользователь */
    let _ = w.show();
}

/// Показать уведомление (текст приходит из главного окна уже на языке интерфейса)
#[tauri::command]
pub fn show_tray_notice(app: tauri::AppHandle, state: tauri::State<'_, NoticeState>, title: String, body: String) {
    *state.text.lock().unwrap() = Some((title, body));
    match app.get_webview_window(NOTICE_LABEL) {
        Some(w) => show_notice_window(&app, &w),
        None => {
            /* Окно WebView нельзя создавать в обработчике главного потока — только в отдельном */
            thread::spawn(move || {
                if let Some(w) = notice_window(&app) {
                    thread::sleep(Duration::from_millis(350));
                    show_notice_window(&app, &w);
                }
            });
        }
    }
}

/// Текст для окна уведомления
#[tauri::command]
pub fn take_tray_notice(state: tauri::State<'_, NoticeState>) -> Option<(String, String)> {
    state.text.lock().unwrap().clone()
}

#[tauri::command]
pub fn hide_tray_notice(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(NOTICE_LABEL) {
        let _ = w.hide();
    }
}
