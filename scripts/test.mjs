import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function moduleAt(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    .replace(/^import .*from '@tauri-apps\/api\/core'\r?\n/gm, 'const invoke = async () => null;\n')
    .replace(/^import .*from '@tauri-apps\/api\/webview'\r?\n/gm, 'const getCurrentWebview = () => ({ setZoom: async () => {} });\n')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

const eq = await moduleAt('src/lib/equalizer.ts')
assert.equal(eq.EQ_BANDS.length, 15)
assert.ok(eq.BUILTIN_EQ_PRESETS.every((p) => p.gains.length === 15 && p.gains.every(Number.isFinite)))
assert.deepEqual(eq.normalizeGains(Array(10).fill(3)), Array(15).fill(3))
assert.equal(eq.normalizeGains([100, NaN, ...Array(13).fill(-100)])[0], 12)
assert.ok(eq.normalizeGains([100, NaN, ...Array(13).fill(-100)]).every(Number.isFinite))
assert.equal(eq.normalizeGains([1,2,3,4,5,6,7,8,9,10])[5], 4)
assert.ok(!eq.eqCurvePaths(Array(15).fill(0), 600, 100).line.includes('NaN'))

const lyrics = await moduleAt('src/lib/lyrics.ts')
assert.deepEqual(lyrics.parseLyrics('[00:02.00]later\n[00:01.00]first\n[offset:500]'), { synced: true, lines: [{ time: .5, text: 'first' }, { time: 1.5, text: 'later' }] })
assert.equal(lyrics.parseLyrics('[00:01.20]one line').synced, true)
assert.equal(lyrics.parseLyrics('plain text').synced, false)
assert.equal(lyrics.parseLyrics(''), null)
assert.equal(lyrics.activeLineIndex([{ time: 1 }, { time: 3 }], 2), 0)

const scale = await moduleAt('src/lib/uiScale.ts')
assert.equal(scale.clampUiScale(0), 25)
assert.equal(scale.clampUiScale(999), 400)
assert.equal(scale.clampUiScale(NaN), 100)
assert.equal(scale.clampUiScale(102), 100)

const icon = await moduleAt('src/lib/appIcon.ts')
assert.deepEqual(icon.normalizeIcon(null), icon.DEFAULT_ICON)
assert.deepEqual(icon.normalizeIcon({ background: '#ABCDEF', foreground: 'red', round: 'yes' }), { background: '#abcdef', foreground: icon.DEFAULT_ICON.foreground, round: false })
assert.ok(icon.sameIcon({ background: '#FFFFFF', foreground: '#000000', round: true }, { background: '#ffffff', foreground: '#000000', round: true }))
assert.ok(icon.ICON_PRESETS.every(([bg, fg]) => /^#[\da-f]{6}$/.test(bg) && /^#[\da-f]{6}$/.test(fg)))

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)))
assert.equal(pkg.version, '2.0.6')
assert.equal(conf.version, pkg.version)
assert.match(readFileSync(new URL('../src/lib/version.ts', import.meta.url), 'utf8'), /APP_VERSION = '2\.0\.6'/)
const updaterSource = readFileSync(new URL('../src/lib/updater.ts', import.meta.url), 'utf8')
for (const enabled of [false, true]) {
  const fixture = { settings: { checkUpdatesOnStartup: enabled, autoUpdate: false }, timers: [], intervals: [], checks: 0 }
  globalThis.__updaterTest = fixture
  const source = `
    const fixture = globalThis.__updaterTest;
    const useSyncExternalStore = (_, read) => read();
    const invoke = async () => false;
    const check = async () => { fixture.checks++; return null; };
    const readSettingsRaw = async () => fixture.settings;
    const writeSettingsRaw = async (patch) => Object.assign(fixture.settings, patch);
    const APP_VERSION = '2.0.6';
    const setTimeout = (fn, ms) => fixture.timers.push({ fn, ms });
    const setInterval = (fn, ms) => fixture.intervals.push({ fn, ms });
    const fetch = async () => ({ ok: true, json: async () => ({ name: '2.0.6', tag_name: 'v2.0.6', html_url: 'https://example.test' }) });
  ` + updaterSource.replace(/^import .*\r?\n/gm, '')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const updater = await import(`data:text/javascript;base64,${Buffer.from(compiled + `\n// startup ${enabled}`).toString('base64')}`)
  await updater.startUpdater()
  await updater.startUpdater()
  assert.equal(fixture.timers.length, 1)
  assert.equal(fixture.timers[0].ms, 15000)
  fixture.timers[0].fn()
  await new Promise(setImmediate)
  assert.equal(fixture.checks, enabled ? 1 : 0)
  assert.equal(fixture.intervals[0].ms, 6 * 60 * 60 * 1000)
  await updater.setCheckOnStartup(!enabled)
  assert.equal(fixture.settings.checkUpdatesOnStartup, !enabled)
  assert.equal(updater.useUpdater().checkOnStartup, !enabled)
  await updater.checkForUpdates()
  assert.equal(fixture.checks, enabled ? 2 : 1)
}
delete globalThis.__updaterTest
console.log('Regression checks passed: equalizer, lyrics, scaling, app icon, versions, startup update preference.')
