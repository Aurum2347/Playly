// ==========================================
// 🎵 Playly - Renderer Process Logic v2
// ==========================================
const audio = document.getElementById('audio');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const likeBtn = document.getElementById('likeBtn');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const volumeContainer = document.getElementById('volumeContainer');
const volumeFill = document.getElementById('volumeFill');
const volumeIcon = document.getElementById('volumeIcon');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const trackNameEl = document.getElementById('trackName');
const trackArtistEl = document.getElementById('trackArtist');
const playlistGrid = document.getElementById('playlistGrid');
const playlistCount = document.getElementById('playlistCount');
const recentCards = document.getElementById('recentCards');
const addTrackBtn = document.getElementById('addTrackBtn');
const addFolderBtn = document.getElementById('addFolderBtn');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const sortBtn = document.getElementById('sortBtn');
const sortDropdown = document.getElementById('sortDropdown');
const sortOptions = document.querySelectorAll('.sort-option');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const createBtn = document.getElementById('createBtn');
const categoryInput = document.getElementById('categoryInput');
const categoriesList = document.getElementById('categoriesList');
const appVersionEl = document.getElementById('appVersion');
const settingsTopBtn = document.getElementById('settingsTopBtn');

// Модальные окна и меню
const trackContextMenu = document.getElementById('trackContextMenu');
const detailsModal = document.getElementById('detailsModal');
const playlistModal = document.getElementById('playlistModal');
const deleteModal = document.getElementById('deleteModal');
const missingFileModal = document.getElementById('missingFileModal');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const trackDetailsContent = document.getElementById('trackDetailsContent');
const playlistListContent = document.getElementById('playlistListContent');
const syncListContent = document.getElementById('syncListContent');
const syncCategoriesContent = document.getElementById('syncCategoriesContent');
const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
const syncFolderBtn = document.getElementById('syncFolderBtn');
const copyMissingPathBtn = document.getElementById('copyMissingPathBtn');
const okMissingFileBtn = document.getElementById('okMissingFileBtn');
const missingFileNameEl = document.getElementById('missingFileName');
const missingFilePathEl = document.getElementById('missingFilePath');
const searchInput = document.getElementById('searchInput');

// Данные
let tracks = [];
let playlists = {};
let syncConfigs = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;
let isMuted = false;
let lastVolume = window.appConfig?.defaultVolume ?? 0.7;
let progressInterval = null;
let currentPage = 'home';
let currentCategory = 'all-songs';
let customCategories = [];
let categoryCounter = 0;
let selectedTrackIndex = null;
let selectedPlaylists = new Set();
let currentSortType = 'date-new-old';
let selectedTracks = new Set();
let contextTrackIndex = null;
let searchQuery = '';
let recentlyPlayed = []; // отдельный список недавно воспроизведённых
let marqueeEnabled = true; // бегущая строка в player-bar
let _marqueeTimers = {}; // таймеры для бегущей строки

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Для data-атрибутов — не нужно HTML-экранирование, только кавычки
function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;');
}

function getFileTypeText(ext) {
  return ext ? `${ext}-файл` : 'Файл';
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function openModalById(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModalById(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  if (categoryInput) {
    categoryInput.value = '';
    if (createBtn) createBtn.disabled = true;
  }
}

// ===== ТОСТ-УВЕДОМЛЕНИЯ =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const icons = {
    success: `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#10b981;flex-shrink:0"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`,
    error: `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#ef4444;flex-shrink:0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    info: `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#3b82f6;flex-shrink:0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`
  };
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `${icons[type] || icons.success}<span>${message}</span>`;
  container.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ===== ЛЕНИВАЯ ЗАГРУЗКА ОБЛОЖЕК =====
let _coverObserver = null;

function initCoverObserver() {
  if (_coverObserver) return;
  _coverObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      const coverData = img.dataset.coverData;
      if (coverData) {
        // Плавное появление
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.3s ease';
        img.src = coverData;
        img.onload = () => {
          img.style.opacity = '1';
          delete img.dataset.coverData;
        };
        img.onerror = () => {
          img.style.opacity = '1';
          delete img.dataset.coverData;
        };
      }
      _coverObserver.unobserve(img);
    });
  }, {
    rootMargin: '200px 0px',
    threshold: 0
  });
}

// ===== КЭШ ИНДЕКСОВ (path → index) для O(1) поиска =====
let _trackIndexCache = new Map();

function rebuildIndexCache() {
  _trackIndexCache.clear();
  tracks.forEach((t, i) => _trackIndexCache.set(t.path, i));
}

function getTrackIndex(path) {
  return _trackIndexCache.has(path) ? _trackIndexCache.get(path) : tracks.findIndex(t => t.path === path);
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function init() {
  if (appVersionEl && window.appConfig) {
    appVersionEl.textContent = window.appConfig.version;
  }
  audio.volume = lastVolume;
  initCoverObserver();
  updateVolumeUI();
  
  await loadData();
  rebuildIndexCache();
  renderRecent();
  renderSyncList();
  renderSyncCategories();
  renderCategoriesInSidebar();
  setupEventListeners();
  updateNowPlayingCard();
  applyAnimationSetting();
  loadUIPreferences();
  initGraph();

  // Откладываем тяжёлые фоновые задачи
  setTimeout(() => checkMissingFiles(), 4000);

  const scheduleIdle = window.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 3000 })
    : (fn) => setTimeout(fn, 500);

  scheduleIdle(() => {
    loadTrackDurations();
    loadAllMetadata();
  });
}

// ===== ОТРИСОВКА КАТЕГОРИЙ В САЙДБАРЕ (исправление бага) =====
function renderCategoriesInSidebar() {
  if (!categoriesList) return;
  
  const allSongsItem = categoriesList.querySelector('[data-page="all-songs"]');
  const likedItem = categoriesList.querySelector('[data-page="liked"]');
  categoriesList.innerHTML = '';
  if (allSongsItem) categoriesList.appendChild(allSongsItem);
  if (likedItem) categoriesList.appendChild(likedItem);
  
  customCategories.forEach(cat => {
    const catEl = document.createElement('div');
    catEl.className = 'nav-item custom-category';
    catEl.dataset.page = 'custom';
    catEl.dataset.catId = cat.id;
    catEl.onclick = function() { window.switchPage(this); };
    catEl.innerHTML = `<i class="fa-solid fa-folder"></i><span>${escapeHtml(cat.name)}</span><button class="delete-cat" title="Удалить"><i class="fa-solid fa-xmark"></i></button>`;
    catEl.querySelector('.delete-cat').onclick = (e) => {
      e.stopPropagation();
      deleteCategory(cat.id, catEl);
    };
    categoriesList.appendChild(catEl);
  });
}

// ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
function setupEventListeners() {
  // Управление окном
  document.getElementById('minimizeBtn').onclick = () => window.electronAPI?.windowMinimize();
  document.getElementById('maximizeBtn').onclick = async () => {
    if (window.electronAPI?.windowMaximize) {
      await window.electronAPI.windowMaximize();
      const isMax = await window.electronAPI.windowIsMaximized?.();
      document.getElementById('maximizeBtn').textContent = isMax ? '❐' : '☐';
    }
  };
  document.getElementById('closeBtn').onclick = () => window.electronAPI?.windowClose();
  
  // Кнопки действий
  addTrackBtn?.addEventListener('click', addFiles);
  addFolderBtn?.addEventListener('click', addFolder);
  addCategoryBtn.addEventListener('click', openModal);
  
  // Кнопка настроек
  if (settingsTopBtn) {
    settingsTopBtn.onclick = () => {
      const settingsNav = document.querySelector('[data-page="settings"]');
      if (settingsNav) window.switchPage(settingsNav);
    };
  }
  
  // Поиск
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      _currentPage = 0;
      renderPlaylist();
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchQuery = '';
        renderPlaylist();
      }
    });
  }
  
  // Плеер
  playBtn.onclick = togglePlay;
  prevBtn.onclick = handlePrev;
  nextBtn.onclick = handleNext;
  setupDraggableProgress();
  setupDraggableVolume();
  volumeIcon.onclick = toggleMute;

  // Кнопки на карточке "Сейчас играет"
  document.getElementById('npPlayBtn')?.addEventListener('click', togglePlay);
  document.getElementById('npPrevBtn')?.addEventListener('click', handlePrev);
  document.getElementById('npNextBtn')?.addEventListener('click', handleNext);
  document.getElementById('npShuffleBtn')?.addEventListener('click', () => { toggleShuffle(); updateNowPlayingCard(); });
  document.getElementById('npRepeatBtn')?.addEventListener('click', () => { toggleRepeat(); updateNowPlayingCard(); });
  // Кликабельный прогресс-бар на карточке
  document.getElementById('nowPlayingProgressBg')?.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
  });
  
  // Drag-and-drop для добавления файлов
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', handleDrop);
  
  // Сортировка
  sortBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    sortDropdown.classList.toggle('open');
  });
  sortOptions.forEach(opt => {
    opt.onclick = () => handleSort(opt);
  });
  
  // Закрытие выпадающих меню при клике вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sort-container')) {
      sortDropdown.classList.remove('open');
    }
    if (!e.target.closest('.context-menu')) {
      trackContextMenu.classList.remove('open');
    }
  });
  
  // Модалки
  setupModalListeners();
  
  // Создание категории
  if (categoryInput) {
    categoryInput.addEventListener('input', () => {
      if (createBtn) createBtn.disabled = categoryInput.value.trim().length === 0;
    });
    categoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && categoryInput.value.trim()) createCategory();
      if (e.key === 'Escape') closeModal();
    });
  }
  if (createBtn) {
    createBtn.addEventListener('click', createCategory);
  }
  
  // Лайк, шаффл, рипит
  likeBtn.onclick = toggleLike;
  shuffleBtn.onclick = toggleShuffle;
  repeatBtn.onclick = toggleRepeat;
  
  audio.onended = handleTrackEnded;
  document.addEventListener('keydown', handleKeyDown);
  
  // Кнопка очистки недавних
  const clearRecentBtn = document.getElementById('clearRecentBtn');
  if (clearRecentBtn) {
    clearRecentBtn.onclick = () => {
      recentlyPlayed = [];
      saveData();
      renderRecent();
      showToast('История очищена');
    };
  }
  
  // Wheel scroll for recent cards
  if (recentCards) {
    recentCards.addEventListener('wheel', (e) => {
      e.preventDefault();
      recentCards.scrollLeft += e.deltaY;
    }, { passive: false });
  }
  
  // Fix scroll on all scrollable sections — Electron blocks wheel on empty areas
  const scrollables = [
    document.getElementById('homeWrapper'),
    document.getElementById('playlistView'),
    document.getElementById('settingsView'),
  ];
  scrollables.forEach(el => {
    if (!el) return;
    el.addEventListener('wheel', (e) => {
      if (e.target === el || el.contains(e.target)) {
        // Let native scroll handle it, but ensure the element gets focus
        el.focus?.();
      }
    }, { passive: true });
    // Make element focusable so wheel events work
    if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  });
  
  // Prevent browser context menu
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('input') && !e.target.closest('textarea')) {
      e.preventDefault();
    }
  });
  
  // Кнопка "Открыть местоположение приложения"
  const openAppFolderBtn = document.getElementById('openAppFolderBtn');
  if (openAppFolderBtn) {
    openAppFolderBtn.onclick = () => {
      window.electronAPI?.openAppDataFolder?.();
    };
  }

  // Кнопка очистки библиотеки
  const resetLibraryBtn = document.getElementById('resetLibraryBtn');
  if (resetLibraryBtn) {
    resetLibraryBtn.onclick = () => {
      if (confirm('Очистить всю библиотеку? Это действие нельзя отменить.')) {        tracks = [];
        recentlyPlayed = [];
        playlists = { 'all-songs': { name: 'Все треки', trackPaths: new Set() } };
        currentIndex = -1;
        audio.src = '';
        audio.load();
        trackNameEl.textContent = 'Выберите трек';
        trackArtistEl.textContent = '—';
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '0:00';
        totalTimeEl.textContent = '0:00';
        isPlaying = false;
        playIcon.className = 'fa-solid fa-play';
        stopProgress();
        renderAll();
        updateSettingsStats();
        saveData();
        showToast('Библиотека очищена');
      }
    };
  }
}

// ===== DRAG AND DROP =====
async function handleDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return window.appConfig?.supportedFormats?.includes(ext);
  });
  if (!files.length) return;
  
  const total = files.length;
  await showLoadingModal(total);
  let added = 0;
  const newTracks = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    updateLoadingModal(i + 1, total, file.name);
    const filePath = file.path;
    if (!tracks.some(t => t.path === filePath)) {
      const fileName = file.name;
      const track = {
        path: filePath,
        name: fileName.replace(/\.[^.]+$/, ''),
        ext: fileName.split('.').pop().toUpperCase(),
        duration: null,
        dateAdded: Date.now(),
        liked: false,
        categories: ['all-songs']
      };
      tracks.push(track);
      newTracks.push(track);
      added++;
    }
    await new Promise(r => setTimeout(r, 0));
  }

  if (newTracks.length) {
    await loadMetadataInModal(newTracks, total);
  }

  await hideLoadingModal();
  if (currentIndex === -1 && tracks.length > 0) loadTrack(0);
  saveData();
  if (added > 0) showToast(`Добавлено ${added} трек(ов)`);
}

// ===== НАСТРОЙКА МОДАЛЬНЫХ ОКОН =====
function setupModalListeners() {
  // Закрытие модалок по кнопкам
  document.querySelectorAll('.modal-close, .modal-btn-cancel, .delete-modal-btn-cancel').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = e.currentTarget.dataset.modal;
      if (modalId) closeModalById(modalId);
      else closeModal();
    });
  });
  
  // Закрытие по клику на оверлей
  [detailsModal, playlistModal, deleteModal, missingFileModal].forEach(modal => {
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModalById(modal.id);
    });
  });
  
  // editTrackModal — сохраняем при клике вне
  const editModal = document.getElementById('editTrackModal');
  if (editModal) {
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) {
        const idx = editModal._editIndex;
        if (idx !== undefined) saveEditTrack(idx);
        else closeModalById('editTrackModal');
      }
    });
  }
  
  // Обработка пунктов контекстного меню
  document.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      handleContextMenuAction(action);
      trackContextMenu.classList.remove('open');
    });
  });
  
  // Выбор плейлистов в модалке
  if (playlistListContent) {
    playlistListContent.addEventListener('click', (e) => {
      const checkbox = e.target.closest('.playlist-checkbox');
      if (checkbox) {
        const playlistId = checkbox.dataset.playlistId;
        checkbox.classList.toggle('checked');
        if (checkbox.classList.contains('checked')) {
          selectedPlaylists.add(playlistId);
        } else {
          selectedPlaylists.delete(playlistId);
        }
      }
    });
  }
  
  // Добавление в плейлист
  if (addToPlaylistBtn) {
    addToPlaylistBtn.addEventListener('click', () => {
      if (selectedTrackIndex !== null && selectedTrackIndex < tracks.length) {
        const trackPath = tracks[selectedTrackIndex].path;
        selectedPlaylists.forEach(pid => {
          if (playlists[pid]) {
            playlists[pid].trackPaths.add(trackPath);
            // Also update track.categories
            const trackObj = tracks.find(t => t.path === trackPath);
            if (trackObj && !trackObj.categories.includes(pid)) {
              trackObj.categories.push(pid);
            }
          }
        });
        saveData();
        closeModalById('playlistModal');
        renderPlaylist();
        showToast('Добавлено в плейлист');
      }
    });
  }
  
  // Синхронизация папки
  if (syncFolderBtn) {
    syncFolderBtn.addEventListener('click', async () => {
      const folder = await window.electronAPI?.openFolder();
      if (folder) {
        await syncFolder(folder);
        showToast('Папка синхронизирована');
      }
    });
  }
  
  // Копирование пути отсутствующего файла
  if (copyMissingPathBtn) {
    copyMissingPathBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(missingFilePathEl.textContent).then(() => {
        showToast('Скопировано!');
      });
    });
  }
  
  // Удаление трека при подтверждении (missingFile)
  if (okMissingFileBtn) {
    okMissingFileBtn.addEventListener('click', () => {
      removeTrackByPath(missingFilePathEl.textContent);
      closeModalById('missingFileModal');
    });
  }
  
  // Подтверждение удаления
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', () => {
      deleteSelectedTracks();
      closeModalById('deleteModal');
    });
  }
  
  // Делегирование кликов по кнопкам копирования в деталях трека
  if (detailsModal) {
    detailsModal.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-name-btn');
      if (copyBtn) {
        e.stopPropagation();
        const text = copyBtn.dataset.copy;
        if (text) {
          navigator.clipboard.writeText(text).then(() => showToast('Скопировано!'));
        }
      }
    });
  }
}

// ===== РАБОТА С ФАЙЛАМИ =====
async function addFiles() {
  if (!window.electronAPI?.openFiles) {
    addDemoTracks();
    return;
  }
  const files = await window.electronAPI.openFiles();
  if (!files.length) return;
  
  const total = files.length;
  await showLoadingModal(total);
  let added = 0;
  const newTracks = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = file.split(/[\/\\]/).pop();
    updateLoadingModal(i + 1, total, fileName);
    if (!tracks.some(t => t.path === file)) {
      const track = {
        path: file,
        name: fileName.replace(/\.[^.]+$/, ''),
        ext: fileName.split('.').pop().toUpperCase(),
        duration: null,
        dateAdded: Date.now(),
        liked: false,
        categories: ['all-songs']
      };
      tracks.push(track);
      newTracks.push(track);
      added++;
    }
    await new Promise(r => setTimeout(r, 0));
  }

  // Грузим метаданные и длительности прямо в модальном окне
  if (newTracks.length) {
    await loadMetadataInModal(newTracks, total);
  }

  await hideLoadingModal();
  if (currentIndex === -1 && tracks.length > 0) loadTrack(0);
  saveData();
  if (added > 0) showToast(`Добавлено ${added} трек(ов)`);
}

async function addFolder() {
  if (!window.electronAPI?.openFolder) return;
  const folder = await window.electronAPI.openFolder();
  if (!folder) return;
  
  const files = await window.electronAPI?.getAudioFilesInFolder?.(folder);
  if (!files?.length) return;
  
  const total = files.length;
  await showLoadingModal(total);
  let added = 0;
  const newTracks = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileName = file.split(/[\/\\]/).pop();
    updateLoadingModal(i + 1, total, fileName);
    if (!tracks.some(t => t.path === file)) {
      const track = {
        path: file,
        name: fileName.replace(/\.[^.]+$/, ''),
        ext: fileName.split('.').pop().toUpperCase(),
        duration: null,
        dateAdded: Date.now(),
        liked: false,
        categories: ['all-songs']
      };
      tracks.push(track);
      newTracks.push(track);
      added++;
    }
    await new Promise(r => setTimeout(r, 0));
  }

  // Грузим метаданные и длительности прямо в модальном окне
  if (newTracks.length) {
    await loadMetadataInModal(newTracks, total);
  }

  await hideLoadingModal();
  if (currentIndex === -1 && tracks.length > 0) loadTrack(0);
  saveData();
  showToast(`Добавлено ${added} трек(ов) из папки`);
}
// Загружает метаданные для всех новых треков пока открыто модальное окно
async function loadMetadataInModal(newTracks, totalFiles) {
  if (!window.electronAPI?.getAudioMetadata) return;

  // === Фаза 1: теги и обложки ===
  setLoadingPhase('metadata', 'Загрузка метаданных...');
  const CONCURRENCY = 4;
  let idx = 0;
  let done = 0;

  async function metaWorker() {
    while (idx < newTracks.length) {
      const track = newTracks[idx++];
      if (!track || track._metaLoaded || track.path.startsWith('demo-')) { done++; continue; }
      track._metaLoaded = true;
      try {
        const meta = await window.electronAPI.getAudioMetadata(track.path);
        if (meta) {
          if (meta.title && meta.title.trim()) track.name = meta.title.trim();
          if (meta.artist && meta.artist.trim()) track.artist = meta.artist.trim();
          if (meta.album) track.album = meta.album;
          if (meta.cover && meta.cover.length > 50) track.cover = meta.cover;
        }
      } catch {}
      done++;
      const pct = Math.round((done / newTracks.length) * 100);
      const bar = document.getElementById('loadingProgressBar');
      const stats = document.getElementById('loadingStats');
      const cur = document.getElementById('loadingCurrent');
      if (bar) bar.style.width = pct + '%';
      if (stats) stats.textContent = done + ' / ' + newTracks.length;
      if (cur) cur.textContent = track.name || '';
    }
  }

  const metaWorkers = [];
  for (let i = 0; i < CONCURRENCY; i++) metaWorkers.push(metaWorker());
  await Promise.all(metaWorkers);

  // === Фаза 2: длительности ===
  setLoadingPhase('processing', 'Определение длительности...');
  idx = 0; done = 0;
  const durTracks = newTracks.filter(t => !t.duration && !t.path.startsWith('demo-'));

  async function durWorker() {
    while (idx < durTracks.length) {
      const track = durTracks[idx++];
      try {
        let dur = await window.electronAPI.getAudioDuration(track.path);
        if (!dur || dur <= 0) dur = await getDurationViaAudio(track);
        if (dur && dur > 0) track.duration = dur;
      } catch {}
      done++;
      const pct = Math.round((done / durTracks.length) * 100);
      const bar = document.getElementById('loadingProgressBar');
      const stats = document.getElementById('loadingStats');
      if (bar) bar.style.width = pct + '%';
      if (stats) stats.textContent = done + ' / ' + durTracks.length;
    }
  }

  if (durTracks.length > 0) {
    const durWorkers = [];
    for (let i = 0; i < CONCURRENCY; i++) durWorkers.push(durWorker());
    await Promise.all(durWorkers);
  }

  // === Фаза 3: рендеринг карточек пока модалка открыта ===
  setLoadingPhase('processing', 'Отрисовка карточек...');
  rebuildIndexCache(); // обновляем кэш после добавления новых треков
  await renderPlaylistInBackground();

  saveDataDebounced();
}

// Рендерит первую страницу плейлиста батчами, обновляя прогресс в модалке
async function renderPlaylistInBackground() {
  let displayTracks = currentCategory === 'all-songs'
    ? [...tracks]
    : currentCategory === 'liked'
      ? tracks.filter(t => t.liked)
      : tracks.filter(t => t.categories?.includes(currentCategory));

  switch(currentSortType) {
    case 'name-az': displayTracks.sort((a, b) => a.name.localeCompare(b.name, 'ru')); break;
    case 'name-za': displayTracks.sort((a, b) => b.name.localeCompare(a.name, 'ru')); break;
    case 'date-new-old': displayTracks.sort((a, b) => b.dateAdded - a.dateAdded); break;
    case 'date-old-new': displayTracks.sort((a, b) => a.dateAdded - b.dateAdded); break;
    case 'artist-az': displayTracks.sort((a, b) => (a.artist||'').localeCompare(b.artist||'', 'ru')); break;
    case 'artist-za': displayTracks.sort((a, b) => (b.artist||'').localeCompare(a.artist||'', 'ru')); break;
  }

  _currentDisplayTracks = displayTracks;
  _currentPage = 0;

  const totalPages = Math.ceil(displayTracks.length / PAGE_SIZE);
  const pageTracks = displayTracks.slice(0, PAGE_SIZE);
  const BATCH = 15;

  if (!playlistGrid) return;
  playlistGrid.innerHTML = '';

  const bar = document.getElementById('loadingProgressBar');
  const stats = document.getElementById('loadingStats');
  const cur = document.getElementById('loadingCurrent');

  let rendered = 0;

  for (let start = 0; start < pageTracks.length; start += BATCH) {
    const end = Math.min(start + BATCH, pageTracks.length);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const track = pageTracks[i];
      const realIndex = getTrackIndex(track.path);
      if (realIndex === -1) continue;
      fragment.appendChild(buildTrackCard(track, realIndex, false));
    }
    playlistGrid.appendChild(fragment);
    rendered = end;

    const pct = Math.round((rendered / pageTracks.length) * 100);
    if (bar) bar.style.width = pct + '%';
    if (stats) stats.textContent = rendered + ' / ' + pageTracks.length;
    if (cur && pageTracks[end-1]) cur.textContent = pageTracks[end-1].name || '';

    await new Promise(r => setTimeout(r, 0));
  }

  if (totalPages > 1) {
    const paginationEl = document.createElement('div');
    paginationEl.className = 'pagination';
    paginationEl.innerHTML = buildPaginationHTML(totalPages, 0);
    playlistGrid.appendChild(paginationEl);
  }

  updatePlaylistInfo(displayTracks);
}
async function syncFolder(folderPath) {
  const files = await window.electronAPI?.getAudioFilesInFolder?.(folderPath);
  if (!files?.length) return;
  
  const syncId = `sync-${Date.now()}`;
  syncConfigs.push({ id: syncId, path: folderPath, categories: ['all-songs'] });
  
  let added = 0;
  files.forEach(file => {
    if (!tracks.some(t => t.path === file)) {
      const fileName = file.split(/[\/\\]/).pop();
      tracks.push({
        path: file,
        name: fileName.replace(/\.[^.]+$/, ''),
        ext: fileName.split('.').pop().toUpperCase(),
        duration: null,
        dateAdded: Date.now(),
        liked: false,
        synced: syncId,
        categories: ['all-songs']
      });
      added++;
    }
  });
  
  renderAll();
  renderSyncList();
  renderSyncCategories();
  loadTrackDurations();
  saveData();
}

function addDemoTracks() {
  const demo = [
    { name: 'Midnight Echoes', ext: 'MP3', duration: 227 },
    { name: 'Silver Lining', ext: 'WAV', duration: 252 },
    { name: 'Neon Dreams', ext: 'FLAC', duration: 213 }
  ];
  demo.forEach((t, i) => tracks.push({
    path: `demo-${i}.${t.ext.toLowerCase()}`, ...t,
    dateAdded: Date.now() - i * 3600000, liked: false, categories: ['all-songs']
  }));
  renderAll();
}

// ===== РЕНДЕРИНГ ПЛЕЙЛИСТА (оптимизированный) =====
const PAGE_SIZE = 60;
let _currentDisplayTracks = [];
let _currentPage = 0;
let _lastSortKey = '';

function renderPlaylist(page) {
  if (!playlistGrid) return;
  if (page !== undefined) _currentPage = page;

  let displayTracks = currentCategory === 'all-songs' 
    ? [...tracks] 
    : currentCategory === 'liked'
      ? tracks.filter(t => t.liked)
      : tracks.filter(t => t.categories?.includes(currentCategory));

  // Фильтрация по поиску
  if (searchQuery) {
    displayTracks = displayTracks.filter(t => 
      t.name.toLowerCase().includes(searchQuery) ||
      (t.ext && t.ext.toLowerCase().includes(searchQuery)) ||
      (t.artist && t.artist.toLowerCase().includes(searchQuery))
    );
  }

  if (!displayTracks.length) {
    playlistGrid.innerHTML = `
      <div class="playlist-empty">
        <i class="fa-regular fa-circle-play"></i>
        ${searchQuery ? 'Ничего не найдено' : 'Нет треков'}
      </div>`;
    updatePlaylistInfo(displayTracks);
    updateSelectionBar(displayTracks);
    return;
  }

  // Кэшированная сортировка
  const sortKey = `${currentSortType}-${currentCategory}-${searchQuery}`;
  if (_lastSortKey !== sortKey) {
    switch(currentSortType) {
      case 'name-az': displayTracks.sort((a, b) => a.name.localeCompare(b.name, 'ru')); break;
      case 'name-za': displayTracks.sort((a, b) => b.name.localeCompare(a.name, 'ru')); break;
      case 'date-new-old': displayTracks.sort((a, b) => b.dateAdded - a.dateAdded); break;
      case 'date-old-new': displayTracks.sort((a, b) => a.dateAdded - b.dateAdded); break;
      case 'artist-az': displayTracks.sort((a, b) => (a.artist||'').localeCompare(b.artist||'', 'ru')); break;
      case 'artist-za': displayTracks.sort((a, b) => (b.artist||'').localeCompare(a.artist||'', 'ru')); break;
    }
    _lastSortKey = sortKey;
  }

  _currentDisplayTracks = displayTracks;

  const totalPages = Math.ceil(displayTracks.length / PAGE_SIZE);
  if (_currentPage >= totalPages) _currentPage = totalPages - 1;
  if (_currentPage < 0) _currentPage = 0;

  const startIdx = _currentPage * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, displayTracks.length);
  const pageTracks = displayTracks.slice(startIdx, endIdx);

  playlistGrid.innerHTML = '';
  updatePlaylistInfo(displayTracks);
  updateSelectionBar(displayTracks);

  // Простой рендеринг маленькими батчами
  const isSelecting = selectedTracks.size > 0;
  const BATCH = 10; // Уменьшил батч для плавности
  let batchIdx = 0;

  function renderNextBatch() {
    const end = Math.min(batchIdx + BATCH, pageTracks.length);
    const fragment = document.createDocumentFragment();
    
    for (let i = batchIdx; i < end; i++) {
      const track = pageTracks[i];
      const realIndex = getTrackIndex(track.path);
      if (realIndex === -1) continue;
      fragment.appendChild(buildTrackCard(track, realIndex, isSelecting));
    }
    
    playlistGrid.appendChild(fragment);
    batchIdx = end;
    
    if (batchIdx < pageTracks.length) {
      // Увеличил задержку для плавности
      setTimeout(renderNextBatch, 8);
    } else {
      // Пагинация
      if (totalPages > 1) {
        const paginationEl = document.createElement('div');
        paginationEl.className = 'pagination';
        paginationEl.innerHTML = buildPaginationHTML(totalPages, _currentPage);
        playlistGrid.appendChild(paginationEl);
      }
      loadMetadataForPageIfNeeded(pageTracks);
    }
  }
  
  // Начинаем рендеринг через небольшую задержку
  setTimeout(renderNextBatch, 1);
}

function buildPaginationHTML(totalPages, currentPage) {
  const pages = [];
  // Всегда показываем: первую, последнюю, текущую и ±2 от текущей
  const show = new Set([0, totalPages - 1]);
  for (let i = Math.max(0, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
    show.add(i);
  }
  const sorted = [...show].sort((a, b) => a - b);

  let html = '';
  let prev = -1;
  for (const p of sorted) {
    if (prev !== -1 && p - prev > 1) {
      html += `<button class="page-btn dots" disabled>…</button>`;
    }
    html += `<button class="page-btn${p === currentPage ? ' active' : ''}" onclick="goToPage(${p})">${p + 1}</button>`;
    prev = p;
  }
  return html;
}

window.goToPage = function(page) {
  _currentPage = page;
  renderPlaylist();
  loadTrackDurationsForPage();
  // Скроллим наверх плейлиста
  const pv = document.getElementById('playlistView');
  if (pv) pv.scrollTop = 0;
};

// Загружаем метаданные только для треков БЕЗ данных (старые сохранения без _metaLoaded)
// Треки загруженные через модалку уже имеют все данные — их не трогаем
function loadMetadataForPage(pageTracks) {
  loadMetadataForPageIfNeeded(pageTracks);
}

function loadMetadataForPageIfNeeded(pageTracks) {
  const toLoad = pageTracks.filter(t => !t._metaLoaded && !t.path.startsWith('demo-'));
  if (!toLoad.length) return;
  _metaQueue = [...toLoad, ..._metaQueue.filter(t => !toLoad.includes(t))];
  const needed = Math.min(META_CONCURRENCY, toLoad.length) - _metaActive;
  for (let i = 0; i < needed; i++) _metaWorker();
}


function buildTrackCard(track, realIndex, isSelecting) {
  const isActive = realIndex === currentIndex;
  const isSelected = selectedTracks.has(track.path);
  const card = document.createElement('div');
  card.className = 'track-card' + (isActive ? ' active-track' : '') + (isSelected ? ' selected' : '');
  card.dataset.index = realIndex;
  card.dataset.path = track.path;
  
  // Кастомный цвет карточки
  if (track.cardColor && !isSelected) {
    const hex = track.cardColor;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    card.style.background = `rgba(${r},${g},${b},0.12)`;
    card.style.borderColor = `rgba(${r},${g},${b},0.35)`;
  }

  const duration = track.duration ? formatTime(track.duration) : '--:--';
  const fileType = getFileTypeText(track.ext);
  const iconClass = isActive && isPlaying ? 'pause' : 'play';

  const artContent = isSelected
    ? `<div class="select-check"><i class="fa-solid fa-check"></i></div>`
    : track.cover
      ? `<img class="lazy-cover" style="width:100%;height:100%;object-fit:cover;border-radius:10px;"><div class="play-overlay"><i class="fa-solid fa-${iconClass}"></i></div>`
      : `<i class="fa-solid fa-music"></i><div class="play-overlay"><i class="fa-solid fa-${iconClass}"></i></div>`;

  card.innerHTML = `
    <div class="track-card-art">
      ${artContent}
    </div>
    <div class="track-card-info">
      <div class="track-card-title">${escapeHtml(track.name)}</div>
      <div class="track-card-meta">
        <span class="track-card-type"><i class="fa-regular fa-file-audio"></i> <span>${track.artist ? escapeHtml(track.artist) : fileType}</span></span>
        <span class="track-card-duration"><i class="fa-regular fa-clock"></i> ${duration}</span>
        ${track.liked ? '<span class="track-liked-badge"><i class="fa-solid fa-heart"></i></span>' : ''}
      </div>
    </div>
    <div class="track-card-menu">
      <button class="track-menu-btn" data-index="${realIndex}"><i class="fa-solid fa-ellipsis"></i></button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.track-menu-btn')) return;
    if (isSelecting || e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      toggleTrackSelection(track.path);
    } else if (realIndex === currentIndex) {
      togglePlay();
    } else {
      currentIndex = realIndex;
      loadTrack(realIndex);
      play();
    }
  });

  const menuBtn = card.querySelector('.track-menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    contextTrackIndex = realIndex;
    showContextMenu(e, menuBtn);
  });

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextTrackIndex = realIndex;
    showContextMenu(e, card);
  });

  // Ленивая загрузка обложки
  if (track.cover && !isSelected && _coverObserver) {
    const lazyImg = card.querySelector('img.lazy-cover');
    if (lazyImg) {
      lazyImg.dataset.coverData = track.cover;
      _coverObserver.observe(lazyImg);
    }
  }

  return card;
}

function updatePlaylistInfo(displayTracks) {
  if (!playlistCount) return;
  const total = displayTracks.length;
  playlistCount.textContent = `${total} трек${total === 1 ? '' : total < 5 ? 'а' : 'ов'}`;
}

// ===== ПАНЕЛЬ ВЫДЕЛЕНИЯ =====
function updateSelectionBar(displayTracks) {
  let selectionBar = document.getElementById('selectionBar');
  
  if (selectedTracks.size > 0) {
    if (!selectionBar) {
      selectionBar = document.createElement('div');
      selectionBar.id = 'selectionBar';
      selectionBar.className = 'selection-bar';
      if (playlistCount?.parentElement) {
        playlistCount.parentElement.insertBefore(selectionBar, playlistCount);
      }
    }
    selectionBar.style.display = 'flex';
    selectionBar.innerHTML = `
      <span id="selectionCount">Выделено: <strong>${selectedTracks.size}</strong></span>
      <button id="selectAllBtn" class="select-all-btn">Выделить всё</button>
      <button id="addSelectedToPlaylistBtn" class="add-selected-to-playlist-btn"><i class="fa-solid fa-list"></i> В плейлист</button>
      <button id="deleteSelectedBtn" class="delete-selected-btn"><i class="fa-solid fa-trash"></i> Удалить</button>
      <button id="cancelSelectionBtn" class="cancel-selection-btn"><i class="fa-solid fa-xmark"></i> Отмена</button>
    `;
    
    selectionBar.querySelector('#deleteSelectedBtn').onclick = () => {
      if (selectedTracks.size > 0) openModalById('deleteModal');
    };
    selectionBar.querySelector('#cancelSelectionBtn').onclick = () => {
      selectedTracks.clear();
      renderPlaylist();
    };
    selectionBar.querySelector('#selectAllBtn').onclick = () => {
      displayTracks.forEach(track => selectedTracks.add(track.path));
      renderPlaylist();
    };
    selectionBar.querySelector('#addSelectedToPlaylistBtn').onclick = () => {
      if (selectedTracks.size > 0) {
        const firstTrackPath = Array.from(selectedTracks)[0];
        selectedTrackIndex = tracks.findIndex(t => t.path === firstTrackPath);
        showPlaylistSelection();
        openModalById('playlistModal');
      }
    };
  } else {
    if (selectionBar) selectionBar.style.display = 'none';
  }
}

// ===== ВЫДЕЛЕНИЕ ТРЕКА =====
function toggleTrackSelection(trackPath) {
  if (selectedTracks.has(trackPath)) {
    selectedTracks.delete(trackPath);
  } else {
    selectedTracks.add(trackPath);
  }
  // Update only the affected card visually, avoid full re-render
  const card = playlistGrid?.querySelector(`[data-path="${CSS.escape(trackPath)}"]`);
  if (card) {
    const isSelected = selectedTracks.has(trackPath);
    card.classList.toggle('selected', isSelected);
    const artEl = card.querySelector('.track-card-art');
    if (artEl) {
      if (isSelected) {
        artEl.innerHTML = `<div class="select-check"><i class="fa-solid fa-check"></i></div>`;
      } else {
        const track = tracks.find(t => t.path === trackPath);
        const realIndex = tracks.findIndex(t => t.path === trackPath);
        const isActive = realIndex === currentIndex;
        const iconClass = isActive && isPlaying ? 'pause' : 'play';
        if (track?.cover) {
          const img = document.createElement('img');
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px;';
          img.className = 'lazy-cover';
          img.dataset.coverData = track.cover;
          const overlay = document.createElement('div');
          overlay.className = 'play-overlay';
          overlay.innerHTML = `<i class="fa-solid fa-${iconClass}"></i>`;
          artEl.innerHTML = '';
          artEl.appendChild(img);
          artEl.appendChild(overlay);
          if (_coverObserver) _coverObserver.observe(img);
        } else {
          artEl.innerHTML = `<i class="fa-solid fa-music"></i><div class="play-overlay"><i class="fa-solid fa-${iconClass}"></i></div>`;
        }
      }
    }
  }
  // Update selection bar count
  const selectionBar = document.getElementById('selectionBar');
  if (selectedTracks.size > 0) {
    if (!selectionBar) {
      renderPlaylist(); // full render only if bar doesn't exist yet
    } else {
      selectionBar.style.display = 'flex';
      const countEl = selectionBar.querySelector('#selectionCount');
      if (countEl) countEl.innerHTML = `Выделено: <strong>${selectedTracks.size}</strong>`;
    }
  } else {
    if (selectionBar) selectionBar.style.display = 'none';
  }
}

// ===== УДАЛЕНИЕ ВЫБРАННЫХ ТРЕКОВ =====
function deleteSelectedTracks() {
  const indicesToDelete = [];
  tracks.forEach((track, index) => {
    if (selectedTracks.has(track.path)) indicesToDelete.push(index);
  });
  indicesToDelete.sort((a, b) => b - a);
  
  indicesToDelete.forEach(idx => {
    const track = tracks[idx];
    tracks.splice(idx, 1);
    Object.values(playlists).forEach(pl => pl.trackPaths?.delete(track.path));
    
    if (currentIndex === idx) {
      currentIndex = -1;
      audio.src = '';
      audio.load();
      trackNameEl.textContent = 'Выберите трек';
      trackArtistEl.textContent = '—';
      currentTimeEl.textContent = '0:00';
      totalTimeEl.textContent = '0:00';
      progressFill.style.width = '0%';
      pause();
    } else if (currentIndex > idx) {
      currentIndex--;
    }
  });
  
  selectedTracks.clear();
  renderAll();
  saveData();
  updateNowPlayingCard();
}

// ===== КОНТЕКСТНОЕ МЕНЮ =====
function showContextMenu(event, anchor) {
  const menu = trackContextMenu;
  const menuW = 220;
  const menuH = 180;
  
  let left = event.clientX + 8;
  let top = event.clientY + 8;
  
  if (left + menuW > window.innerWidth - 10) {
    left = event.clientX - menuW - 8;
  }
  if (top + menuH > window.innerHeight - 10) {
    top = event.clientY - menuH - 8;
  }
  
  left = Math.max(10, left);
  top = Math.max(10, top);
  
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.add('open');
}

// ===== ДЕЙСТВИЯ КОНТЕКСТНОГО МЕНЮ =====
function handleContextMenuAction(action) {
  if (contextTrackIndex === null || contextTrackIndex >= tracks.length) return;
  const track = tracks[contextTrackIndex];
  
  switch(action) {
    case 'details':
      showTrackDetails(track);
      openModalById('detailsModal');
      break;
    case 'edit':
      openEditTrackModal(contextTrackIndex);
      break;
    case 'playlist':
      selectedTrackIndex = contextTrackIndex;
      showPlaylistSelection();
      openModalById('playlistModal');
      break;
    case 'select':
      toggleTrackSelection(track.path);
      break;
    case 'delete':
      selectedTracks.add(track.path);
      openModalById('deleteModal');
      break;
    case 'open-explorer':
      window.electronAPI?.openFolderWithFile?.(track.path);
      break;
  }
}

// ===== ДЕТАЛИ ТРЕКА (с кнопками копирования) =====
function showTrackDetails(track) {
  if (!trackDetailsContent) return;
  
  const folderPath = track.path.split(/[\/\\]/).slice(0, -1).join('/');
  
  trackDetailsContent.innerHTML = `
    <div class="track-details-block">
      <div class="track-details-row name-row">
        <span class="track-details-label">Название</span>
        <span class="track-details-value" title="${escapeAttr(track.name)}" style="max-width:none;text-align:right;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(track.name)}</span>
        <button class="copy-name-btn" data-copy="${escapeAttr(track.name)}" title="Копировать название">
          <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
      </div>
      <div class="track-details-row"><span class="track-details-label">Формат</span><span class="track-details-value">${getFileTypeText(track.ext)}</span></div>
      <div class="track-details-row"><span class="track-details-label">Длительность</span><span class="track-details-value">${track.duration ? formatTime(track.duration) : 'Неизвестно'}</span></div>
      <div class="track-details-row"><span class="track-details-label">Добавлен</span><span class="track-details-value">${new Date(track.dateAdded).toLocaleDateString('ru-RU')}</span></div>
    </div>
    <div class="track-details-block">
      <div class="track-details-row">
        <span class="track-details-label">Путь к файлу</span>
        <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;">
          <span class="track-details-value mono" style="max-width:70%;">${escapeHtml(track.path)}</span>
          <button class="copy-name-btn" data-copy="${escapeAttr(track.path)}" title="Копировать путь">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      </div>
      <div class="track-details-row">
        <span class="track-details-label">Путь к папке</span>
        <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;">
          <span class="track-details-value mono" style="max-width:70%;">${escapeHtml(folderPath)}</span>
          <button class="copy-name-btn" data-copy="${escapeAttr(folderPath)}" title="Копировать путь к папке">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="track-details-row"><span class="track-details-label">В избранном</span><span class="track-details-value">${track.liked ? 'Да' : 'Нет'}</span></div>
  `;
}

// ===== ВЫБОР ПЛЕЙЛИСТА =====
function showPlaylistSelection() {
  if (!playlistListContent) return;
  const userPL = Object.entries(playlists).filter(([id]) => id !== 'all-songs');
  if (userPL.length === 0) {
    playlistListContent.innerHTML = '<div style="text-align:center;color:#666;padding:20px">Нет созданных плейлистов</div>';
    return;
  }
  playlistListContent.innerHTML = userPL.map(([id, pl]) =>
    `<div class="playlist-item"><div class="playlist-checkbox ${selectedPlaylists.has(id)?'checked':''}" data-playlist-id="${id}"></div><span class="playlist-name">${escapeHtml(pl.name)}</span><span class="playlist-count">${pl.trackPaths.size} треков</span></div>`
  ).join('');
  selectedPlaylists.clear();
}

// ===== РЕНДЕРИНГ "НЕДАВНО ПРОСЛУШАННЫЕ" =====
function renderRecent() {
  if (!recentCards) return;
  recentCards.innerHTML = '';
  
  const source = recentlyPlayed.length > 0 ? recentlyPlayed : [];
  
  if (!source.length) {
    recentCards.classList.add('empty');
    recentCards.innerHTML = `<div class="empty-message"><i class="fa-regular fa-circle-play"></i>Послушайте что-нибудь</div>`;
    return;
  }
  recentCards.classList.remove('empty');
  
  source.slice(0, 8).forEach(path => {
    const track = tracks.find(t => t.path === path);
    if (!track) return;
    const idx = tracks.findIndex(t => t.path === path);
    
    const isCurrentAndPlaying = idx === currentIndex && isPlaying;
    const card = document.createElement('div');
    card.className = 'song-card' + (isCurrentAndPlaying ? ' playing' : '');
    card.dataset.path = track.path;
    card.dataset.idx = idx;
    
    card.innerHTML = `
      <div class="song-card-art">
        ${track.cover ? `<img class="lazy-cover" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '<i class="fa-solid fa-music"></i>'}
        <div class="play-overlay"><i class="fa-solid fa-${isCurrentAndPlaying ? 'pause' : 'play'}"></i></div>
      </div>
      <div class="song-card-title">${escapeHtml(track.name)}</div>
      <div class="song-card-artist">${track.artist || getFileTypeText(track.ext)}${track.duration ? ' · ' + formatTime(track.duration) : ''}</div>
    `;
    card.onclick = () => {
      if (idx === currentIndex) {
        togglePlay();
      } else {
        currentIndex = idx;
        loadTrack(idx);
        play();
      }
    };
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextTrackIndex = idx;
      showContextMenu(e, card);
    });
    recentCards.appendChild(card);
    // Регистрируем ленивую загрузку обложки
    if (track.cover && _coverObserver) {
      const lazyImg = card.querySelector('img.lazy-cover');
      if (lazyImg) {
        lazyImg.dataset.coverData = track.cover;
        _coverObserver.observe(lazyImg);
      }
    }
  });
}

// Добавить трек в список недавних (с анимацией перемещения)
function addToRecentlyPlayed(path) {
  const wasFirst = recentlyPlayed[0] === path;
  recentlyPlayed = recentlyPlayed.filter(p => p !== path);
  recentlyPlayed.unshift(path);
  if (recentlyPlayed.length > 20) recentlyPlayed = recentlyPlayed.slice(0, 20);
  // Перерисовываем с анимацией только если трек переместился
  if (!wasFirst) {
    renderRecentAnimated();
  }
}

function renderRecentAnimated() {
  if (!recentCards) return;
  // FLIP-анимация: запоминаем позиции до перерисовки
  const oldPositions = {};
  recentCards.querySelectorAll('.song-card').forEach(card => {
    const rect = card.getBoundingClientRect();
    oldPositions[card.dataset.path] = { left: rect.left, top: rect.top };
  });

  renderRecent();

  // Анимируем новые позиции
  recentCards.querySelectorAll('.song-card').forEach(card => {
    const path = card.dataset.path;
    if (oldPositions[path]) {
      const newRect = card.getBoundingClientRect();
      const dx = oldPositions[path].left - newRect.left;
      const dy = oldPositions[path].top - newRect.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        card.style.transition = 'none';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            card.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            card.style.transform = '';
          });
        });
      }
    } else {
      // Новая карточка — появляется
      card.style.opacity = '0';
      card.style.transform = 'scale(0.88) translateY(8px)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          card.style.opacity = '1';
          card.style.transform = '';
        });
      });
    }
  });
}

function updateRecentlyPlaying() {
  if (currentIndex === -1) return;
  const currentPath = tracks[currentIndex].path;
  recentCards.querySelectorAll('.song-card').forEach(card => {
    const isCurrent = card.dataset.path === currentPath;
    const icon = card.querySelector('.play-overlay i');
    if (isCurrent && isPlaying) {
      card.classList.add('playing');
      icon.className = 'fa-solid fa-pause';
    } else {
      card.classList.remove('playing');
      icon.className = 'fa-solid fa-play';
    }
  });
}

let _saveDebounceTimer = null;
function saveDataDebounced() {
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => { saveData(); }, 2000);
}

// ===== ЗАГРУЗКА МЕТАДАННЫХ (очередь, не зависает) =====
const META_CONCURRENCY = 2;
let _metaQueue = [];
let _metaActive = 0;
let _metaPaused = false;

// Инициализирует очередь но НЕ запускает загрузку — 
// метаданные грузятся только для текущей страницы через loadMetadataForPage
function loadAllMetadata() {
  // Просто сбрасываем очередь — реальная загрузка идёт через loadMetadataForPage
  _metaQueue = [];
  _metaActive = 0;
  _metaPaused = false;
  // Запускаем загрузку для текущей страницы если она открыта
  if (currentPage === 'all-songs' || currentPage === 'liked' || currentPage === 'custom') {
    const startIdx = _currentPage * PAGE_SIZE;
    const pageTracks = _currentDisplayTracks.slice(startIdx, startIdx + PAGE_SIZE);
    if (pageTracks.length) loadMetadataForPage(pageTracks);
  }
}

function _metaWorker() {
  if (_metaPaused || !_metaQueue.length) return;
  const track = _metaQueue.shift();
  if (!track || track._metaLoaded) { 
    // Небольшая пауза между треками чтобы не блокировать UI
    setTimeout(_metaWorker, 10);
    return; 
  }
  track._metaLoaded = true;
  _metaActive++;
  loadMetadataForTrack(track).then(() => {
    _metaActive--;
    // Пауза между загрузками чтобы UI оставался отзывчивым
    setTimeout(_metaWorker, 30);
  });
}

async function loadMetadataForTrack(track) {
  if (!window.electronAPI?.getAudioMetadata) return;
  if (track.path.startsWith('demo-')) return;
  try {
    const meta = await window.electronAPI.getAudioMetadata(track.path);
    if (meta) {
      let changed = false;
      if (meta.title && meta.title.trim()) { track.name = meta.title.trim(); changed = true; }
      if (meta.artist && meta.artist.trim()) { track.artist = meta.artist.trim(); changed = true; }
      if (meta.album) track.album = meta.album;
      if (meta.cover && meta.cover.length > 50) { track.cover = meta.cover; changed = true; }

      if (changed) {
        requestAnimationFrame(() => {
          // Обновляем player-bar если это текущий трек
          if (tracks[currentIndex]?.path === track.path) {
            trackNameEl.textContent = track.name;
            trackArtistEl.textContent = track.artist || getFileTypeText(track.ext);
            if (track.cover) {
              const playerArt = document.querySelector('.player-track-art');
              if (playerArt) {
                let img = playerArt.querySelector('img');
                if (!img) { img = document.createElement('img'); playerArt.insertBefore(img, playerArt.firstChild); }
                img.src = track.cover;
              }
            }
            updateNowPlayingCard();
          }
          // Обновляем недавние
          const recentCard = recentCards?.querySelector(`[data-path="${CSS.escape(track.path)}"]`);
          if (recentCard && track.cover) {
            const artEl = recentCard.querySelector('.song-card-art');
            if (artEl) {
              let img = artEl.querySelector('img');
              if (!img) {
                img = document.createElement('img');
                img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:8px;';
                artEl.insertBefore(img, artEl.firstChild);
              }
              img.src = track.cover;
            }
            const artistEl = recentCard.querySelector('.song-card-artist');
            if (artistEl) artistEl.textContent = track.artist || getFileTypeText(track.ext);
          }
          // Обновляем карточку в плейлисте
          const card = playlistGrid?.querySelector(`[data-path="${CSS.escape(track.path)}"]`);
          if (card) {
            const titleEl = card.querySelector('.track-card-title');
            if (titleEl) titleEl.textContent = track.name;
            const typeEl = card.querySelector('.track-card-type span');
            if (typeEl) typeEl.textContent = track.artist || getFileTypeText(track.ext);
            // Обновляем обложку если она появилась
            if (track.cover) {
              const artEl = card.querySelector('.track-card-art');
              if (artEl && !artEl.querySelector('img')) {
                const realIndex = getTrackIndex(track.path);
                const isActive = realIndex === currentIndex;
                const iconClass = isActive && isPlaying ? 'pause' : 'play';
                const img = document.createElement('img');
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px;';
                img.className = 'lazy-cover';
                img.dataset.coverData = track.cover;
                const musicIcon = artEl.querySelector('i.fa-music');
                if (musicIcon) musicIcon.remove();
                artEl.insertBefore(img, artEl.firstChild);
                if (_coverObserver) _coverObserver.observe(img);
              }
            }
          }
        });
        saveDataDebounced();
      }
    }
  } catch(e) { /* тихо */ }
}

// ===== ЗАГРУЗКА ДЛИТЕЛЬНОСТИ =====

// Вспомогательная функция — доступна глобально для loadMetadataInModal
function getDurationViaAudio(track) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = buildFileUrl(track.path);
    const cleanup = () => { a.src = ''; a.onloadedmetadata = null; a.onerror = null; };
    a.onloadedmetadata = () => { cleanup(); resolve(a.duration || null); };
    a.onerror = () => { cleanup(); resolve(null); };
    setTimeout(() => { cleanup(); resolve(null); }, 8000);
  });
}

// Грузит длительности только для треков текущей страницы
function loadTrackDurationsForPage() {
  const startIdx = _currentPage * PAGE_SIZE;
  const pageTracks = _currentDisplayTracks.slice(startIdx, startIdx + PAGE_SIZE);
  const pending = pageTracks.filter(t => !t.duration && !t.path.startsWith('demo-'));
  if (!pending.length) return;

  const CONCURRENCY = 3;
  let idx = 0;
  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(() => {
      renderScheduled = false;
      if (currentPage === 'all-songs' || currentPage === 'liked' || currentPage === 'custom') {
        // Обновляем только длительности в уже отрисованных карточках
        pending.forEach(track => {
          if (!track.duration) return;
          const card = playlistGrid?.querySelector(`[data-path="${CSS.escape(track.path)}"]`);
          if (card) {
            const durEl = card.querySelector('.track-card-duration');
            if (durEl) durEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${formatTime(track.duration)}`;
          }
        });
        if (tracks[currentIndex]?.path && pending.some(t => t.path === tracks[currentIndex].path)) {
          totalTimeEl.textContent = formatTime(tracks[currentIndex].duration || 0);
        }
      }
    }, 400);
  }

  async function worker() {
    while (idx < pending.length) {
      const track = pending[idx++];
      const trackIdx = tracks.indexOf(track);
      if (trackIdx === -1) continue;
      try {
        let dur = await window.electronAPI.getAudioDuration(track.path);
        if (!dur || dur <= 0) dur = await getDurationViaAudio(track);
        if (dur && dur > 0) {
          tracks[trackIdx].duration = dur;
          if (trackIdx === currentIndex) totalTimeEl.textContent = formatTime(dur);
          scheduleRender();
          saveDataDebounced();
        }
      } catch { /* тихо */ }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) worker();
}

// Старая функция — оставляем для совместимости, теперь грузит только текущую страницу
function loadTrackDurations() {
  loadTrackDurationsForPage();
}

// ===== ЗАГРУЗКА ТРЕКА =====
function buildFileUrl(filePath) {
  if (!filePath || filePath.startsWith('demo-')) return filePath;
  if (filePath.startsWith('file://') || filePath.startsWith('localfile://')) return filePath;
  // Encode each segment separately, preserve drive letter
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const encoded = parts.map((p, i) => i === 0 ? p : encodeURIComponent(p)).join('/');
  return 'localfile:///' + encoded;
}

function loadTrack(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  const track = tracks[index];
  
  audio.src = buildFileUrl(track.path);
  audio.load();
  
  trackNameEl.textContent = track.name;
  trackArtistEl.textContent = track.artist || getFileTypeText(track.ext);
  totalTimeEl.textContent = track.duration ? formatTime(track.duration) : '--:--';
  
  // Update player-bar cover art
  const playerArt = document.querySelector('.player-track-art');
  if (playerArt) {
    let img = playerArt.querySelector('img');
    if (track.cover) {
      if (!img) {
        img = document.createElement('img');
        playerArt.insertBefore(img, playerArt.firstChild);
      }
      img.src = track.cover;
    } else {
      if (img) img.remove();
    }
  }
  
  const heart = likeBtn.querySelector('i');
  heart.className = track.liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  heart.style.color = track.liked ? '#fff' : '';
  
  // Обновляем список недавних
  addToRecentlyPlayed(track.path);
  
  // Применяем скорость воспроизведения
  audio.playbackRate = track.speed || 1;
  
  updateActiveCardIcon();
  updateRecentlyPlaying();
  updateNowPlayingCard();
  startMarquee();
}

// ===== ПЛЕЕР =====
function play() {
  if (currentIndex === -1) return;
  audio.play().catch(err => console.warn('Ошибка воспроизведения:', err));
  isPlaying = true;
  playIcon.className = 'fa-solid fa-pause';
  startProgress();
  updateRecentlyPlaying();
  updateActiveCardIcon();
  updateNowPlayingCard();
}

function pause() {
  audio.pause();
  isPlaying = false;
  playIcon.className = 'fa-solid fa-play';
  stopProgress();
  updateRecentlyPlaying();
  updateActiveCardIcon();
  updateNowPlayingCard();
}

// Обновляет только иконку play/pause на активной карточке без полного ре-рендера
function updateActiveCardIcon() {
  if (!playlistGrid) return;
  playlistGrid.querySelectorAll('.track-card').forEach(card => {
    const idx = parseInt(card.dataset.index);
    const overlay = card.querySelector('.play-overlay i');
    if (!overlay) return;
    if (idx === currentIndex) {
      card.classList.add('active-track');
      overlay.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    } else {
      card.classList.remove('active-track');
      overlay.className = 'fa-solid fa-play';
    }
  });
}

function togglePlay() {
  isPlaying ? pause() : play();
}

function handlePrev() {
  if (audio.currentTime > 5) {
    audio.currentTime = 0;
    return;
  }
  if (!tracks.length) return;
  currentIndex = (currentIndex - 1 + tracks.length) % tracks.length;
  loadTrack(currentIndex);
  play();
}

function handleNext() {
  if (!tracks.length) return;
  if (repeatMode === 2) {
    // Повтор одного трека
    audio.currentTime = 0;
    play();
    return;
  }
  if (isShuffle) {
    let next;
    do {
      next = Math.floor(Math.random() * tracks.length);
    } while (next === currentIndex && tracks.length > 1);
    currentIndex = next;
  } else {
    // Идём строго по порядку массива tracks
    currentIndex = (currentIndex + 1) % tracks.length;
  }
  loadTrack(currentIndex);
  play();
}

function handleTrackEnded() {
  if (repeatMode === 2) {
    // Повтор одного трека
    audio.currentTime = 0;
    play();
    return;
  }
  if (repeatMode === 1) {
    // Повтор всего списка
    handleNext();
    return;
  }
  // Обычный режим
  if (isShuffle) {
    handleNext();
  } else if (currentIndex < tracks.length - 1) {
    currentIndex++;
    loadTrack(currentIndex);
    play();
  } else {
    // Конец списка
    pause();
    progressFill.style.width = '0%';
    currentTimeEl.textContent = '0:00';
  }
}

function startProgress() {
  stopProgress();
  progressInterval = setInterval(() => {
    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      progressFill.style.width = pct + '%';
      currentTimeEl.textContent = formatTime(audio.currentTime);
      // Update now-playing card progress
      const npFill = document.getElementById('nowPlayingProgressFill');
      const npCur = document.getElementById('nowPlayingTimeCurrent');
      const npTot = document.getElementById('nowPlayingTimeTotal');
      if (npFill) npFill.style.width = pct + '%';
      if (npCur) npCur.textContent = formatTime(audio.currentTime);
      if (npTot) npTot.textContent = formatTime(audio.duration);
    }
  }, 100);
}

function stopProgress() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// ===== DRAGGABLE PROGRESS BAR =====
let isDraggingProgress = false;
let wasPlayingBeforeDrag = false;

function setupDraggableProgress() {
  // Клик и перетаскивание — работает и на паузе
  progressContainer.addEventListener('mousedown', (e) => {
    if (!audio.duration) return;
    e.preventDefault();
    isDraggingProgress = true;
    wasPlayingBeforeDrag = isPlaying;
    // Останавливаем воспроизведение на время перетаскивания
    if (isPlaying) { audio.pause(); stopProgress(); }
    progressFill.style.transition = 'none';
    seekProgress(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingProgress) return;
    seekProgress(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (!isDraggingProgress) return;
    isDraggingProgress = false;
    progressFill.style.transition = '';
    // Обновляем прогресс-бар на карточке
    const npFill = document.getElementById('nowPlayingProgressFill');
    const npCur = document.getElementById('nowPlayingTimeCurrent');
    if (npFill && audio.duration) npFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    if (npCur) npCur.textContent = formatTime(audio.currentTime);
    // Возобновляем если играло
    if (wasPlayingBeforeDrag) {
      audio.play().catch(() => {});
      startProgress();
      isPlaying = true;
      playIcon.className = 'fa-solid fa-pause';
    }
  });

  // Touch support
  progressContainer.addEventListener('touchstart', (e) => {
    if (!audio.duration) return;
    isDraggingProgress = true;
    wasPlayingBeforeDrag = isPlaying;
    if (isPlaying) { audio.pause(); stopProgress(); }
    progressFill.style.transition = 'none';
    seekProgressTouch(e);
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingProgress) return;
    seekProgressTouch(e);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!isDraggingProgress) return;
    isDraggingProgress = false;
    progressFill.style.transition = '';
    if (wasPlayingBeforeDrag) {
      audio.play().catch(() => {});
      startProgress();
      isPlaying = true;
      playIcon.className = 'fa-solid fa-pause';
    }
  });
}

function seekProgress(e) {
  const rect = progressContainer.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
  progressFill.style.width = (pct * 100) + '%';
  currentTimeEl.textContent = formatTime(audio.currentTime);
}

function seekProgressTouch(e) {
  if (!e.touches[0]) return;
  const rect = progressContainer.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
  progressFill.style.width = (pct * 100) + '%';
  currentTimeEl.textContent = formatTime(audio.currentTime);
}

function handleProgressClick(e) {
  seekProgress(e);
}

function handleSort(option) {
  sortOptions.forEach(o => o.classList.remove('active'));
  option.classList.add('active');
  currentSortType = option.dataset.sort;
  sortDropdown.classList.remove('open');
  _currentPage = 0;
  renderPlaylist();
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
  // Синхронизируем кнопку в карточке "Сейчас играет"
  const npShuffle = document.getElementById('npShuffleBtn');
  if (npShuffle) npShuffle.classList.toggle('active', isShuffle);
}

function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  updateRepeatBtn(repeatBtn);
  const npRepeat = document.getElementById('npRepeatBtn');
  if (npRepeat) updateRepeatBtn(npRepeat);
}

function updateRepeatBtn(btn) {
  if (!btn) return;
  btn.classList.toggle('active', repeatMode > 0);
  if (repeatMode === 2) {
    // Повтор одного трека — показываем "1"
    btn.innerHTML = `<i class="fa-solid fa-repeat"></i><span class="repeat-one-badge">1</span>`;
  } else {
    btn.innerHTML = `<i class="fa-solid fa-repeat"></i>`;
  }
}

function toggleLike() {
  if (currentIndex === -1) return;
  tracks[currentIndex].liked = !tracks[currentIndex].liked;
  const icon = likeBtn.querySelector('i');
  icon.className = tracks[currentIndex].liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
  icon.style.color = tracks[currentIndex].liked ? '#fff' : '';
  saveData();
}

function handleVolumeClick(e) {
  const rect = volumeContainer.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = pct;
  lastVolume = pct;
  isMuted = (pct === 0);
  updateVolumeUI();
}

// ===== DRAGGABLE VOLUME SLIDER =====
let isDraggingVolume = false;

function getVolumePct(clientX) {
  const rect = volumeContainer.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function applyVolumePct(pct) {
  // Snap to 0 when very close to avoid floating-point never reaching 0
  const vol = pct < 0.01 ? 0 : pct;
  audio.volume = vol;
  lastVolume = vol > 0 ? vol : lastVolume;
  isMuted = (vol === 0);
  updateVolumeUI();
}

function setupDraggableVolume() {
  volumeContainer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingVolume = true;
    volumeContainer.classList.add('dragging');
    applyVolumePct(getVolumePct(e.clientX));
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingVolume) return;
    applyVolumePct(getVolumePct(e.clientX));
  });

  document.addEventListener('mouseup', () => {
    if (!isDraggingVolume) return;
    isDraggingVolume = false;
    volumeContainer.classList.remove('dragging');
  });

  // Touch support
  volumeContainer.addEventListener('touchstart', (e) => {
    isDraggingVolume = true;
    volumeContainer.classList.add('dragging');
    applyVolumePct(getVolumePct(e.touches[0].clientX));
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingVolume) return;
    applyVolumePct(getVolumePct(e.touches[0].clientX));
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!isDraggingVolume) return;
    isDraggingVolume = false;
    volumeContainer.classList.remove('dragging');
  });
}

function toggleMute() {
  isMuted = !isMuted;
  audio.volume = isMuted ? 0 : lastVolume;
  updateVolumeUI();
}

function updateVolumeUI() {
  const vol = audio.volume;
  volumeFill.style.width = (vol * 100) + '%';
  if (isMuted || vol === 0) {
    volumeIcon.className = 'fa-solid fa-volume-xmark volume-icon';
  } else if (vol < 0.4) {
    volumeIcon.className = 'fa-solid fa-volume-low volume-icon';
  } else {
    volumeIcon.className = 'fa-solid fa-volume-high volume-icon';
  }
}

// ===== НАВИГАЦИЯ =====
window.switchPage = function(el) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  el.classList.add('active');
  
  const pageName = el.querySelector('span')?.textContent || '';
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = pageName;
  currentPage = el.dataset.page;
  
  if (currentPage === 'custom') {
    currentCategory = el.dataset.catId;
  } else if (currentPage === 'all-songs') {
    currentCategory = 'all-songs';
  } else if (currentPage === 'liked') {
    currentCategory = 'liked';
  } else {
    currentCategory = null;
  }
  
  const graph = document.getElementById('graphSection');
  const playlist = document.getElementById('playlistView');
  const settings = document.getElementById('settingsView');
  const recent = document.getElementById('recentSection');
  const sortCont = document.getElementById('sortContainer');
  const homeWrapper = document.getElementById('homeWrapper');
  
  [homeWrapper, playlist, settings].forEach(s => s?.classList.remove('active'));
  sortCont?.classList.add('hidden');
  
  if (settingsTopBtn) {
    if (currentPage === 'all-songs' || currentPage === 'custom' || currentPage === 'liked') {
      settingsTopBtn.classList.remove('hidden');
    } else {
      settingsTopBtn.classList.add('hidden');
    }
  }
  
  // Показывать поиск только в категориях
  const searchContainer = document.getElementById('searchContainer');
  if (searchContainer) {
    if (currentPage === 'all-songs' || currentPage === 'custom' || currentPage === 'liked') {
      searchContainer.classList.remove('hidden');
    } else {
      searchContainer.classList.add('hidden');
    }
  }
  
  // Сброс поиска при переключении
  if (searchInput) {
    searchInput.value = '';
    searchQuery = '';
  }
  
  // Сброс выделения при переключении
  if (selectedTracks.size > 0) {
    selectedTracks.clear();
  }
  
  switch(currentPage) {
    case 'home':
      homeWrapper?.classList.add('active');
      renderRecent();
      break;
    case 'settings':
      settings?.classList.add('active');
      renderSyncList();
      renderSyncCategories();
      updateSettingsStats();
      break;
    case 'all-songs':
    case 'liked':
    case 'custom':
      playlist?.classList.add('active');
      sortCont?.classList.remove('hidden');
      _currentPage = 0;
      renderPlaylist();
      loadTrackDurationsForPage();
      break;
  }
  sortDropdown?.classList.remove('open');
};

// ===== КАТЕГОРИИ =====
function openModal() {
  modalOverlay.classList.add('open');
  setTimeout(() => categoryInput?.focus(), 200);
}

function createCategory() {
  const name = categoryInput?.value.trim();
  if (!name) return;
  if (name.toLowerCase() === 'все треки' || name.toLowerCase() === 'all tracks') {
    alert('Нельзя создать категорию с названием "Все треки"');
    return;
  }
  categoryCounter++;
  const catId = `cat-${categoryCounter}`;
  if (!playlists[catId]) {
    playlists[catId] = { name, trackPaths: new Set() };
  }
  customCategories.push({ id: catId, name });

  const catEl = document.createElement('div');
  catEl.className = 'nav-item custom-category';
  catEl.dataset.page = 'custom';
  catEl.dataset.catId = catId;
  catEl.onclick = function() { window.switchPage(this); };
  catEl.innerHTML = `<i class="fa-solid fa-folder"></i><span>${escapeHtml(name)}</span><button class="delete-cat" title="Удалить"><i class="fa-solid fa-xmark"></i></button>`;
  catEl.querySelector('.delete-cat').onclick = (e) => {
    e.stopPropagation();
    deleteCategory(catId, catEl);
  };
  categoriesList?.appendChild(catEl);
  closeModal();
  saveData();
}

function deleteCategory(catId, el) {
  el.style.transition = 'all 0.25s ease';
  el.style.opacity = '0';
  el.style.transform = 'translateX(-16px)';
  setTimeout(() => {
    el.remove();
    customCategories = customCategories.filter(c => c.id !== catId);
    delete playlists[catId];
    if (currentPage === 'custom' && currentCategory === catId) {
      const allSongs = document.querySelector('[data-page="all-songs"]');
      if (allSongs) window.switchPage(allSongs);
    }
    saveData();
  }, 250);
}

// ===== СИНХРОНИЗАЦИЯ =====
function renderSyncList() {
  if (!syncListContent) return;
  if (!syncConfigs.length) {
    syncListContent.innerHTML = '<div style="text-align:center;color:#555;padding:16px;font-size:13px">Нет синхронизированных папок</div>';
    return;
  }
  syncListContent.innerHTML = syncConfigs.map((cfg, i) => {
    const count = tracks.filter(t => t.synced === cfg.id).length;
    const folderName = cfg.path.split(/[\/\\]/).pop() || cfg.path;
    return `
      <div class="sync-item">
        <div class="sync-item-icon"><i class="fa-solid fa-folder"></i></div>
        <div class="sync-item-info">
          <div class="sync-item-name">${escapeHtml(folderName)}</div>
          <div class="sync-item-path" title="${escapeHtml(cfg.path)}">${escapeHtml(cfg.path)}</div>
        </div>
        <span class="sync-item-count">${count} тр.</span>
      </div>`;
  }).join('');
}

function renderSyncCategories() {
  if (!syncCategoriesContent) return;
  const cats = [{ id: 'all-songs', name: 'Все треки', def: true, chk: true }];
  customCategories.forEach(c => cats.push({
    id: c.id, name: c.name, def: false,
    chk: syncConfigs[0]?.categories?.includes(c.id) ?? false
  }));
  syncCategoriesContent.innerHTML = cats.map(c =>
    `<label class="category-toggle${c.def ? ' default' : ''}">
      <input type="checkbox" ${c.def ? 'checked disabled' : c.chk ? 'checked' : ''} data-category-id="${c.id}" ${!c.def ? 'onchange="toggleSyncCategory(this)"' : ''}>
      <div class="cb-box"></div>
      <span>${escapeHtml(c.name)}${c.def ? ' (по умолчанию)' : ''}</span>
    </label>`
  ).join('');
}

window.toggleSyncCategory = function(cb) {
  const id = cb.dataset.categoryId;
  syncConfigs.forEach(cfg => {
    if (cb.checked) {
      if (!cfg.categories.includes(id)) cfg.categories.push(id);
    } else {
      cfg.categories = cfg.categories.filter(i => i !== id);
    }
  });
  saveData();
};

// ===== ПРОВЕРКА ФАЙЛОВ =====
async function checkMissingFiles() {
  const missing = [];
  for (const t of tracks) {
    const exists = await window.electronAPI?.checkFileExists?.(t.path);
    if (!exists) missing.push(t);
  }
  if (missing.length > 0) showMissingFileModal(missing[0]);
}

function showMissingFileModal(t) {
  missingFileNameEl.textContent = t.name;
  missingFilePathEl.textContent = t.path;
  openModalById('missingFileModal');
}

// ===== УДАЛЕНИЕ ТРЕКА =====
function removeTrack(index) {
  const track = tracks[index];
  tracks.splice(index, 1);
  selectedTracks.delete(track.path);
  Object.values(playlists).forEach(pl => pl.trackPaths?.delete(track.path));
  
  if (currentIndex === index) {
    currentIndex = -1;
    audio.src = '';
    audio.load();
    trackNameEl.textContent = 'Выберите трек';
    trackArtistEl.textContent = '—';
    currentTimeEl.textContent = '0:00';
    totalTimeEl.textContent = '0:00';
    progressFill.style.width = '0%';
    pause();
  } else if (currentIndex > index) {
    currentIndex--;
  }
  
  renderAll();
  saveData();
}

function removeTrackByPath(path) {
  const idx = tracks.findIndex(t => t.path === path);
  if (idx !== -1) removeTrack(idx);
}

// ===== ДАННЫЕ =====
async function saveData() {
  if (!window.electronAPI?.saveData) return;
  await window.electronAPI.saveData({
    tracks,
    playlists,
    syncConfigs,
    customCategories,
    categoryCounter,
    recentlyPlayed,
    settings: { volume: lastVolume, isMuted, isShuffle, repeatMode }
  });
}

async function loadData() {
  if (!window.electronAPI?.loadData) return;
  try {
    const data = await window.electronAPI.loadData();
    if (data) {
      tracks = data.tracks || [];
      playlists = data.playlists || { 'all-songs': { name: 'Все треки', trackPaths: new Set(tracks.map(t=>t.path)) } };
      syncConfigs = data.syncConfigs || [];
      customCategories = data.customCategories || [];
      categoryCounter = data.categoryCounter || 0;
      recentlyPlayed = data.recentlyPlayed || [];
      
      if (data.settings) {
        lastVolume = data.settings.volume ?? lastVolume;
        isMuted = data.settings.isMuted ?? isMuted;
        isShuffle = data.settings.isShuffle ?? isShuffle;
        repeatMode = data.settings.repeatMode ?? repeatMode;
        audio.volume = lastVolume;
        updateVolumeUI();
        shuffleBtn.classList.toggle('active', isShuffle);
        updateRepeatBtn(repeatBtn);
      }
      
      if (!playlists['all-songs']) {
        playlists['all-songs'] = { name: 'Все треки', trackPaths: new Set(tracks.map(t=>t.path)) };
      } else {
        playlists['all-songs'].trackPaths = new Set(tracks.map(t=>t.path));
      }
      
      tracks.forEach(t => {
        if (!t.categories) t.categories = ['all-songs'];
        else if (!t.categories.includes('all-songs')) t.categories.push('all-songs');
        delete t._metaLoaded;
        // Валидация обложек
        if (t.cover && !t.cover.startsWith('data:')) t.cover = null;
        // Треки с обложкой И исполнителем считаем загруженными
        if (t.cover && t.artist) t._metaLoaded = true;
      });
    }
  } catch(e) {
    console.error('Ошибка загрузки:', e);
  }
}

function renderAll() {
  rebuildIndexCache();
  renderPlaylist();
  renderRecent();
}

// ===== СТАТИСТИКА НАСТРОЕК =====
function updateSettingsStats() {
  const totalEl = document.getElementById('statTotalTracks');
  const timeEl = document.getElementById('statTotalTime');
  const likedEl = document.getElementById('statLiked');
  if (totalEl) totalEl.textContent = tracks.length;
  if (timeEl) {
    const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    timeEl.textContent = h > 0 ? `${h}ч ${m}м` : `${m}м`;
  }
  if (likedEl) likedEl.textContent = tracks.filter(t => t.liked).length;
}

// ===== ГРАФ АКТИВНОСТИ — УДАЛЁН =====
function initGraph() { /* граф удалён */ }
window.saveSettingToggle = function(key, value) {
  if (key === 'animations') {
    document.body.classList.toggle('no-animations', !value);
  }
  if (key === 'marquee') {
    setMarqueeEnabled(value);
  }
  showToast(value ? 'Включено' : 'Выключено');
};

function loadUIPreferences() {
  // Загружаем настройку бегущей строки
  const saved = localStorage.getItem('marqueeEnabled');
  if (saved !== null) marqueeEnabled = saved !== 'false';
  // Синхронизируем тоггл если он есть
  const toggle = document.getElementById('marqueeToggle');
  if (toggle) toggle.classList.toggle('on', marqueeEnabled);
}

// ===== БЕГУЩАЯ СТРОКА В PLAYER-BAR =====
function startMarquee() {
  stopMarquee();
  if (!marqueeEnabled) return;

  const nameEl = document.getElementById('trackName');
  const artistEl = document.getElementById('trackArtist');
  if (!nameEl || !artistEl) return;

  // Запускаем с задержкой чтобы дать время отрисоваться
  _marqueeTimers.start = setTimeout(() => {
    animateMarqueeEl(nameEl, 1.0);   // нормальная скорость
    animateMarqueeEl(artistEl, 0.5); // в 2 раза медленнее
  }, 800);
}

function animateMarqueeEl(el, speedFactor) {
  const container = el.closest('.player-track-details');
  if (!container) return;

  const containerW = container.offsetWidth;
  const textW = el.scrollWidth;

  // Если текст не переполняет — не анимируем
  if (textW <= containerW + 2) {
    el.style.transform = '';
    el.style.transition = '';
    return;
  }

  // Показываем fade
  container.classList.add('marquee-active');

  const overflow = textW - containerW;
  // Скорость: 40px/сек базовая, умноженная на speedFactor
  const duration = (overflow / 40) / speedFactor;

  const key = el.id || ('el_' + Math.random().toString(36).slice(2));

  function cycle() {
    // Стоим на месте 1 секунду (начальная позиция — fade не нужен слева)
    el.style.transition = 'none';
    el.style.transform = 'translateX(0)';

    _marqueeTimers[key] = setTimeout(() => {
      // Едем влево
      el.style.transition = `transform ${duration}s linear`;
      el.style.transform = `translateX(-${overflow}px)`;

      _marqueeTimers[key + '_back'] = setTimeout(() => {
        // Пауза в конце 0.5с
        _marqueeTimers[key + '_pause'] = setTimeout(() => {
          // Возвращаемся
          el.style.transition = `transform ${duration}s linear`;
          el.style.transform = 'translateX(0)';

          _marqueeTimers[key + '_cycle'] = setTimeout(cycle, duration * 1000 + 1000);
        }, 500);
      }, duration * 1000);
    }, 1000);
  }

  cycle();
}

function stopMarquee() {
  Object.values(_marqueeTimers).forEach(t => clearTimeout(t));
  _marqueeTimers = {};
  const nameEl = document.getElementById('trackName');
  const artistEl = document.getElementById('trackArtist');
  const details = document.querySelector('.player-track-details');
  if (nameEl) { nameEl.style.transform = ''; nameEl.style.transition = 'transform 0.4s ease'; }
  if (artistEl) { artistEl.style.transform = ''; artistEl.style.transition = 'transform 0.4s ease'; }
  if (details) details.classList.remove('marquee-active');
}

function setMarqueeEnabled(enabled) {
  marqueeEnabled = enabled;
  localStorage.setItem('marqueeEnabled', enabled);
  if (enabled) {
    startMarquee();
  } else {
    stopMarquee();
  }
}

function handleKeyDown(e) {
  if (e.code === 'Space' && !e.target.matches('input, textarea')) {
    e.preventDefault();
    togglePlay();
  }
  if (e.code === 'ArrowRight' && audio.duration && !e.target.matches('input, textarea')) {
    audio.currentTime = Math.min(audio.currentTime + 5, audio.duration);
  }
  if (e.code === 'ArrowLeft' && !e.target.matches('input, textarea')) {
    audio.currentTime = Math.max(audio.currentTime - 5, 0);
  }
  if (e.code === 'Escape') {
    trackContextMenu.classList.remove('open');
    sortDropdown.classList.remove('open');
    if (selectedTracks.size > 0) {
      selectedTracks.clear();
      renderPlaylist();
    }
  }
}

// ===== МОДАЛКА ЗАГРУЗКИ =====
let _loadingPhrases = null;
let _phraseTimer = null;
let _phrasePhase = 'loading';

async function ensureLoadingPhrases() {
  if (_loadingPhrases) return;
  try {
    _loadingPhrases = await window.electronAPI?.getLoadingPhrases?.();
  } catch { /* тихо */ }
  if (!_loadingPhrases) {
    _loadingPhrases = {
      loading: ['Загружаем треки...'],
      metadata: ['Читаем метаданные...'],
      processing: ['Финальная обработка...'],
      done: ['Готово!']
    };
  }
}

function _getRandomPhrase(phase) {
  const list = _loadingPhrases?.[phase];
  if (!list?.length) return '';
  return list[Math.floor(Math.random() * list.length)];
}

function _startPhraseRotation(phase) {
  _phrasePhase = phase;
  _stopPhraseRotation();
  const el = document.getElementById('loadingPhrase');
  if (!el) return;

  function showNext() {
    // Плавно скрываем
    el.classList.add('fade');
    setTimeout(() => {
      el.textContent = _getRandomPhrase(_phrasePhase);
      el.classList.remove('fade');
    }, 500);
  }

  // Показываем сразу первую фразу
  el.textContent = _getRandomPhrase(phase);
  el.classList.remove('fade');
  // Меняем каждые 5 секунд
  _phraseTimer = setInterval(showNext, 5000);
}

function _stopPhraseRotation() {
  if (_phraseTimer) { clearInterval(_phraseTimer); _phraseTimer = null; }
}

async function showLoadingModal(total) {
  await ensureLoadingPhrases();
  const m = document.getElementById('loadingModal');
  if (!m) return;
  m.style.opacity = '';
  m.style.transition = '';
  document.getElementById('loadingProgressBar').style.width = '0%';
  document.getElementById('loadingStats').textContent = `0 / ${total}`;
  document.getElementById('loadingCurrent').textContent = 'Подготовка...';
  const titleEl = document.getElementById('loadingTitle');
  if (titleEl) titleEl.textContent = 'Загрузка файлов...';
  m.classList.add('open');
  _startPhraseRotation('loading');
}

function updateLoadingModal(current, total, fileName) {
  const pct = Math.round((current / total) * 100);
  const bar = document.getElementById('loadingProgressBar');
  const stats = document.getElementById('loadingStats');
  const cur = document.getElementById('loadingCurrent');
  if (bar) bar.style.width = pct + '%';
  if (stats) stats.textContent = `${current} / ${total}`;
  if (cur) cur.textContent = fileName;
}

function setLoadingPhase(phase, titleText) {
  _startPhraseRotation(phase);
  const titleEl = document.getElementById('loadingTitle');
  if (titleEl) titleEl.textContent = titleText;
  const bar = document.getElementById('loadingProgressBar');
  if (bar) bar.style.width = '0%';
}

// Плавное закрытие: показываем фразу "done", ждём 1с, потом 1с fade
async function hideLoadingModal() {
  _stopPhraseRotation();
  const m = document.getElementById('loadingModal');
  if (!m) return;

  // Показываем фазу завершения
  const titleEl = document.getElementById('loadingTitle');
  const bar = document.getElementById('loadingProgressBar');
  const stats = document.getElementById('loadingStats');
  const cur = document.getElementById('loadingCurrent');
  const phraseEl = document.getElementById('loadingPhrase');
  const spinner = document.getElementById('loadingSpinner');

  if (bar) bar.style.width = '100%';
  if (titleEl) titleEl.textContent = 'Готово!';
  if (stats) stats.textContent = '';
  if (cur) cur.textContent = '';
  if (spinner) spinner.style.borderTopColor = 'rgba(255,255,255,0.3)';

  // Показываем финальную фразу
  if (phraseEl) {
    phraseEl.classList.add('fade');
    await new Promise(r => setTimeout(r, 300));
    phraseEl.textContent = _getRandomPhrase('done');
    phraseEl.classList.remove('fade');
  }

  // Ждём 1 секунду
  await new Promise(r => setTimeout(r, 1000));

  // Плавно исчезаем за 1 секунду
  m.style.transition = 'opacity 1s ease';
  m.style.opacity = '0';
  await new Promise(r => setTimeout(r, 1000));

  m.classList.remove('open');
  m.style.opacity = '';
  m.style.transition = '';
  if (spinner) spinner.style.borderTopColor = '';
}

// ===== КАРТОЧКА "СЕЙЧАС ИГРАЕТ" =====
function updateNowPlayingCard() {
  const card = document.getElementById('nowPlayingCard');
  const artEl = document.getElementById('nowPlayingArt');
  const titleEl = document.getElementById('nowPlayingTitle');
  const artistEl = document.getElementById('nowPlayingArtist');
  const eqEl = document.getElementById('nowPlayingEq');
  const progressWrap = document.getElementById('nowPlayingProgressWrap');
  const progressFillEl = document.getElementById('nowPlayingProgressFill');
  const timeCur = document.getElementById('nowPlayingTimeCurrent');
  const timeTot = document.getElementById('nowPlayingTimeTotal');
  const dateEl = document.getElementById('nowPlayingDate');
  const controls = document.getElementById('nowPlayingControls');
  const npPlayIcon = document.getElementById('npPlayIcon');
  if (!card) return;

  if (currentIndex === -1 || !tracks[currentIndex]) {
    card.classList.remove('has-track', 'has-accent');
    card.style.removeProperty('--np-accent');
    card.style.removeProperty('--np-accent-bg');
    if (artEl) {
      artEl.classList.remove('has-cover');
      const img = artEl.querySelector('img');
      if (img) img.remove();
      let musicIcon = artEl.querySelector('i.fa-music');
      if (!musicIcon) {
        musicIcon = document.createElement('i');
        musicIcon.className = 'fa-solid fa-music';
        artEl.insertBefore(musicIcon, artEl.firstChild);
      }
      musicIcon.style.display = '';
    }
    if (titleEl) titleEl.innerHTML = '<span class="now-playing-empty">Ничего не воспроизводится</span>';
    if (artistEl) artistEl.textContent = '';
    if (progressWrap) progressWrap.style.display = 'none';
    if (controls) controls.style.display = 'none';
    if (dateEl) dateEl.style.display = 'none';
    return;
  }

  const track = tracks[currentIndex];
  card.classList.add('has-track');

  // Цветной акцент из cardColor трека
  if (track.cardColor) {
    const hex = track.cardColor;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    card.classList.add('has-accent');
    card.style.setProperty('--np-accent', `rgba(${r},${g},${b},0.4)`);
    card.style.setProperty('--np-accent-bg', `rgba(${r},${g},${b},0.07)`);
  } else {
    card.classList.remove('has-accent');
    card.style.removeProperty('--np-accent');
    card.style.removeProperty('--np-accent-bg');
  }

  // Обложка
  if (artEl) {
    let img = artEl.querySelector('img');
    let musicIcon = artEl.querySelector('i.fa-music');
    if (track.cover) {
      artEl.classList.add('has-cover');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        artEl.insertBefore(img, artEl.firstChild);
      }
      img.src = track.cover;
      if (musicIcon) musicIcon.style.display = 'none';
    } else {
      artEl.classList.remove('has-cover');
      if (img) img.remove();
      if (musicIcon) musicIcon.style.display = '';
    }
  }

  if (titleEl) titleEl.textContent = track.name;
  if (artistEl) artistEl.textContent = track.artist || getFileTypeText(track.ext);

  // Overlay icon (на обложке)
  const overlayIcon = document.getElementById('nowPlayingPlayIcon');
  if (overlayIcon) overlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';

  // Кнопки управления
  if (controls) controls.style.display = 'flex';
  if (npPlayIcon) npPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
  // Синхронизируем состояние shuffle/repeat
  const npShuffle = document.getElementById('npShuffleBtn');
  const npRepeat = document.getElementById('npRepeatBtn');
  if (npShuffle) npShuffle.classList.toggle('active', isShuffle);
  if (npRepeat) npRepeat.classList.toggle('active', repeatMode > 0);

  // Прогресс
  if (progressWrap) progressWrap.style.display = 'block';
  const dur = audio.duration || track.duration || 0;
  const cur = audio.currentTime || 0;
  if (progressFillEl) progressFillEl.style.width = dur ? (cur / dur * 100) + '%' : '0%';
  if (timeCur) timeCur.textContent = formatTime(cur);
  if (timeTot) timeTot.textContent = formatTime(dur);

  // Дата
  if (dateEl) {
    dateEl.textContent = 'Добавлен: ' + formatDate(track.dateAdded);
    dateEl.style.display = 'block';
  }

  // EQ анимация
  if (eqEl) eqEl.classList.toggle('paused', !isPlaying);
}

// ===== МОДАЛКА РЕДАКТИРОВАНИЯ ТРЕКА =====
const EQ_BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

function openEditTrackModal(trackIndex) {
  if (trackIndex === null || trackIndex >= tracks.length) return;
  const track = tracks[trackIndex];
  
  // Заполняем поля
  document.getElementById('editTrackName').value = track.name || '';
  document.getElementById('editTrackArtist').value = track.artist || '';
  
  const speedSlider = document.getElementById('editSpeedSlider');
  const speedVal = document.getElementById('editSpeedVal');
  const speed = track.speed || 1;
  speedSlider.value = speed;
  speedVal.textContent = speed.toFixed(2) + '×';
  speedSlider.oninput = () => {
    speedVal.textContent = parseFloat(speedSlider.value).toFixed(2) + '×';
  };
  
  // Обложка
  const preview = document.getElementById('editCoverPreview');
  if (track.cover) {
    preview.innerHTML = `<img src="${track.cover}" alt=""><div class="edit-cover-overlay"><i class="fa-solid fa-camera"></i><span>Изменить</span></div>`;
  } else {
    preview.innerHTML = `<i class="fa-solid fa-music"></i><div class="edit-cover-overlay"><i class="fa-solid fa-camera"></i><span>Загрузить GIF/изображение</span></div>`;
  }
  preview.onclick = () => document.getElementById('editCoverInput').click();
  
  document.getElementById('editCoverInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target.result;
      preview.innerHTML = `<img src="${src}" alt=""><div class="edit-cover-overlay"><i class="fa-solid fa-camera"></i><span>Изменить</span></div>`;
      preview.onclick = () => document.getElementById('editCoverInput').click();
      track._pendingCover = src;
    };
    reader.readAsDataURL(file);
  };
  
  // Цвет карточки
  const colorPicker = document.getElementById('editTrackColor');
  const colorReset = document.getElementById('editTrackColorReset');
  if (colorPicker) {
    colorPicker.value = track.cardColor || '#ffffff';
    colorPicker.oninput = () => { track._pendingColor = colorPicker.value; };
  }
  if (colorReset) {
    colorReset.onclick = () => {
      track._pendingColor = null;
      if (colorPicker) colorPicker.value = '#ffffff';
    };
  }

  // EQ
  const eqGrid = document.getElementById('eqGrid');
  const eq = track.eq || Array(10).fill(0);
  eqGrid.innerHTML = EQ_BANDS.map((band, i) => `
    <div class="eq-band">
      <div class="eq-val" id="eqVal${i}">${eq[i] > 0 ? '+' : ''}${eq[i]}</div>
      <input type="range" class="eq-range" id="eqRange${i}" min="-12" max="12" step="1" value="${eq[i]}"
        oninput="document.getElementById('eqVal${i}').textContent=(this.value>0?'+':'')+this.value">
      <div class="eq-band-label">${band}</div>
    </div>
  `).join('');
  
  // Кнопка сброса
  document.getElementById('editResetBtn').onclick = () => {
    document.getElementById('editTrackName').value = track._origName || track.name;
    document.getElementById('editTrackArtist').value = track._origArtist || '';
    speedSlider.value = 1;
    speedVal.textContent = '1.00×';
    // Сброс цвета
    if (colorPicker) colorPicker.value = '#ffffff';
    track._pendingColor = null;
    EQ_BANDS.forEach((_, i) => {
      document.getElementById(`eqRange${i}`).value = 0;
      document.getElementById(`eqVal${i}`).textContent = '0';
    });
    if (track._origCover !== undefined) {
      track._pendingCover = track._origCover;
      if (track._origCover) {
        preview.innerHTML = `<img src="${track._origCover}" alt=""><div class="edit-cover-overlay"><i class="fa-solid fa-camera"></i><span>Изменить</span></div>`;
      } else {
        preview.innerHTML = `<i class="fa-solid fa-music"></i><div class="edit-cover-overlay"><i class="fa-solid fa-camera"></i><span>Загрузить GIF/изображение</span></div>`;
      }
    }
  };
  
  // Кнопка сохранения
  document.getElementById('editSaveBtn').onclick = () => saveEditTrack(trackIndex);
  
  // Сохранение при клике вне модалки
  const modal = document.getElementById('editTrackModal');
  modal._saveOnOutsideClick = true;
  modal._editIndex = trackIndex;
  
  openModalById('editTrackModal');
}

function saveEditTrack(trackIndex) {
  if (trackIndex === null || trackIndex >= tracks.length) return;
  const track = tracks[trackIndex];
  
  // Сохраняем оригиналы при первом редактировании
  if (track._origName === undefined) track._origName = track.name;
  if (track._origArtist === undefined) track._origArtist = track.artist || '';
  if (track._origCover === undefined) track._origCover = track.cover || null;
  
  track.name = document.getElementById('editTrackName').value.trim() || track.name;
  track.artist = document.getElementById('editTrackArtist').value.trim();
  track.speed = parseFloat(document.getElementById('editSpeedSlider').value);
  track.eq = EQ_BANDS.map((_, i) => parseInt(document.getElementById(`eqRange${i}`)?.value || 0));
  
  if (track._pendingCover !== undefined) {
    track.cover = track._pendingCover;
    delete track._pendingCover;
  }
  
  // Применяем цвет карточки
  if (track._pendingColor !== undefined) {
    track.cardColor = track._pendingColor || null;
    delete track._pendingColor;
  }
  
  // Применяем скорость если это текущий трек
  if (currentIndex === trackIndex) {
    audio.playbackRate = track.speed || 1;
    trackNameEl.textContent = track.name;
    trackArtistEl.textContent = track.artist || getFileTypeText(track.ext);
    updateNowPlayingCard();
  }
  
  closeModalById('editTrackModal');
  renderAll();
  saveData();
  showToast('Изменения сохранены');
}

// ===== НАСТРОЙКА АНИМАЦИЙ =====
function applyAnimationSetting() {
  const animToggle = document.getElementById('animationsToggle');
  const enabled = animToggle ? animToggle.classList.contains('on') : true;
  document.body.classList.toggle('no-animations', !enabled);
}

// Запуск
init();
