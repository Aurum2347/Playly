use std::{
    fs,
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::Manager;

static GENERATION: AtomicU64 = AtomicU64::new(0);
#[tauri::command]
pub fn cancel_media_decode() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub async fn decode_media_audio(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return Err("Декодирование отменено".into());
        }
        let source = std::path::Path::new(&path);
        if !source.is_file() {
            return Err("Аудиофайл недоступен".into());
        }
        let destination = std::env::temp_dir().join(format!(
            "playly-decoded-{}-{}.wav",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        ));
        let filename = format!("ffmpeg{}", std::env::consts::EXE_SUFFIX);
        let local = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("playly")
            .join("tools")
            .join(&filename);
        let mut command = Command::new(if local.is_file() {
            local
        } else {
            std::path::PathBuf::from(filename)
        });
        command
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-protocol_whitelist",
                "file,pipe,crypto,data",
                "-i",
            ])
            .arg(source)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                "-y",
            ])
            .arg(&destination)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Для этого формата требуется FFmpeg. Установите FFmpeg: {e}"))?;
        let stderr = child.stderr.take().ok_or("Нет журнала FFmpeg")?;
        let reader = std::thread::spawn(move || {
            let mut message = String::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if message.len() < 2000 {
                    message.push_str(&line.chars().take(200).collect::<String>());
                    message.push('\n');
                }
            }
            message
        });
        // shortcut: decoding has a two-minute budget; use streaming for very long media.
        let started = Instant::now();
        let status = loop {
            if GENERATION.load(Ordering::SeqCst) != generation
                || started.elapsed() > Duration::from_secs(120)
            {
                let _ = child.kill();
            }
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let message = reader.join().unwrap_or_default();
        if !status.success() {
            let _ = fs::remove_file(&destination);
            return Err(if message.is_empty() {
                "Декодирование отменено или превышено время ожидания".into()
            } else {
                message
            });
        }
        Ok(destination.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
