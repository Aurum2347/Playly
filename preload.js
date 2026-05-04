const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Окно
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Файлы
  openFiles: () => ipcRenderer.invoke('open-files'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  getAudioFilesInFolder: (folder) => ipcRenderer.invoke('get-audio-files-in-folder', folder),
  checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
  openFolderWithFile: (filePath) => ipcRenderer.invoke('open-folder-with-file', filePath),
  openAppDataFolder: () => ipcRenderer.invoke('open-app-data-folder'),
  getLoadingPhrases: () => ipcRenderer.invoke('get-loading-phrases'),
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),
  
  // Данные
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  loadData: () => ipcRenderer.invoke('load-data'),
  getAudioMetadata: (filePath) => ipcRenderer.invoke('get-audio-metadata', filePath),
  getAudioDuration: (filePath) => ipcRenderer.invoke('get-audio-duration', filePath),
});