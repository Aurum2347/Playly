// Конфигурация приложения Playly
const appConfig = {
  version: '1.0',
  appName: 'Playly',
  minWindowWidth: 900,
  minWindowHeight: 600,
  defaultVolume: 0.7,
  supportedFormats: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'mp4']
};

// Для использования в Electron (main.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = appConfig;
}

// Для использования в браузере (renderer.js)
if (typeof window !== 'undefined') {
  window.appConfig = appConfig;
}