/*
 * Автопауза при потере аудиоустройства: наушники или выбранная колонка отключились —
 * музыка не должна внезапно пойти через другое устройство. После повторного подключения
 * сама она не включается: только звук снова направляется на вернувшееся устройство.
 */

interface Snapshot {
  /* Реальные устройства вывода (без псевдоустройств Windows «default» и «communications») */
  ids: Set<string>
  groups: Set<string>
  /* Группа (физическое устройство) системного вывода «по умолчанию» */
  defaultGroup: string
  defaultLabel: string
  /* Сколько всего выходов видно — запасной признак, когда браузер не раскрывает id */
  count: number
}

async function snapshot(): Promise<Snapshot | null> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    const real = outputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    const def = outputs.find((d) => d.deviceId === 'default') ?? outputs[0]
    return {
      ids: new Set(real.map((d) => d.deviceId)),
      groups: new Set(real.map((d) => d.groupId).filter(Boolean)),
      defaultGroup: def?.groupId ?? '',
      defaultLabel: def?.label ?? '',
      count: outputs.length,
    }
  } catch {
    return null
  }
}

export interface DeviceWatchHandlers {
  /* Какое устройство сейчас играет: '' — системное по умолчанию */
  device: () => string
  /* Устройство пропало во время воспроизведения */
  onLost: () => void
  /* Выбранное устройство снова подключено — направить звук обратно (без запуска музыки) */
  onBack: (deviceId: string) => void
}

/** Следит за подключением устройств; возвращает функцию отписки */
export function watchOutputDevices(h: DeviceWatchHandlers): () => void {
  const media = navigator.mediaDevices
  if (!media?.addEventListener) return () => {}
  let prev: Snapshot | null = null
  let alive = true
  let seq = 0

  void snapshot().then((s) => {
    if (alive && !prev) prev = s
  })

  const onChange = async () => {
    const my = ++seq
    const next = await snapshot()
    if (!alive || my !== seq || !next) return
    const before = prev
    prev = next
    if (!before) return
    const device = h.device()
    if (device) {
      if (before.ids.has(device) && !next.ids.has(device)) h.onLost()
      else if (!before.ids.has(device) && next.ids.has(device)) h.onBack(device)
      return
    }
    /*
     * Системный вывод по умолчанию. Если он переключился потому, что прежнее устройство исчезло
     * (выдернули наушники) — это потеря. Если пользователь сам сменил устройство в системе,
     * прежнее никуда не делось — тогда не мешаем.
     */
    const switched = before.defaultGroup !== next.defaultGroup || before.defaultLabel !== next.defaultLabel
    const goneGroup = before.defaultGroup !== '' && before.groups.size > 0 && !next.groups.has(before.defaultGroup)
    const idsHidden = before.ids.size === 0 && next.ids.size === 0
    if ((switched && goneGroup) || (idsHidden && next.count < before.count)) h.onLost()
  }

  media.addEventListener('devicechange', onChange)
  return () => {
    alive = false
    media.removeEventListener('devicechange', onChange)
  }
}
