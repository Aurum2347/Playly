// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::MimeType;
use lofty::tag::Accessor;
use std::fs;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{command, Manager};

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
            .and_then(|pic| {
                let mime_str = match pic.mime_type() {
                    Some(MimeType::Png) => "image/png",
                    Some(MimeType::Jpeg) => "image/jpeg",
                    Some(MimeType::Tiff) => "image/tiff",
                    Some(MimeType::Bmp) => "image/bmp",
                    Some(MimeType::Gif) => "image/gif",
                    _ => "image/jpeg",
                };
                let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
                Some(format!("data:{};base64,{}", mime_str, b64))
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
        if let Some(parent) = p.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Не удалось открыть папку: {}", e))?;
        } else {
            return Err("Не удалось определить родительскую папку".into());
        }
    }
    Ok(())
}


const DISCORD_CLIENT_ID: &str = "1380279748072312903";
const MIN_SEND_INTERVAL: Duration = Duration::from_millis(2000);

enum RpcCmd {
    Track {
        title: String,
        artist: String,
        duration_secs: u64,
        position_secs: u64,
        playing: bool,
        status: String,
        search_label: String,
    },
    Idle {
        details: String,
        status: String,
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

fn rpc_worker(rx: mpsc::Receiver<RpcCmd>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut last_send = Instant::now() - MIN_SEND_INTERVAL;

    loop {
        let mut cmd = match rx.recv() {
            Ok(c) => c,
            Err(_) => break,
        };

        loop {
            let since = last_send.elapsed();
            if since >= MIN_SEND_INTERVAL {
                break;
            }
            match rx.recv_timeout(MIN_SEND_INTERVAL - since) {
                Ok(newer) => {
                    cmd = newer;
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        for _attempt in 0..2 {
            if client.is_none() {
                let mut c = DiscordIpcClient::new(DISCORD_CLIENT_ID);
                match c.connect() {
                    Ok(()) => {
                        println!("[RPC] Подключено к Discord");
                        client = Some(c);
                    }
                    Err(e) => {
                        eprintln!("[RPC] Ошибка подключения: {}", e);
                        client = None;
                        break;
                    }
                }
            }

            if let Some(cl) = client.as_mut() {
                let result = match &cmd {
                    RpcCmd::Track {
                        title,
                        artist,
                        duration_secs,
                        position_secs,
                        playing,
                        status,
                        search_label,
                    } => {
                        let search_url = format!(
                            "https://www.google.com/search?q={}",
                            urlencoding::encode(&format!("{} - {}", title, artist))
                        );
                        let mut payload = activity::Activity::new()
                            .activity_type(activity::ActivityType::Listening)
                            .details(title.clone())
                            .state(status.clone())
                            .buttons(vec![
                                activity::Button::new("GitHub", "https://github.com/Aurum2347/Playly"),
                                activity::Button::new(search_label.clone(), search_url),
                            ]);
                        if *playing {
                            let now = now_millis();
                            let dur = *duration_secs as i64;
                            let mut pos = *position_secs as i64;
                            if pos < 0 || pos > dur {
                                pos = 0;
                            }
                            let start = now - pos * 1000;
                            let end = start + dur * 1000;
                            payload = payload
                                .timestamps(activity::Timestamps::new().start(start).end(end));
                        }
                        cl.set_activity(payload)
                    }
                    RpcCmd::Idle { details, status } => cl.set_activity(
                        activity::Activity::new()
                            .activity_type(activity::ActivityType::Listening)
                            .details(details.clone())
                            .state(status.clone())
                            .buttons(vec![activity::Button::new(
                                "GitHub",
                                "https://github.com/Aurum2347/Playly",
                            )]),
                    ),
                    RpcCmd::Clear => cl.clear_activity(),
                };

                match result {
                    Ok(()) => {
                        last_send = Instant::now();
                        break;
                    }
                    Err(e) => {
                        eprintln!("[RPC] Ошибка отправки: {}", e);
                        client = None;
                        continue;
                    }
                }
            }
        }
    }
}

#[command]
fn discord_update_presence(
    state: tauri::State<'_, RpcState>,
    title: String,
    artist: String,
    duration_secs: u64,
    is_playing: bool,
    position_secs: u64,
    status: String,
    search_label: String,
) -> bool {
    state
        .tx
        .send(RpcCmd::Track {
            title,
            artist,
            duration_secs,
            position_secs,
            playing: is_playing,
            status,
            search_label,
        })
        .is_ok()
}

#[command]
fn discord_idle_presence(
    state: tauri::State<'_, RpcState>,
    details: String,
    status: String,
) -> bool {
    state.tx.send(RpcCmd::Idle { details, status }).is_ok()
}

#[command]
fn discord_clear_presence(state: tauri::State<'_, RpcState>) -> bool {
    state.tx.send(RpcCmd::Clear).is_ok()
}


fn main() {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || rpc_worker(rx));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(RpcState { tx })
        .setup(|app| {
            // Трей с меню
            let show_item = MenuItem::with_id(app, "show", "Показать", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .unwrap_or_else(|| tauri::image::Image::new(&[0, 0, 0, 0], 1, 1));

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Playly")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_track_metadata,
            get_file_mtime,
            reveal_item_in_dir,
            discord_update_presence,
            discord_idle_presence,
            discord_clear_presence
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}