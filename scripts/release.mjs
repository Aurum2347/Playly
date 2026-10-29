#!/usr/bin/env node
/*
 * Сборка релиза с автообновлением (подробно — в autoupd.md):
 *   npm run release -- "Что нового"                     собрать, файлы окажутся в release/
 *   npm run release -- --publish "Что нового"           собрать и сразу выложить релиз на GitHub (нужен gh)
 *   npm run release -- --tag=26.10.2026 "Что нового"    свой тег вместо v<версия>
 *   npm run release -- --title="Snapshot 2.0.5" "…"     своё название релиза (в нём обязательно номер версии)
 *   npm run release -- --notes-file=notes.md            описание релиза из файла (markdown, можно с картинками)
 *   npm run release -- --merge-latest=win/latest.json   дописать в latest.json платформы из сборки под другую ОС
 *   npm run release -- --upload …                       доложить файлы в уже опубликованный релиз (нужен gh)
 *
 * 1. Проверяет, что версия одинаковая во всех местах.
 * 2. Собирает и подписывает ключом ~/.tauri/playly.key:
 *    Windows — установщик и портативный Playly.exe; Linux — AppImage (+ .deb и .rpm для ручной установки).
 * 3. Создаёт latest.json — по нему уже установленные копии Playly узнают о новой версии
 *    (установленная обновляется установщиком, портативная — подменой .exe, на Linux — AppImage).
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

if (!isWin && process.platform !== 'linux') fail('Релиз собирается на Windows или Linux')

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
const bundleDir = join(releaseDir, 'bundle')
const findIn = (dir, test) => (existsSync(dir) ? readdirSync(dir).find(test) : undefined)

/* ===== Всё для релиза — в одну папку release/ ===== */
const out = join(root, 'release')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)

const download = (file) => `${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`
/* Файлы релиза и записи latest.json — у каждой платформы свои */
const files = []
let platforms = {}

if (isWin) {
  const nsisDir = join(bundleDir, 'nsis')
  const installer = findIn(nsisDir, (f) => f.endsWith('-setup.exe') && f.includes(version))
  if (!installer || !existsSync(join(nsisDir, `${installer}.sig`))) fail(`Не найден установщик или его подпись в ${nsisDir}`)
  copyFileSync(join(nsisDir, installer), join(out, installer))
  const portable = 'Playly.exe'
  copyFileSync(join(releaseDir, 'app.exe'), join(out, portable))

  console.log('\n▶ Подпись портативной версии…\n')
  const sign = run('npx', ['tauri', 'signer', 'sign', quote(join(out, portable))])
  if (sign.status !== 0 || !existsSync(join(out, `${portable}.sig`))) fail('Не удалось подписать Playly.exe')

  platforms = {
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
  }
  rmSync(join(out, `${portable}.sig`))
  files.push(installer, portable)
} else {
  /* Linux: автообновление умеет только AppImage, а .deb и .rpm кладутся в релиз для ручной установки */
  const appimageDir = join(bundleDir, 'appimage')
  const appimage = findIn(appimageDir, (f) => f.endsWith('.AppImage') && f.includes(version))
  if (!appimage || !existsSync(join(appimageDir, `${appimage}.sig`))) fail(`Не найден AppImage или его подпись в ${appimageDir}`)
  copyFileSync(join(appimageDir, appimage), join(out, appimage))
  files.push(appimage)
  for (const [dir, ext] of [['deb', '.deb'], ['rpm', '.rpm']]) {
    const pkg = findIn(join(bundleDir, dir), (f) => f.endsWith(ext) && f.includes(version))
    if (!pkg) continue
    copyFileSync(join(bundleDir, dir, pkg), join(out, pkg))
    files.push(pkg)
  }
  platforms = {
    'linux-x86_64': {
      signature: readFileSync(join(appimageDir, `${appimage}.sig`), 'utf8').trim(),
      url: download(appimage),
    },
  }
}

/*
 * Windows и Linux собираются на разных машинах, а latest.json у релиза один.
 * --merge-latest=<путь> добавляет платформы из latest.json другой сборки той же версии.
 */
const mergeLatest = option('--merge-latest')
if (mergeLatest) {
  const other = JSON.parse(readFileSync(resolve(mergeLatest), 'utf8'))
  if (other.version !== version) fail(`В ${mergeLatest} версия ${other.version}, а собирается ${version}`)
  platforms = { ...other.platforms, ...platforms }
}

/* В приложении «Что нового» показывается простым текстом — картинки и HTML из описания туда не берём */
const appNotes = notes
  .split('\n')
  .filter((l) => !/^\s*(!\[|<img|<video)/i.test(l))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
const latest = { version, notes: appNotes, pub_date: new Date().toISOString(), platforms }
writeFileSync(join(out, 'latest.json'), JSON.stringify(latest, null, 2))
files.push('latest.json')

/* ===== Публикация ===== */
if (flag('--upload')) {
  /* Релиз уже есть (например, выложен с Windows) — докладываем файлы этой платформы и общий latest.json */
  console.log(`\n▶ Загрузка файлов в релиз ${tag}…\n`)
  const gh = spawnSync('gh', ['release', 'upload', tag, ...files.map((f) => join(out, f)), '--repo', repoSlug, '--clobber'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (gh.status !== 0) fail('gh не смог загрузить файлы. Они лежат в release/ — можно приложить их вручную')
  console.log(`\n✔ Файлы загружены: ${repo}/releases/tag/${encodeURIComponent(tag)}\n`)
} else if (flag('--publish')) {
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
    • файлы:     все из папки release/ (имена не меняйте)
  или запустите то же самое с --publish, и скрипт сделает это сам.
  Сборку под вторую ОС добавьте в тот же релиз: --merge-latest=<latest.json первой сборки> --upload\n`)
}
