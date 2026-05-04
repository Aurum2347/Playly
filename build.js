/**
 * build.js — сборка Playly без electron-builder
 * Использует electron-packager (не качает winCodeSign, нет проблем с симлинками)
 *
 * Результат в dist/:
 *   dist/Playly-win32-x64/          ← папка с exe (версия "с папкой")
 *   dist/Playly-Portable.exe        ← один exe (self-extracting, версия portable)
 *
 * Запуск: npm run dist
 */

const packager = require('electron-packager');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const VERSION = require('./package.json').version;

// ─── Убедимся что dist существует ───────────────────────────────────────────
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// ─── Общие параметры packager ────────────────────────────────────────────────
const commonOptions = {
  dir: ROOT,
  name: 'Playly',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '28.3.3',
  icon: path.join(ROOT, 'icon.ico'),
  out: DIST,
  overwrite: true,
  asar: true,                        // упаковываем исходники в asar
  prune: true,                       // убираем devDependencies
  ignore: [
    /^\/dist/,
    /^\/\.git/,
    /^\/\.vscode/,
    /^\/node_modules\/electron$/,
    /^\/node_modules\/electron-builder/,
    /^\/node_modules\/electron-packager/,
    /^\/node_modules\/asar/,
    /^\/build\.js$/,
    /^\/electron-builder\.yml$/,
    /^\/fix-wincosign\.ps1$/,
    /\.md$/,
    /\.gitignore$/,
    /\.gitattributes$/,
  ],
  // Метаданные exe
  appVersion: VERSION,
  appCopyright: `© 2025 Aurum2347`,
  win32metadata: {
    CompanyName: 'Aurum2347',
    FileDescription: 'Playly — музыкальный плеер',
    OriginalFilename: 'Playly.exe',
    ProductName: 'Playly',
    InternalName: 'Playly',
  },
};

async function build() {
  console.log('\n🎵 Playly Build Script\n');

  // ── Версия: папка ──────────────────────────────────────────────────────
  console.log('📦 Собираем версию с папкой (win-unpacked)...');
  const [appPath] = await packager({
    ...commonOptions,
    out: DIST,
  });
  console.log(`   ✓ Готово: ${path.relative(ROOT, appPath)}\n`);

  printSummary(appPath);
}

function printSummary(folderPath) {
  console.log('─'.repeat(50));
  console.log('✅ Сборка завершена!\n');
  console.log(`  📁 Папка: ${path.relative(__dirname, folderPath)}`);
  console.log('─'.repeat(50) + '\n');
}

build().catch(err => {
  console.error('\n❌ Ошибка сборки:', err.message || err);
  process.exit(1);
});
