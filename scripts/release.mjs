#!/usr/bin/env node
/*
 * Сборка релиза с автообновлением (подробно — в autoupd.md):
 *   npm run release -- "Что нового"                     собрать, файлы окажутся в release/
 *   npm run release -- --publish "Что нового"           собрать и сразу выложить релиз на GitHub (нужен gh)
 *   npm run release -- --tag=26.10.2026 "Что нового"    свой тег вместо v<версия>
 *   npm run release -- --title="Snapshot 2.0.5" "…"     своё название релиза (в нём обязательно номер версии)
 *   npm run release -- --notes-file=notes.md            описание релиза из файла (markdown, можно с картинками)
 *
 * 1. Проверяет, что версия одинаковая во всех местах.
 * 2. Собирает установщик и портативный Playly.exe, подписывает оба ключом ~/.tauri/playly.key.
 * 3. Создаёт latest.json — по нему уже установленные копии Playly узнают о новой версии
 *    (установленная обновляется установщиком, портативная — подменой .exe).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repoSlug = 'Aurum2347/Playly'
const repo = `https://github.com/${repoSlug}`
const isWin = process.platform === 'win32'

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

/* ===== Аргументы ===== */
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const notesFile = option('--notes-file')
const notesArg = notesFile ? readFileSync(resolve(notesFile), 'utf8').trim() : args.filter((a) => !a.startsWith('--')).join(' ').trim()

/* ===== Версия: должна совпадать везде ===== */
const read = (...p) => readFileSync(join(root, ...p), 'utf8')
const version = JSON.parse(read('src-tauri', 'tauri.conf.json')).version
const versions = {
  'src-tauri/tauri.conf.json': version,
  'src-tauri/Cargo.toml': read('src-tauri', 'Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  'package.json': JSON.parse(read('package.json')).version,
  'src/lib/version.ts': read('src', 'lib', 'version.ts').match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1],
}
const mismatched = Object.entries(versions).filter(([, v]) => v !== version)
if (mismatched.length) {
  fail(
    `Версия не совпадает (в tauri.conf.json — ${version}):\n` +
      mismatched.map(([f, v]) => `    ${f}: ${v ?? 'не найдена'}`).join('\n') +
      '\n  Поменяйте её во всех четырёх файлах и запустите снова.'
  )
}
const channel = read('src', 'lib', 'version.ts').match(/APP_CHANNEL[^=]*=\s*'(\w+)'/)?.[1] ?? 'release'
const tag = option('--tag') ?? `v${version}`
/* В названии релиза обязательно есть номер версии: по нему копии без latest.json узнают версию */
const title = option('--title') ?? `${channel === 'snapshot' ? 'Snapshot' : 'Release'} ${version}`
if (!title.includes(version)) fail(`В названии релиза «${title}» нет номера версии ${version}`)
const notes = notesArg || `Playly ${version}`

/* ===== Ключ подписи ===== */
const env = { ...process.env }
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyPath = join(homedir(), '.tauri', 'playly.key')
  if (!existsSync(keyPath)) fail(`Не найден ключ подписи: ${keyPath}\n  Без него обновления не проверятся. См. autoupd.md`)
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, 'utf8')
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { cwd: root, env, stdio: 'inherit', shell: isWin })

/* ===== Сборка ===== */
console.log(`\n▶ Сборка Playly ${version} (${title}, тег ${tag})…\n`)
/* Доп. настройка сборки — файлом: JSON прямо в командной строке Windows портит кавычки */
const extraConf = join(tmpdir(), 'playly-release.conf.json')
writeFileSync(extraConf, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }))
const quote = (p) => (isWin ? `"${p}"` : p)
const build = run('npx', ['tauri', 'build', '--config', quote(extraConf)])
rmSync(extraConf, { force: true })
if (build.status !== 0) fail('Сборка не удалась — смотрите вывод выше')

const releaseDir = join(root, 'src-tauri', 'target', 'release')
const nsisDir = join(releaseDir, 'bundle', 'nsis')
const installer = readdirSync(nsisDir).find((f) => f.endsWith('-setup.exe') && f.includes(version))
if (!installer || !existsSync(join(nsisDir, `${installer}.sig`))) fail(`Не найден установщик или его подпись в ${nsisDir}`)

/* ===== Всё для релиза — в одну папку release/ ===== */
const out = join(root, 'release')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)
copyFileSync(join(nsisDir, installer), join(out, installer))
const portable = 'Playly.exe'
copyFileSync(join(releaseDir, 'app.exe'), join(out, portable))

console.log('\n▶ Подпись портативной версии…\n')
const sign = run('npx', ['tauri', 'signer', 'sign', quote(join(out, portable))])
if (sign.status !== 0 || !existsSync(join(out, `${portable}.sig`))) fail('Не удалось подписать Playly.exe')

const download = (file) => `${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`
/* В приложении «Что нового» показывается простым текстом — картинки и HTML из описания туда не берём */
const appNotes = notes
  .split('\n')
  .filter((l) => !/^\s*(!\[|<img|<video)/i.test(l))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
const latest = {
  version,
  notes: appNotes,
  pub_date: new Date().toISOString(),
  platforms: {
    /* Установленная версия */
    'windows-x86_64': {
      signature: readFileSync(join(nsisDir, `${installer}.sig`), 'utf8').trim(),
      url: download(installer),
    },
    /* Портативный Playly.exe (см. portable_* в src-tauri/src/main.rs) */
    'windows-x86_64-portable': {
      signature: readFileSync(join(out, `${portable}.sig`), 'utf8').trim(),
      url: download(portable),
    },
  },
}
writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2))
rmSync(join(out, `${portable}.sig`))

const files = [installer, portable, 'latest.json']

/* ===== Публикация ===== */
if (flag('--publish')) {
  console.log(`\n▶ Публикация релиза ${title} на GitHub…\n`)
  /* Описание — файлом: в нём бывают переносы строк и картинки, командная строка такое портит */
  const notesPath = join(out, 'release-notes.md')
  writeFileSync(notesPath, notes)
  const gh = spawnSync(
    'gh',
    ['release', 'create', tag, ...files.map((f) => join(out, f)), '--repo', repoSlug, '--title', title, '--notes-file', notesPath, '--latest'],
    { cwd: root, stdio: 'inherit' }
  )
  if (gh.status !== 0) fail('gh не смог создать релиз. Файлы лежат в release/ — можно выложить их вручную (см. autoupd.md)')
  console.log(`\n✔ Релиз опубликован: ${repo}/releases/tag/${encodeURIComponent(tag)}\n`)
} else {
  console.log(`\n✔ Готово. Файлы в ${out}:
    ${files.join('\n    ')}

  Выложите релиз на ${repo}/releases/new:
    • тег:       ${tag}
    • название:  ${title}
    • файлы:     все три из папки release/ (имена не меняйте)
  или запустите то же самое с --publish, и скрипт сделает это сам.\n`)
}
