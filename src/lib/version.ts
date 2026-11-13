/* Единственное место, где версия приложения указана для интерфейса (заставка, «О программе», список изменений).
 * Должна совпадать с package.json - это проверяет npm test. */
export const APP_VERSION = '2.0.7'

/** Номер версии для интерфейса */
export function versionLabel(version = APP_VERSION): string {
  return version
}

/* «Посмотреть изменения» после обновления: страница «О программе» откроется сразу на списке изменений */
let changelogRequested = false
export function requestChangelog() {
  changelogRequested = true
}
export function consumeChangelogRequest(): boolean {
  const requested = changelogRequested
  changelogRequested = false
  return requested
}
