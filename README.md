<div align="center">

# 🎧 Playly

Аудиоплее�- для локальной музыкальной библиотеки под Windows и Linux.
Восп�-оизведение локальных файлов �-аботает без инте�-нета. �-ля п�-ове�-ки обновлений нужен инте�-нет.

[-��️ Скачать последний �-елиз](https://github.com/Aurum2347/Playly/releases/latest) --� [🌐 Под�-обнее о п�-оекте](https://aurum2347.github.io/Playly/) --� [💬 Telegram-канал](https://t.me/aurums2347)

</div>

---

## 🖥 Инте�-фейс

<table>
  <tr>
    <td align="center"><b>�-лавная</b><br>Быст�-ый доступ к последнему т�-еку</td>
    <td align="center"><b>Все т�-еки</b><br>Полный конт�-оль, со�-ти�-овки и поиск</td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/fe4d96d6-bc29-4ab2-b94b-80ba66a0ea75" alt="�-лавная ст�-аница Playly" width="100%"></td>
    <td><img src="https://github.com/user-attachments/assets/1785d8f5-b737-4be6-8237-bf5f0c4843ac" alt="Все т�-еки Playly" width="100%"></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><b>Пон�-авившиеся</b><br>Твои изб�-анные т�-еки со статистикой</td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://github.com/user-attachments/assets/24215edd-c68a-47b3-b014-ca721bea9932" alt="Пон�-авившиеся т�-еки Playly" width="100%"></td>
  </tr>
</table>

---

## �-� П�-иватность и данные

Playly уважает твою п�-иватность. Вся библиотека, плейлисты, наст�-ойки и п�-офиль лежат **только на твоём ПК**.

> **Путь к данным:** `%AppData%\com.playly.player\playly` (Windows), `~/.local/share/com.playly.player/playly` (Linux)
> 
> Хочешь начать с чистого листа или удалить все следы? П�-осто удали эту папку.

---


## �- Как запустить

1. Пе�-ейди в �-аздел [Releases](https://github.com/Aurum2347/Playly/releases/latest).
2. Скачай `Playly.exe`.
3. Запусти двойным кликом. �-отово!

*(Т�-ебуется Windows 10 или 11. WebView2 обычно уже вст�-оен в систему).*

---

## 🛠 Сбо�-ка из исходников

Нужны [Node.js](https://nodejs.org) 20+ и [Rust](https://rustup.rs) (stable).

```bash
npm install
npm run tauri dev     # запуск в �-ежиме �-аз�-аботки
npm run tauri build   # сбо�-ка установщиков
```

### Linux (экспе�-иментально)

Системные библиотеки (Debian / Ubuntu 22.04+):

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev libxdo-dev build-essential curl wget file \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
```

Fedora: `webkit2gtk4.1-devel libayatana-appindicator-gtk3-devel librsvg2-devel openssl-devel libxdo-devel gstreamer1-plugins-base gstreamer1-plugins-good`.

`npm run tauri build` собе�-ёт `.AppImage`, `.deb` и `.rpm` в `src-tauri/target/release/bundle/`. Звук в WebKitGTK идёт че�-ез GStreamer: без пакетов `gstreamer*-plugins-*` часть фо�-матов (MP3, AAC/M4A) не заиг�-ает.

Особенности Linux-ве�-сии:
- у иконки в т�-ее меню («Отк�-ыть Playly», «Мини-плее�-», «Выйти») --- щелчков по иконке Linux не пе�-едаёт; в GNOME для т�-ея нужно �-асши�-ение AppIndicator;
- обновляется сама только AppImage, `.deb` и `.rpm` --- в�-учную со ст�-аницы �-елиза;
- выбо�- уст�-ойства вывода звука WebKitGTK не подде�-живает --- звук идёт в системное уст�-ойство по умолчанию.

---

<div align="center">

[![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/aurums2347) 

</div>


## П�-ове�-ки

`npm test` --- �-ег�-ессии миг�-ации EQ, LRC, масштаба и ве�-сии. `npm run lint` и `npm run build` п�-ове�-яют frontend. `cargo test --manifest-path src-tauri/Cargo.toml --bin app` п�-ове�-яет атома�-ную замену JSON, сох�-анность файла п�-и ошибке тегов, Unicode-теги.

Исто�-ия х�-анит последние 10 000 запусков т�-еков; ста�-ые данные «недавно п�-ослушанных» пе�-еносятся как последние известные п�-ослушивания. Ctrl+0 возв�-ащает масштаб к 100%. Зак�-еплённый в Windows я�-лык может пот�-ебовать повто�-ного зак�-епления после смены иконки.

�-ля контейне�-ов и кодеков, кото�-ые WebView не восп�-оизводит, FFmpeg создаёт в�-еменный WAV только для восп�-оизведения. Исходный аудио- или видеофайл не меняется. В�-еменный WAV удаляется после чтения; очень длинные файлы могут т�-ебовать много памяти, декоди�-ование ог�-аничено двумя минутами.

П�-ове�-ка восстановления portable-обновления на Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-update.ps1`. Тест запускает изоли�-ованные фиктивные п�-иложения: исп�-авный запуск подтве�-ждает обновление, неисп�-авный exe заменяется �-езе�-вной копией. Реальные файлы п�-иложения тест не меняет.
