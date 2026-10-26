/* Единственное место, где версия приложения указана для интерфейса (заставка, «О программе», список изменений) */
export const APP_VERSION = '2.0.4'

/*
 * Канал сборки. 'release' — в интерфейсе просто номер версии. 'snapshot' дописывает к нему «Снапшот»
 * (в конфигах Tauri/Cargo версия всё равно чистая: установщик MSI не принимает суффиксы вроде -snapshot).
 * Пометка «Снапшот» у записи в списке изменений задаётся отдельно — полем channel в переводах.
 */
export type AppChannel = 'release' | 'snapshot'
export const APP_CHANNEL: AppChannel = 'release'

/** «2.0.4 Снапшот» — номер версии с подписью канала на языке интерфейса */
export function versionLabel(t: (key: string) => string, version = APP_VERSION, channel: AppChannel = APP_CHANNEL): string {
  return channel === 'release' ? version : `${version} ${t(`version.${channel}`)}`
}
