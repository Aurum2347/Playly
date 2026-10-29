#!/usr/bin/env node
/*
 * Сборка Playly под Linux в Docker — с любой ОС, где есть Docker:
 *   npm run build:linux
 * Готовые .AppImage, .deb и .rpm появятся в папке release-linux/.
 *
 * В контейнер попадают файлы рабочей копии (в том числе ещё не закоммиченные), кроме игнорируемых git.
 * Кеши npm, cargo и папка target лежат в томах Docker (playly-*) — повторная сборка идёт в разы быстрее.
 * Это сборка для проверки: без подписи обновлений. Подписанный релиз — npm run release на Linux.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const image = 'playly-linux-build'
const out = join(root, 'release-linux')

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}
const docker = (args) => spawnSync('docker', args, { cwd: root, stdio: 'inherit' })

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) fail('Docker не запущен')

console.log('\n▶ Образ для сборки…\n')
if (docker(['build', '-t', image, join(root, 'scripts', 'linux')]).status !== 0) fail('Не удалось собрать образ')

rmSync(out, { recursive: true, force: true })
mkdirSync(out)

/* Внутри контейнера: копируем исходники (без node_modules и прочего из .gitignore), собираем, выкладываем пакеты */
const script = [
  'set -e',
  'git config --global --add safe.directory /repo',
  'cd /repo && git ls-files -z --cached --others --exclude-standard | tar --null -cf - -T - | tar -xf - -C /build',
  'cd /build && npm ci --no-audit --no-fund',
  'npx tauri build',
  'B=/build/src-tauri/target/release/bundle',
  'cp $B/appimage/*.AppImage $B/deb/*.deb $B/rpm/*.rpm /out/',
  'chmod +x /out/*.AppImage',
  'ls -la /out',
].join(' && ')

console.log('\n▶ Сборка Playly в контейнере…\n')
const run = docker([
  'run', '--rm',
  '-v', `${root}:/repo:ro`,
  '-v', `${out}:/out`,
  '-v', 'playly-npm:/root/.npm',
  '-v', 'playly-cargo:/root/.cargo/registry',
  '-v', 'playly-target:/build/src-tauri/target',
  image, 'bash', '-c', script,
])
if (run.status !== 0) fail('Сборка не удалась — смотрите вывод выше')
console.log(`\n✔ Готово: ${out}\n`)
