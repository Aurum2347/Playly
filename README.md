<div align="center">

# 🎧 Playly

Аудиоплеер для локальной музыкальной библиотеки под Windows и Linux.
Воспроизведение локальных файлов работает без интернета. Для проверки обновлений нужен интернет.

[⬇️ Скачать последний релиз](https://github.com/Aurum2347/Playly/releases/latest) • [🌐 Подробнее о проекте](https://aurum2347.github.io/Playly/) • [💬 Telegram-канал](https://t.me/aurums2347)

</div>

---

## 🖥 Интерфейс

<table>
  <tr>
    <td align="center"><b>Главная</b><br>Быстрый доступ к последнему треку</td>
    <td align="center"><b>Все треки</b><br>Полный контроль, сортировки и поиск</td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/fe4d96d6-bc29-4ab2-b94b-80ba66a0ea75" alt="Главная страница Playly" width="100%"></td>
    <td><img src="https://github.com/user-attachments/assets/1785d8f5-b737-4be6-8237-bf5f0c4843ac" alt="Все треки Playly" width="100%"></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><b>Понравившиеся</b><br>Твои избранные треки со статистикой</td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://github.com/user-attachments/assets/24215edd-c68a-47b3-b014-ca721bea9932" alt="Понравившиеся треки Playly" width="100%"></td>
  </tr>
</table>

---

## 📂 Приватность и данные

Playly уважает твою приватность. Вся библиотека, плейлисты, настройки и профиль лежат **только на твоём ПК**.

> **Путь к данным:** `%AppData%\com.playly.player\playly` (Windows), `~/.local/share/com.playly.player/playly` (Linux)
> 
> Хочешь начать с чистого листа или удалить все следы? Просто удали эту папку.

---


## 🚀 Как запустить

1. Перейди в раздел [Releases](https://github.com/Aurum2347/Playly/releases/latest).
2. Скачай `Playly.exe`.
3. Запусти двойным кликом. Готово!

*(Требуется Windows 10 или 11. WebView2 обычно уже встроен в систему).*

---

## 🛠 Сборка из исходников

Нужны [Node.js](https://nodejs.org) 20+ и [Rust](https://rustup.rs) (stable).

```bash
npm install
npm run tauri dev     # запуск в режиме разработки
npm run tauri build   # сборка установщиков
```

### Linux (экспериментально)

Системные библиотеки (Debian / Ubuntu 22.04+):

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev libxdo-dev build-essential curl wget file \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
```

Fedora: `webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel librsvg2-devel openssl-devel libxdo-devel gstreamer1-plugins-base gstreamer1-plugins-good`.

`npm run tauri build` соберёт `.AppImage`, `.deb` и `.rpm` в `src-tauri/target/release/bundle/`. Звук в WebKitGTK идёт через GStreamer: без пакетов `gstreamer*-plugins-*` часть форматов (MP3, AAC/M4A) не заиграет.

Особенности Linux-версии:
- у иконки в трее меню («Открыть Playly», «Мини-плеер», «Выйти») — щелчков по иконке Linux не передаёт; в GNOME для трея нужно расширение AppIndicator;
- обновляется сама только AppImage, `.deb` и `.rpm` — вручную со страницы релиза;
- выбор устройства вывода звука WebKitGTK не поддерживает — звук идёт в системное устройство по умолчанию.

---

<div align="center">

[![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/aurums2347) 

</div>


## Проверки

`npm test` — регрессии миграции EQ, LRC, масштаба и версии. `npm run lint` и `npm run build` проверяют frontend. `cargo test --manifest-path src-tauri/Cargo.toml --bin app` проверяет атомарную замену JSON, сохранность файла при ошибке тегов, Unicode-теги.

История хранит последние 10 000 запусков треков; старые данные «недавно прослушанных» переносятся как последние известные прослушивания. Ctrl+0 возвращает масштаб к 100%. Закреплённый в Windows ярлык может потребовать повторного закрепления после смены иконки.

Для контейнеров и кодеков, которые WebView не воспроизводит, FFmpeg создаёт временный WAV только для воспроизведения. Исходный аудио- или видеофайл не меняется. Временный WAV удаляется после чтения; очень длинные файлы могут требовать много памяти, декодирование ограничено двумя минутами.

Проверка восстановления portable-обновления на Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-update.ps1`. Тест запускает изолированные фиктивные приложения: исправный запуск подтверждает обновление, неисправный exe заменяется резервной копией. Реальные файлы приложения тест не меняет.
