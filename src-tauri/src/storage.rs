use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    tag::{Accessor, Tag},
};
use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::Manager;

/// Файлы библиотеки (settings.json, tracks.json…) пишутся строго по одному
static JSON_LOCK: Mutex<()> = Mutex::new(());
/// Аудиофайлы и .lrc рядом с ними: отдельный замок, чтобы долгая запись тегов
/// большого FLAC не задерживала сохранение настроек
static AUDIO_LOCK: Mutex<()> = Mutex::new(());

fn icon_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("playly"))
}

/// Своя иконка окна и трея. Применяется сразу, а ещё сохраняется в .ico/.png для ярлыка
#[tauri::command]
pub fn set_application_icon(
    app: tauri::AppHandle,
    rgba: Vec<u8>,
    png: String,
) -> Result<(), String> {
    use base64::Engine;
    if rgba.len() != 128 * 128 * 4 || png.len() > 200_000 {
        return Err("Некорректная иконка".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&png)
        .map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Некорректный PNG".into());
    }
    let image = tauri::image::Image::new_owned(rgba, 128, 128);
    apply_icon(&app, image)?;
    let dir = icon_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    /* ICO с одной PNG-картинкой 128×128: заголовок 6 байт + запись каталога 16 байт */
    let mut ico = vec![0, 0, 1, 0, 1, 0, 128, 128, 0, 0, 1, 0, 32, 0];
    ico.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes());
    ico.extend_from_slice(&bytes);
    replace(&dir.join("custom-icon.ico"), &ico)?;
    replace(&dir.join("custom-icon.png"), &bytes)
}

/// Вернуть стандартную иконку Playly и забыть свою
#[tauri::command]
pub fn reset_application_icon(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(icon) = app.default_window_icon() {
        let icon = tauri::image::Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height());
        apply_icon(&app, icon)?;
    }
    let dir = icon_dir(&app)?;
    let _ = fs::remove_file(dir.join("custom-icon.ico"));
    let _ = fs::remove_file(dir.join("custom-icon.png"));
    Ok(())
}

fn apply_icon(app: &tauri::AppHandle, image: tauri::image::Image<'static>) -> Result<(), String> {
    for window in app.webview_windows().values() {
        window.set_icon(image.clone()).map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id("playly") {
        tray.set_icon(Some(image)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ярлык на рабочем столе с последней применённой своей иконкой
#[tauri::command]
pub async fn create_icon_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let dir = icon_dir(&app)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let icon = dir.join("custom-icon.ico");
            if !icon.is_file() {
                return Err("Сначала примените иконку".into());
            }
            let status = std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Playly Custom.lnk'));$s.TargetPath=$env:PLAYLY_EXE;$s.WorkingDirectory=(Split-Path $env:PLAYLY_EXE);$s.IconLocation=$env:PLAYLY_ICON;$s.Save()",
                ])
                .env("PLAYLY_EXE", &exe)
                .env("PLAYLY_ICON", &icon)
                .creation_flags(0x08000000)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("PowerShell не смог создать ярлык".into());
            }
        }
        #[cfg(unix)]
        {
            let png = dir.join("custom-icon.png");
            if !png.is_file() {
                return Err("Сначала примените иконку".into());
            }
            let escape = |s: &str| {
                s.replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('`', "\\`")
                    .replace('$', "\\$")
            };
            let file = desktop.join("Playly Custom.desktop");
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=Playly\nExec=\"{}\"\nIcon={}\nTerminal=false\n",
                escape(&exe.to_string_lossy()),
                png.display()
            );
            replace(&file, content.as_bytes())?;
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(file, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("playly-tmp");
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_track_lyrics(path: String, text: String) -> Result<(), String> {
    let audio = Path::new(&path);
    if !audio.is_file() || text.len() > 1024 * 1024 {
        return Err("Недоступный трек или слишком большой текст".into());
    }
    let _lock = AUDIO_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    replace(&audio.with_extension("lrc"), text.as_bytes())
}

const LIBRARY_FILES: [&str; 5] = [
    "settings.json",
    "tracks.json",
    "playlists.json",
    "history.json",
    "listening-history.json",
];

/// Атомарная запись файла библиотеки: прежняя рабочая версия остаётся в .json.bak.
/// Асинхронная команда: файловые операции не занимают главный поток окна.
#[tauri::command]
pub async fn write_library_json(
    app: tauri::AppHandle,
    name: String,
    contents: String,
) -> Result<(), String> {
    if !LIBRARY_FILES.contains(&name.as_str()) {
        return Err("Недопустимый файл библиотеки".into());
    }
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| e.to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("playly");
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = JSON_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        write_with_backup(&dir.join(name), contents.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Чтение файла библиотеки. Если основной файл повреждён (обрыв питания, ручная правка),
/// отдаём последнюю рабочую копию из .json.bak. Иначе приложение решило бы, что библиотека
/// пуста, и следующей записью затёрло бы её окончательно
#[tauri::command]
pub async fn read_library_json(
    app: tauri::AppHandle,
    name: String,
) -> Result<Option<String>, String> {
    if !LIBRARY_FILES.contains(&name.as_str()) {
        return Err("Недопустимый файл библиотеки".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("playly")
        .join(name);
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = JSON_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        Ok(read_with_backup(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Текст файла, если это корректный JSON (BOM от ручной правки в Блокноте допускается)
fn valid_json(bytes: Vec<u8>) -> Option<String> {
    let text = String::from_utf8(bytes).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str::<serde_json::Value>(text).ok()?;
    Some(text.to_string())
}

fn read_with_backup(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    fs::read(path)
        .ok()
        .and_then(valid_json)
        .or_else(|| fs::read(path.with_extension("json.bak")).ok().and_then(valid_json))
}

/// Рабочую прежнюю версию кладём в .json.bak. Повреждённую не затираем поверх
/// последней хорошей копии, а откладываем в .corrupt.json: так её можно разобрать,
/// а настройки продолжают сохраняться (раньше один битый файл блокировал запись навсегда)
fn write_with_backup(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Ok(previous) = fs::read(path) {
        if valid_json(previous.clone()).is_some() {
            replace(&path.with_extension("json.bak"), &previous)?;
        } else {
            let _ = replace(&path.with_extension("corrupt.json"), &previous);
        }
    }
    replace(path, contents)
}

#[tauri::command]
pub async fn write_track_tags(
    path: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = AUDIO_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if title.trim().is_empty() {
            return Err("Название не должно быть пустым".into());
        }
        let path = Path::new(&path);
        if !path.is_file() {
            return Err("Аудиофайл недоступен".into());
        }
        let ext = path
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ![
            "mp3", "flac", "m4a", "ogg", "oga", "opus", "wav", "aif", "aiff", "aac",
        ]
        .contains(&ext.as_str())
        {
            return Err(
                "Запись тегов этого формата не поддерживается. Исходный файл не изменён.".into(),
            );
        }
        let tmp = path.with_file_name(format!(".playly-edit-{}.{}", std::process::id(), ext));
        let result = (|| {
            fs::copy(path, &tmp).map_err(|e| e.to_string())?;
            let mut audio = lofty::read_from_path(&tmp).map_err(|e| e.to_string())?;
            if audio.primary_tag().is_none() {
                audio.insert_tag(Tag::new(audio.primary_tag_type()));
            }
            let tag = audio
                .primary_tag_mut()
                .ok_or("Формат не поддерживает теги")?;
            tag.set_title(title);
            tag.set_artist(artist);
            tag.set_album(album);
            tag.set_genre(genre);
            audio
                .save_to_path(&tmp, WriteOptions::default())
                .map_err(|e| e.to_string())?;
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&tmp)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(&tmp, path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_keeps_last_complete_value() {
        let dir = std::env::temp_dir().join(format!("playly-storage-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.json");
        replace(&path, b"{\"a\":1}").unwrap();
        replace(&path, b"{\"a\":2}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"a\":2}");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn damaged_file_is_set_aside_instead_of_blocking_writes() {
        let dir = std::env::temp_dir().join(format!("playly-backup-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, b"{\"theme\":\"dark\"}").unwrap();
        write_with_backup(&path, b"{\"theme\":\"light\"}").unwrap();
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), b"{\"theme\":\"dark\"}");
        fs::write(&path, b"{broken").unwrap();
        write_with_backup(&path, b"{\"theme\":\"dark\"}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"theme\":\"dark\"}");
        assert_eq!(fs::read(dir.join("settings.json.bak")).unwrap(), b"{\"theme\":\"dark\"}");
        assert_eq!(fs::read(dir.join("settings.corrupt.json")).unwrap(), b"{broken");
        fs::write(&path, b"{broken").unwrap();
        assert_eq!(read_with_backup(&path).as_deref(), Some("{\"theme\":\"dark\"}"));
        fs::write(&path, "\u{feff}{\"theme\":\"light\"}").unwrap();
        assert_eq!(read_with_backup(&path).as_deref(), Some("{\"theme\":\"light\"}"));
        assert_eq!(read_with_backup(&dir.join("missing.json")), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tag_edit_roundtrip_and_failure_preserve_audio() {
        let dir = std::env::temp_dir().join(format!("playly-tags-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.wav");
        let samples = vec![0u8; 16000];
        let mut wav = b"RIFF".to_vec();
        wav.extend_from_slice(&(36u32 + samples.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x01\0");
        wav.extend_from_slice(&8000u32.to_le_bytes());
        wav.extend_from_slice(&16000u32.to_le_bytes());
        wav.extend_from_slice(b"\x02\0\x10\0data");
        wav.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        wav.extend_from_slice(&samples);
        fs::write(&path, &wav).unwrap();
        tauri::async_runtime::block_on(write_track_tags(
            path.to_string_lossy().into(),
            "Название 🎵".into(),
            "Исполнитель".into(),
            "Альбом".into(),
            "Ambient".into(),
        ))
        .unwrap();
        let audio = lofty::read_from_path(&path).unwrap();
        assert_eq!(
            audio.primary_tag().unwrap().title().as_deref(),
            Some("Название 🎵")
        );
        assert_eq!(
            audio.primary_tag().unwrap().artist().as_deref(),
            Some("Исполнитель")
        );
        assert_eq!(audio.properties().duration().as_secs(), 1);
        let before = fs::read(&path).unwrap();
        assert!(tauri::async_runtime::block_on(write_track_tags(
            path.to_string_lossy().into(),
            " ".into(),
            "".into(),
            "".into(),
            "".into()
        ))
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
