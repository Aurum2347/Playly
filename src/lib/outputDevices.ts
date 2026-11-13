/*
 * Устройства вывода звука для режима стримера.
 *
 * Как Playly прячет свой звук от трансляции. Windows не даёт программе пометить свой звук как
 * «не записывать»: OBS («Звук с рабочего стола») и Discord слушают устройство вывода целиком,
 * со всеми программами на нём. Поэтому скрыть можно только так: Playly играет на другом устройстве,
 * а трансляция слушает системное. Это может быть второй выход тех же наушников (у многих гарнитур
 * есть отдельные «Game» и «Chat» или «Наушники» и «Головной телефон»), наушники при колонках
 * по умолчанию, отдельная звуковая карта или виртуальный кабель.
 */
import { useEffect, useState } from 'react'

export interface OutputDevice {
  id: string
  label: string
  groupId: string
}

export interface OutputInfo {
  /* Реальные устройства (без псевдоустройств Windows «default» и «communications») */
  devices: OutputDevice[]
  /* Системное устройство по умолчанию: его и слушают программы трансляции. null - не удалось понять */
  systemId: string | null
  systemLabel: string
  /* Windows раскрывает названия устройств только после разрешения на доступ к звуку */
  labelsHidden: boolean
}

const EMPTY: OutputInfo = { devices: [], systemId: null, systemLabel: '', labelsHidden: false }

/** «По умолчанию - Динамики (Realtek)» → «Динамики (Realtek)» */
function stripDefault(label: string): string {
  const s = label.replace(/\s*\(Default\)\s*$/i, '')
  const m = s.match(/^(?:По умолчанию|Default|Standard|Par défaut|Predeterminado)\s*-\s*(.+)$/i)
  return (m ? m[1] : s).trim()
}

export async function readOutputs(): Promise<OutputInfo> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return EMPTY
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    const devices = outputs
      .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .filter((d, i, all) => all.findIndex((a) => a.deviceId === d.deviceId) === i)
      .map((d) => ({ id: d.deviceId, label: d.label, groupId: d.groupId }))
    const pseudo = outputs.find((d) => d.deviceId === 'default')
    let systemId: string | null = null
    let systemLabel = ''
    if (pseudo) {
      systemLabel = stripDefault(pseudo.label)
      /* По названию надёжнее: у гарнитуры с двумя выходами groupId общий */
      const byLabel = systemLabel ? devices.filter((d) => d.label === systemLabel) : []
      const byGroup = devices.filter((d) => pseudo.groupId && d.groupId === pseudo.groupId)
      const match = byLabel.length === 1 ? byLabel[0] : byGroup.length === 1 ? byGroup[0] : null
      systemId = match?.id ?? null
      if (match && !systemLabel) systemLabel = match.label
    }
    return { devices, systemId, systemLabel, labelsHidden: devices.length > 0 && devices.every((d) => !d.label) }
  } catch {
    return EMPTY
  }
}

/** Список устройств с обновлением при подключении и отключении */
export function useOutputs(refresh = 0): OutputInfo {
  const [info, setInfo] = useState<OutputInfo>(EMPTY)
  useEffect(() => {
    let alive = true
    const load = () => void readOutputs().then((i) => alive && setInfo(i))
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', load)
    }
  }, [refresh])
  return info
}

/** Разрешение на названия устройств: поток сразу закрывается, ничего не записывается */
export async function requestDeviceLabels(): Promise<'ok' | 'denied' | 'failed'> {
  let stream: MediaStream | undefined
  try {
    if (!navigator.mediaDevices?.getUserMedia) return 'failed'
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    return 'ok'
  } catch (error) {
    return error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'failed'
  } finally {
    stream?.getTracks().forEach((track) => track.stop())
  }
}

/* Устройства, на которых обычно слушают сами: наушники и второй выход гарнитуры */
const PERSONAL = /наушник|головн|headphone|headset|earphone|earbud|buds|airpods|chat|чат|hands-free/i

/** Устройства, на которых трансляция Playly не услышит (всё, кроме системного) */
export function privateChoices(info: OutputInfo): OutputDevice[] {
  return info.devices.filter((d) => d.id !== info.systemId)
}

/** Подобрать устройство для скрытого звука; null - подходящего нет */
export function pickPrivateDevice(info: OutputInfo, current = ''): string | null {
  const choices = privateChoices(info)
  if (current && choices.some((d) => d.id === current)) return current
  /* Пока не известно, какое устройство системное, выбирать наугад нельзя */
  if (info.systemId === null) return null
  return (choices.find((d) => PERSONAL.test(d.label)) ?? choices[0])?.id ?? null
}

/** Короткий звук на выбранном устройстве: проверить, что вы его слышите, а индикатор в OBS молчит */
export async function playTestTone(deviceId: string): Promise<boolean> {
  try {
    const ctx = new AudioContext() as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (deviceId && ctx.setSinkId) await ctx.setSinkId(deviceId)
    const now = ctx.currentTime + 0.05
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0, now)
    ;[660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(now + i * 0.16)
      osc.stop(now + i * 0.16 + 0.15)
    })
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02)
    gain.gain.setValueAtTime(0.18, now + 0.44)
    gain.gain.linearRampToValueAtTime(0, now + 0.5)
    window.setTimeout(() => void ctx.close(), 900)
    return true
  } catch {
    return false
  }
}
