const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const appConfig = require('./config');
const jsmediatags = require('jsmediatags');

// ===== DEBUG FLAG =====
// Установи DEBUG = true для вывода отладочной информации в консоль
const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log('[Playly DEBUG]', ...args); }

// ===== SPLASH LOADING FLAG =====
// Установи SPLASH_LOADING = true для предзагрузки треков во время splash экрана
// Установи SPLASH_LOADING = false для отключения предзагрузки (быстрый запуск)
const SPLASH_LOADING = false;
function splashLog(...args) { console.log('[Splash Loading]', ...args); }

// Регистрируем схему до ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, standard: true, stream: true, bypassCSP: true } }
]);

let mainWindow;
let splashWindow;
const DATA_PATH = path.join(app.getPath('userData'), 'topmusic-data.json');
const COVERS_DIR = path.join(app.getPath('userData'), 'covers');

// Создаём папку для обложек при старте
async function ensureCoversDir() {
  try { await fs.mkdir(COVERS_DIR, { recursive: true }); } catch {}
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 380,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    backgroundColor: '#0a0a0a',
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });
  
  splashWindow.loadFile('splash.html');
  
  // Предотвращаем закрытие splash окна пользователем
  splashWindow.on('close', (e) => {
    // Если главное окно ещё не создано - отменяем закрытие
    if (!mainWindow) {
      e.preventDefault();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: appConfig.minWindowWidth,
    minHeight: appConfig.minWindowHeight,
    frame: false,
    show: false, // скрыто до готовности
    backgroundColor: '#0a0a0a',
    title: `${appConfig.appName} v${appConfig.version}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile('index.html');

  // Когда основное окно готово — закрываем сплэш и показываем главное
  mainWindow.once('ready-to-show', () => {
    // Показываем главное окно
    mainWindow.show();
    mainWindow.focus();
    
    // Закрываем splash окно если оно ещё существует
    if (splashWindow && !splashWindow.isDestroyed()) {
      // Показываем финальное сообщение
      try {
        splashWindow.webContents.send('preload-progress', {
          phase: 'complete',
          current: 100,
          total: 100,
          percent: 100,
          message: 'Запуск приложения...'
        });
      } catch (e) {
        // Игнорируем ошибки если окно уже закрыто
      }
      
      // Небольшая задержка для плавности
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.destroy();
          splashWindow = null;
        }
      }, 800);
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// ===== ПРЕДЗАГРУЗКА ВСЕХ ДАННЫХ =====
async function preloadAllData() {
  // Если предзагрузка отключена - пропускаем
  if (!SPLASH_LOADING) {
    splashLog('Preloading disabled, skipping...');
    return { success: true, tracksCount: 0, skipped: true };
  }

  splashLog('Starting preload...');
  
  try {
    // Загружаем данные из JSON
    const data = await loadDataSync();
    if (!data || !data.tracks || data.tracks.length === 0) {
      splashLog('No tracks found');
      return { success: true, tracksCount: 0 };
    }

    const tracks = data.tracks;
    
    // Проверяем сколько треков нуждаются в загрузке
    const tracksNeedingMeta = tracks.filter(t => !t._metaLoaded && !t.path.startsWith('demo-'));
    const tracksNeedingDuration = tracks.filter(t => !t.duration && !t.path.startsWith('demo-'));
    
    splashLog(`Tracks needing metadata: ${tracksNeedingMeta.length}`);
    splashLog(`Tracks needing duration: ${tracksNeedingDuration.length}`);
    
    // Если все треки уже загружены - пропускаем предзагрузку
    if (tracksNeedingMeta.length === 0 && tracksNeedingDuration.length === 0) {
      splashLog('All tracks already preloaded, skipping...');
      return { success: true, tracksCount: tracks.length, skipped: true };
    }

    const total = Math.max(tracksNeedingMeta.length, tracksNeedingDuration.length);
    let processed = 0;

    // Отправляем начальный прогресс
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('preload-progress', {
        phase: 'metadata',
        current: 0,
        total,
        percent: 0,
        message: 'Загрузка метаданных...'
      });
    }

    // Загружаем метаданные и обложки батчами
    const BATCH_SIZE = 5;
    const coverIds = new Set();

    if (tracksNeedingMeta.length > 0) {
      splashLog('Loading metadata...');
      for (let i = 0; i < tracksNeedingMeta.length; i += BATCH_SIZE) {
        const batch = tracksNeedingMeta.slice(i, Math.min(i + BATCH_SIZE, tracksNeedingMeta.length));
        
        await Promise.all(batch.map(async (track) => {
          try {
            const meta = await new Promise((resolve) => {
              jsmediatags.read(track.path, {
                onSuccess: (tag) => {
                  const result = {
                    title: tag.tags.title || null,
                    artist: tag.tags.artist || null,
                    album: tag.tags.album || null,
                  };
                  if (tag.tags.picture) {
                    const { data, format } = tag.tags.picture;
                    const base64 = Buffer.from(data).toString('base64');
                    result.cover = `data:${format};base64,${base64}`;
                  }
                  resolve(result);
                },
                onError: () => resolve(null)
              });
            });

            if (meta) {
              if (meta.title) track.name = meta.title;
              if (meta.artist) track.artist = meta.artist;
              if (meta.album) track.album = meta.album;
              if (meta.cover) {
                // Сохраняем обложку на диск
                const coverId = Math.abs(track.path.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)).toString(36);
                const matches = meta.cover.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                  const ext = matches[1].split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
                  const buffer = Buffer.from(matches[2], 'base64');
                  const filePath = path.join(COVERS_DIR, `${coverId}.${ext}`);
                  await fs.writeFile(filePath, buffer);
                  track.coverId = `${coverId}.${ext}`;
                  coverIds.add(`${coverId}.${ext}`);
                }
              }
              track._metaLoaded = true;
            }
          } catch (e) {
            splashLog('Preload meta error:', e);
          }
        }));

        processed += batch.length;
        const percent = Math.round((processed / total) * 100);

        // Отправляем прогресс в splash
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send('preload-progress', {
            phase: 'metadata',
            current: processed,
            total,
            percent,
            message: `Обработано ${processed} из ${total} треков...`
          });
        }

        // Даём время на обработку других событий
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Загружаем длительности
    if (tracksNeedingDuration.length > 0) {
      splashLog('Loading durations...');
      processed = 0;
      for (let i = 0; i < tracksNeedingDuration.length; i += BATCH_SIZE) {
        const batch = tracksNeedingDuration.slice(i, Math.min(i + BATCH_SIZE, tracksNeedingDuration.length));
        
        await Promise.all(batch.map(async (track) => {
          try {
            const dur = await getAudioDurationSync(track.path);
            if (dur && dur > 0) track.duration = dur;
          } catch (e) {
            splashLog('Preload duration error:', e);
          }
        }));

        processed += batch.length;
        const percent = Math.round((processed / tracksNeedingDuration.length) * 100);

        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.webContents.send('preload-progress', {
            phase: 'processing',
            current: processed,
            total: tracksNeedingDuration.length,
            percent,
            message: `Определение длительности ${processed} из ${tracksNeedingDuration.length}...`
          });
        }

        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Сохраняем обновлённые данные
    splashLog('Saving data...');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('preload-progress', {
        phase: 'saving',
        current: total,
        total,
        percent: 100,
        message: 'Сохранение данных...'
      });
    }

    // Обновляем только треки, остальные данные оставляем как есть
    data.tracks = tracks;
    
    // Сериализуем данные правильно (как в save-data handler)
    const serializable = JSON.parse(JSON.stringify(data, (key, value) => {
      if (key.startsWith('_')) return undefined;
      if (key === 'coverBlobUrl') return undefined;
      if (key === 'cover' && value && !value.startsWith('data:')) return undefined;
      return value instanceof Set ? Array.from(value) : value;
    }));
    
    await fs.writeFile(DATA_PATH, JSON.stringify(serializable, null, 2));

    splashLog(`Preload complete: ${tracksNeedingMeta.length} metadata, ${tracksNeedingDuration.length} durations, ${coverIds.size} covers`);

    return { 
      success: true, 
      tracksCount: tracks.length,
      coversCount: coverIds.size,
      metaLoaded: tracksNeedingMeta.length,
      durationsLoaded: tracksNeedingDuration.length
    };
  } catch (e) {
    console.error('Preload error:', e);
    return { success: false, error: e.message };
  }
}

// Синхронная загрузка данных
async function loadDataSync() {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    const data = JSON.parse(content);
    if (data.playlists) {
      Object.values(data.playlists).forEach(p => {
        if (p.trackPaths) p.trackPaths = new Set(p.trackPaths);
      });
    }
    return data;
  } catch {
    return null;
  }
}

// Синхронное получение длительности
async function getAudioDurationSync(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fd = await fs.open(filePath, 'r');
    try {
      if (ext === '.mp3') {
        const buf10 = Buffer.alloc(10);
        await fd.read(buf10, 0, 10, 0);
        let audioStart = 0;
        if (buf10[0] === 0x49 && buf10[1] === 0x44 && buf10[2] === 0x33) {
          const id3Size = ((buf10[6] & 0x7f) << 21) | ((buf10[7] & 0x7f) << 14) |
                          ((buf10[8] & 0x7f) << 7) | (buf10[9] & 0x7f);
          audioStart = id3Size + 10;
        }
        const frameBuf = Buffer.alloc(4);
        await fd.read(frameBuf, 0, 4, audioStart);
        const b0 = frameBuf[0], b1 = frameBuf[1];
        if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) {
          const header = (b0 << 24) | (b1 << 16) | (frameBuf[2] << 8) | frameBuf[3];
          const bitrateIdx = (header >> 12) & 0xF;
          const sampleRateIdx = (header >> 10) & 0x3;
          const bitrates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
          const sampleRates = [44100,48000,32000,0];
          const bitrate = bitrates[bitrateIdx] * 1000;
          const sampleRate = sampleRates[sampleRateIdx];
          if (bitrate > 0 && sampleRate > 0) {
            const stat = await fs.stat(filePath);
            return (stat.size - audioStart) * 8 / bitrate;
          }
        }
      }
      return null;
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

app.whenReady().then(async () => {
  await ensureCoversDir();
  createSplashWindow();
  
  // Ждём пока splash окно загрузится
  await new Promise(resolve => {
    splashWindow.webContents.once('did-finish-load', resolve);
  });

  // Запускаем предзагрузку всех данных
  const preloadResult = await preloadAllData();
  
  splashLog('Preload completed:', preloadResult);

  // Кастомный протокол для стриминга локальных аудиофайлов
  protocol.handle('localfile', async (request) => {
    try {
      // localfile:///R:/music/song.mp3
      let urlPath = request.url.slice('localfile:///'.length);
      // Decode percent-encoding
      urlPath = decodeURIComponent(urlPath);
      // Normalize to OS path
      const filePath = urlPath.replace(/\//g, path.sep);

      const stat = await fs.stat(filePath);
      const fileSize = stat.size;

      // Handle Range requests (needed for audio seeking)
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const [, startStr, endStr] = rangeHeader.match(/bytes=(\d+)-(\d*)/) || [];
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const stream = fsSync.createReadStream(filePath, { start, end });
        const ext = path.extname(filePath).toLowerCase().slice(1);
        const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', mp4: 'video/mp4' }[ext] || 'audio/mpeg';

        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
          }
        });
      }

      // Full file
      const stream = fsSync.createReadStream(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', mp4: 'video/mp4' }[ext] || 'audio/mpeg';

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
        }
      });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });
  
  // Создаём главное окно в любом случае
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== IPC Handlers =====

// Открыть файлы
ipcMain.handle('open-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите аудиофайлы',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: appConfig.supportedFormats }],
  });
  return result.canceled ? [] : result.filePaths;
});

// Открыть папку
ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите папку с музыкой',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Получить аудиофайлы в папке
ipcMain.handle('get-audio-files-in-folder', async (_, folderPath) => {
  try {
    const files = await fs.readdir(folderPath);
    return files
      .filter(f => {
        const ext = path.extname(f).toLowerCase().slice(1);
        return appConfig.supportedFormats.includes(ext);
      })
      .map(f => path.join(folderPath, f));
  } catch {
    return [];
  }
});

// Проверить существование файла
ipcMain.handle('check-file-exists', async (_, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// === НОВОЕ: Открыть папку с выделенным файлом ===
ipcMain.handle('open-folder-with-file', async (_, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return true;
  } catch (e) {
    console.error('Show item error:', e);
    return false;
  }
});

// === Открыть папку с данными приложения ===
ipcMain.handle('open-app-data-folder', async () => {
  try {
    shell.showItemInFolder(DATA_PATH);
    return true;
  } catch (e) {
    console.error('Open app data folder error:', e);
    return false;
  }
});

// === Загрузить фразы для модального окна загрузки ===
ipcMain.handle('get-loading-phrases', async () => {
  try {
    const phrasesPath = path.join(__dirname, 'loading-phrases.json');
    const content = await fs.readFile(phrasesPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
});

// Сохранить данные
ipcMain.handle('save-data', async (_, data) => {
  try {
    const serializable = JSON.parse(JSON.stringify(data, (key, value) => {
      // Не сохраняем служебные поля с подчёркиванием
      if (key.startsWith('_')) return undefined;
      // Не сохраняем временные Blob URLs
      if (key === 'coverBlobUrl') return undefined;
      // Не сохраняем битые обложки (без data: префикса)
      if (key === 'cover' && value && !value.startsWith('data:')) return undefined;
      return value instanceof Set ? Array.from(value) : value;
    }));
    await fs.writeFile(DATA_PATH, JSON.stringify(serializable, null, 2));
    return true;
  } catch (e) {
    console.error('Save error:', e);
    return false;
  }
});

// Загрузить данные
ipcMain.handle('load-data', async () => {
  try {
    const content = await fs.readFile(DATA_PATH, 'utf-8');
    const data = JSON.parse(content);
    if (data.playlists) {
      Object.values(data.playlists).forEach(p => {
        if (p.trackPaths) p.trackPaths = new Set(p.trackPaths);
      });
    }
    return data;
  } catch {
    return null;
  }
});

// ===== ХРАНИЛИЩЕ ОБЛОЖЕК =====
// Сохранить обложку на диск, вернуть coverId (имя файла без расширения)
ipcMain.handle('save-cover', async (_, coverId, base64Data) => {
  try {
    await ensureCoversDir();
    // base64Data = "data:image/jpeg;base64,/9j/..."
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    const ext = matches[1].split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');
    const filePath = path.join(COVERS_DIR, `${coverId}.${ext}`);
    await fs.writeFile(filePath, buffer);
    return `${coverId}.${ext}`;
  } catch (e) {
    console.error('Save cover error:', e);
    return null;
  }
});

// Загрузить обложку с диска, вернуть base64 data URL
ipcMain.handle('load-cover', async (_, coverId) => {
  try {
    // coverId может быть "abc123.jpg" или просто "abc123"
    const name = coverId.includes('.') ? coverId : null;
    if (name) {
      const filePath = path.join(COVERS_DIR, name);
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(name).slice(1).replace('jpg', 'jpeg');
      return `data:image/${ext};base64,${buffer.toString('base64')}`;
    }
    // Ищем файл с любым расширением
    const files = await fs.readdir(COVERS_DIR);
    const found = files.find(f => f.startsWith(coverId + '.'));
    if (!found) return null;
    const filePath = path.join(COVERS_DIR, found);
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(found).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
});

// Загрузить несколько обложек батчем — возвращает Map { coverId -> dataUrl }
ipcMain.handle('load-covers-batch', async (_, coverIds) => {
  const result = {};
  await Promise.all(coverIds.map(async (coverId) => {
    try {
      const name = coverId.includes('.') ? coverId : null;
      let filePath;
      if (name) {
        filePath = path.join(COVERS_DIR, name);
      } else {
        const files = await fs.readdir(COVERS_DIR);
        const found = files.find(f => f.startsWith(coverId + '.'));
        if (!found) return;
        filePath = path.join(COVERS_DIR, found);
      }
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).slice(1).replace('jpg', 'jpeg');
      result[coverId] = `data:image/${ext};base64,${buffer.toString('base64')}`;
    } catch {}
  }));
  return result;
});

// Удалить обложку
ipcMain.handle('delete-cover', async (_, coverId) => {
  try {
    const files = await fs.readdir(COVERS_DIR);
    const found = files.find(f => f.startsWith(coverId.replace(/\.[^.]+$/, '') + '.') || f === coverId);
    if (found) await fs.unlink(path.join(COVERS_DIR, found));
    return true;
  } catch { return false; }
});

// Мигрировать старые base64 обложки из JSON в файлы
// Вызывается один раз при старте если в треках ещё есть поле cover
ipcMain.handle('migrate-covers', async (_, tracks) => {
  await ensureCoversDir();
  const result = {}; // path -> coverId
  await Promise.all(tracks.map(async (track) => {
    if (!track.cover || !track.cover.startsWith('data:')) return;
    // coverId = md5-подобный хэш пути трека (просто base36 от числа)
    const coverId = Math.abs(track.path.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)).toString(36);
    try {
      const matches = track.cover.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) return;
      const ext = matches[1].split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(matches[2], 'base64');
      const fileName = `${coverId}.${ext}`;
      await fs.writeFile(path.join(COVERS_DIR, fileName), buffer);
      result[track.path] = fileName;
    } catch {}
  }));
  return result;
});

// Получить длительность аудиофайла (парсинг заголовков без чтения всего файла)
ipcMain.handle('get-audio-duration', async (_, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const fd = await fs.open(filePath, 'r');
    try {
      if (ext === '.mp3') {
        // Читаем первые 10 байт для ID3 заголовка
        const buf10 = Buffer.alloc(10);
        await fd.read(buf10, 0, 10, 0);

        let audioStart = 0;
        if (buf10[0] === 0x49 && buf10[1] === 0x44 && buf10[2] === 0x33) {
          const id3Size = ((buf10[6] & 0x7f) << 21) | ((buf10[7] & 0x7f) << 14) |
                          ((buf10[8] & 0x7f) << 7) | (buf10[9] & 0x7f);
          audioStart = id3Size + 10;
        }

        // Читаем первый MP3 фрейм
        const frameBuf = Buffer.alloc(4);
        await fd.read(frameBuf, 0, 4, audioStart);

        // Проверяем sync побайтово (избегаем знаковых проблем JS)
        const b0 = frameBuf[0], b1 = frameBuf[1];
        if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) {
          const header = (b0 << 24) | (b1 << 16) | (frameBuf[2] << 8) | frameBuf[3];
          const bitrateIdx    = (header >> 12) & 0xF;
          const sampleRateIdx = (header >> 10) & 0x3;
          const bitrates   = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
          const sampleRates = [44100,48000,32000,0];
          const bitrate    = bitrates[bitrateIdx] * 1000;
          const sampleRate = sampleRates[sampleRateIdx];
          if (bitrate > 0 && sampleRate > 0) {
            const stat = await fs.stat(filePath);
            return (stat.size - audioStart) * 8 / bitrate;
          }
        }

      } else if (ext === '.wav') {
        const wavBuf = Buffer.alloc(44);
        await fd.read(wavBuf, 0, 44, 0);
        if (wavBuf.slice(0, 4).toString('ascii') === 'RIFF') {
          const byteRate = wavBuf.readUInt32LE(28);
          const dataSize = wavBuf.readUInt32LE(40);
          if (byteRate > 0) return dataSize / byteRate;
        }

      } else if (ext === '.flac') {
        const flacBuf = Buffer.alloc(42);
        await fd.read(flacBuf, 0, 42, 0);
        if (flacBuf.slice(0, 4).toString('ascii') === 'fLaC') {
          const sampleRate = ((flacBuf[18] << 12) | (flacBuf[19] << 4) | (flacBuf[20] >> 4)) >>> 0;
          const samplesHigh = (flacBuf[21] & 0x0F);
          const samplesLow  = flacBuf.readUInt32BE(22);
          const totalSamples = samplesHigh * 0x100000000 + samplesLow;
          if (sampleRate > 0) return totalSamples / sampleRate;
        }
      }
      return null;
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
});

// Получить безопасный URL для локального файла
ipcMain.handle('get-file-url', async (_, filePath) => {
  try {
    await fs.access(filePath);
    // Encode each path segment but keep drive letter and separators
    const parts = filePath.replace(/\\/g, '/').split('/');
    const encoded = parts.map((p, i) => i === 0 ? p : encodeURIComponent(p)).join('/');
    return 'localfile:///' + encoded;
  } catch {
    return null;
  }
});

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized());

// ===== ЧТЕНИЕ МЕТАДАННЫХ ЧЕРЕЗ JSMEDIATAGS =====
ipcMain.handle('get-audio-metadata', async (_, filePath) => {
  return new Promise((resolve) => {
    dbg('Reading metadata:', filePath);
    jsmediatags.read(filePath, {
      onSuccess: (tag) => {
        const result = {
          title: tag.tags.title || null,
          artist: tag.tags.artist || null,
          album: tag.tags.album || null,
          year: tag.tags.year || null,
          genre: tag.tags.genre || null,
          track: tag.tags.track || null,
        };

        if (tag.tags.picture) {
          const { data, format } = tag.tags.picture;
          const base64 = Buffer.from(data).toString('base64');
          result.cover = `data:${format};base64,${base64}`;
          dbg('Cover found:', format, data.length, 'bytes for', filePath.split(/[/\\]/).pop());
        } else {
          dbg('No cover for:', filePath.split(/[/\\]/).pop());
        }

        dbg('Metadata result:', { title: result.title, artist: result.artist, hasCover: !!result.cover });
        resolve(result);
      },
      onError: (error) => {
        dbg('jsmediatags error:', error.type, error.info, 'for', filePath);
        resolve(null);
      }
    });
  });
});