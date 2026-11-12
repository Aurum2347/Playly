import { invoke } from '@tauri-apps/api/core'
import { readFile, remove } from '@tauri-apps/plugin-fs'
import { EQ_BANDS } from './equalizer'

/*
 * Аудиодвижок Playly: две «деки» (HTMLAudioElement → GainNode) поверх одного AudioContext.
 *
 *   deck A ─┐                                ┌─► dry ──────────────┐
 *           ├─► fader (плавная пауза) ─► эквалайзер                 ├─► analyser (визуализатор) ─► master (громкость) ─► выход
 *   deck B ─┘                                └─► компрессор ─► wet ┘   (нормализация громкости)
 *
 * Любая смена трека загружает файл в свободную деку и сводит деки кривой громкости.
 * Кроссфейд — это та же смена трека, только с длинной кривой. Кривые считаются
 * на аудиопотоке (AudioParam), поэтому не зависят от таймеров и троттлинга окна,
 * а при паузе (ctx.suspend) замирают вместе со звуком и продолжаются после неё.
 */

export type CrossfadeCurve = 'equal' | 'linear' | 'smooth'

/**
 * Итог смены трека:
 *  ok    — трек играет (или стоит на паузе, если autoplay выключен);
 *  stale — загрузку перебила более новая, ничего не изменилось;
 *  error — файл не прочитался или не воспроизводится, играет то же, что и до вызова.
 */
export type LoadResult = 'ok' | 'stale' | 'error'

export interface EngineTrack {
  id: number
  filePath: string
  playbackRate?: number
}

export interface EngineEvents {
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
  /** Активная дека доиграла до конца сама (без перехода) */
  onEnded: () => void
  onError?: (trackId: number) => void
}

interface Deck {
  el: HTMLAudioElement
  gain: GainNode
  url: string | null
  trackId: number | null
  /* Растёт при каждой новой загрузке — устаревшие загрузки по нему отбрасываются */
  token: number
  pending: Promise<boolean> | null
}

interface Transition {
  outIdx: number
  endAt: number
  timer: ReturnType<typeof setTimeout> | null
}

/* Плавная пауза/старт, сек */
const PAUSE_FADE = 0.14
/* Минимальное сведение при мгновенной смене трека — убирает щелчки */
const DECLICK = 0.05
/* Быстрое глушение уходящей деки при прерывании перехода */
const ABORT_FADE = 0.08
const CURVE_STEPS = 48
/* Переключение нормализации без щелчка */
const NORMALIZE_FADE = 0.12

export function audioMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'flac': return 'audio/flac'
    case 'ogg':
    case 'opus': return 'audio/ogg'
    case 'm4a':
    case 'aac': return 'audio/mp4'
    case 'wma': return 'audio/x-ms-wma'
    case 'aif':
    case 'aiff': return 'audio/aiff'
    case 'weba': return 'audio/webm'
    case 'oga': return 'audio/ogg'
    /* У видео играет только звуковая дорожка */
    case 'mp4':
    case 'm4v': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    default: return 'application/octet-stream'
  }
}

/** Громкость входящей деки в точке p ∈ [0..1]; уходящая получает shape(1 - p) */
function shape(curve: CrossfadeCurve, p: number): number {
  const x = Math.max(0, Math.min(1, p))
  switch (curve) {
    case 'linear': return x
    case 'smooth': return x * x * (3 - 2 * x)
    /* Равная мощность: sin² + cos² = 1, поэтому громкость не проседает посередине */
    default: return Math.sin((x * Math.PI) / 2)
  }
}

/* Файл, у которого движок так и не нашёл ни метаданных, ни ошибки, считаем нечитаемым */
const READY_TIMEOUT = 15_000

function waitReady(el: HTMLAudioElement): Promise<boolean> {
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      el.removeEventListener('loadedmetadata', onOk)
      el.removeEventListener('error', onErr)
      resolve(ok)
    }
    const onOk = () => done(true)
    const onErr = () => done(false)
    const timer = setTimeout(() => done(false), READY_TIMEOUT)
    el.addEventListener('loadedmetadata', onOk)
    el.addEventListener('error', onErr)
  })
}

export class AudioEngine {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  curve: CrossfadeCurve = 'equal'

  private master: GainNode
  private fader: GainNode
  /* Предусилитель эквалайзера: снижает уровень на величину подъёма, чтобы не было перегруза */
  private eqPre: GainNode
  private eqBands: BiquadFilterNode[]
  /* Нормализация: сигнал идёт либо напрямую (dry), либо через компрессор (wet) */
  private normDry: GainNode
  private normWet: GainNode
  private decks: Deck[] = []
  private active = 0
  private transition: Transition | null = null
  private loadSeq = 0
  /* Запускать ли трек, который сейчас грузится: пауза во время загрузки отменяет автозапуск */
  private wantPlay = false
  /* Идёт смена трека (файл читается) */
  private switching = false
  private playing = false
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private events: EngineEvents
  private cleanups: Array<() => void> = []

  constructor(events: EngineEvents) {
    this.events = events
    this.ctx = new AudioContext({ latencyHint: 'playback' })
    this.master = this.ctx.createGain()
    this.fader = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.78
    this.eqPre = this.ctx.createGain()
    this.eqBands = EQ_BANDS.map((freq, i) => {
      const band = this.ctx.createBiquadFilter()
      band.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
      band.frequency.value = freq
      band.Q.value = 1.1
      band.gain.value = 0
      return band
    })
    /* Мягкий компрессор выравнивает громкие и тихие треки; недостающий уровень он добирает сам (make-up gain) */
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 20
    comp.ratio.value = 2.5
    comp.attack.value = 0.01
    comp.release.value = 0.3
    this.normDry = this.ctx.createGain()
    this.normWet = this.ctx.createGain()
    this.normWet.gain.value = 0

    this.fader.connect(this.eqPre)
    let node: AudioNode = this.eqPre
    for (const band of this.eqBands) {
      node.connect(band)
      node = band
    }
    node.connect(this.normDry)
    node.connect(comp)
    comp.connect(this.normWet)
    this.normDry.connect(this.analyser)
    this.normWet.connect(this.analyser)
    this.analyser.connect(this.master)
    this.master.connect(this.ctx.destination)

    for (let i = 0; i < 2; i++) {
      const el = new Audio()
      el.preload = 'auto'
      const gain = this.ctx.createGain()
      gain.gain.value = i === 0 ? 1 : 0
      this.ctx.createMediaElementSource(el).connect(gain)
      gain.connect(this.fader)
      this.decks.push({ el, gain, url: null, trackId: null, token: 0, pending: null })
      this.bindDeck(i)
    }
  }

  /* ===== Состояние ===== */

  get isPlaying() { return this.playing }
  get isTransitioning() { return this.transition !== null }
  get hasSource() { return this.decks[this.active].url !== null }
  get currentTrackId() { return this.decks[this.active].trackId }
  get currentTime() { return this.decks[this.active].el.currentTime || 0 }

  get duration() {
    const d = this.decks[this.active].el.duration
    return isFinite(d) ? d : 0
  }

  /** Сколько реальных секунд осталось до конца трека (с учётом скорости) */
  remaining(): number {
    const el = this.decks[this.active].el
    if (!isFinite(el.duration) || el.duration <= 0) return Infinity
    return (el.duration - el.currentTime) / (el.playbackRate || 1)
  }

  /* ===== Настройки ===== */

  setVolume(volume: number, muted: boolean) {
    const v = muted ? 0 : Math.max(0, Math.min(1, volume))
    const p = this.master.gain
    p.cancelScheduledValues(0)
    p.setTargetAtTime(v, this.ctx.currentTime, 0.015)
  }

  async setOutputDevice(deviceId: string) {
    /* Звук идёт через AudioContext, поэтому устройство меняется у контекста, а не у <audio> */
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (typeof ctx.setSinkId === 'function') {
      await ctx.setSinkId(deviceId === 'default' ? '' : deviceId)
    } else if (deviceId && deviceId !== 'default') {
      throw new Error('Эта версия WebView2 не поддерживает выбор устройства. Обнови Microsoft Edge WebView2 Runtime.')
    }
  }

  /** Усиление полос в дБ; null — эквалайзер выключен (все полосы в ноль) */
  setEq(gains: number[] | null) {
    const now = this.ctx.currentTime
    const g = this.eqBands.map((_, i) => (gains ? gains[i] ?? 0 : 0))
    this.eqBands.forEach((band, i) => {
      band.gain.cancelScheduledValues(0)
      band.gain.setTargetAtTime(g[i], now, 0.04)
    })
    const boost = Math.max(0, ...g)
    this.eqPre.gain.cancelScheduledValues(0)
    this.eqPre.gain.setTargetAtTime(Math.pow(10, (-boost * 0.75) / 20), now, 0.04)
  }

  /** Нормализация громкости: включает компрессор вместо прямого сигнала */
  setNormalize(on: boolean) {
    this.rampTo(this.normDry.gain, on ? 0 : 1, NORMALIZE_FADE)
    this.rampTo(this.normWet.gain, on ? 1 : 0, NORMALIZE_FADE)
  }

  setRate(trackId: number, rate: number) {
    for (const d of this.decks) {
      if (d.trackId === trackId) {
        d.el.defaultPlaybackRate = rate
        d.el.playbackRate = rate
      }
    }
  }

  /* ===== Загрузка и смена трека ===== */

  /**
   * Заранее кладёт трек в свободную деку, чтобы кроссфейд начался ровно вовремя,
   * а не после чтения файла.
   */
  preload(track: EngineTrack) {
    if (this.transition) return
    const idle = this.decks[1 - this.active]
    if (idle.trackId === track.id && idle.pending) return
    /* Свободная дека ещё доигрывает затухание прерванного перехода — не обрываем, попробуем позже */
    if (!idle.el.paused) return
    void this.prepare(1 - this.active, track)
  }

  /**
   * Переключает на трек. fade — длительность сведения в секундах
   * (0 — мгновенно, но всё равно без щелчка).
   */
  async load(track: EngineTrack, opts: { autoplay: boolean; fade: number }): Promise<LoadResult> {
    const seq = ++this.loadSeq
    this.wantPlay = opts.autoplay
    /* Пока новый трек грузится, позиция старого в интерфейс не уходит: иначе под новым названием бежит чужое время */
    this.switching = true
    try {
      return await this.switchTo(seq, track, opts)
    } finally {
      if (seq === this.loadSeq) this.switching = false
    }
  }

  private async switchTo(seq: number, track: EngineTrack, opts: { autoplay: boolean; fade: number }): Promise<LoadResult> {
    this.finishTransition(true)
    const target = 1 - this.active
    const ok = await this.prepare(target, track)
    if (seq !== this.loadSeq) return 'stale'
    if (!ok) return 'error'

    const from = this.active
    const fromDeck = this.decks[from]
    const toDeck = this.decks[target]
    const audible = this.playing && fromDeck.url !== null && !fromDeck.el.paused

    this.active = target
    this.events.onDuration(this.duration)
    this.events.onTime(0)

    /* Пока файл читался, могли нажать паузу (или, наоборот, «играть») — побеждает последнее желание */
    if (!this.wantPlay) {
      this.silence(from)
      this.setNow(toDeck.gain.gain, 1)
      this.setPlaying(false)
      return 'ok'
    }

    this.cancelPauseTimer()
    await this.ctx.resume().catch(() => {})
    if (seq !== this.loadSeq) return 'stale'
    try {
      await toDeck.el.play()
    } catch (e) {
      /* play() прервала более новая загрузка (она поставила деку на паузу) — это не ошибка */
      if (seq !== this.loadSeq) return 'stale'
      console.warn('Не удалось воспроизвести:', e)
      this.silence(target)
      this.active = from
      this.events.onDuration(this.duration)
      this.events.onTime(this.currentTime)
      return 'error'
    }
    if (seq !== this.loadSeq) return 'stale'
    this.rampTo(this.fader.gain, 1, audible ? 0.02 : PAUSE_FADE)
    this.setPlaying(true)

    if (audible) {
      const incoming = isFinite(toDeck.el.duration) ? toDeck.el.duration / (toDeck.el.playbackRate || 1) : Infinity
      const d = Math.max(DECLICK, Math.min(opts.fade, incoming / 2))
      this.startTransition(from, target, d)
    } else {
      this.silence(from)
      this.setNow(toDeck.gain.gain, 1)
    }
    return 'ok'
  }

  /**
   * Отменяет незавершённую смену трека: остаётся играть то, что играло.
   * Нужна, когда вернулись к текущему треку, пока грузился другой («Далее» и сразу «Назад»).
   */
  cancelLoad() {
    if (!this.switching) return
    this.loadSeq++
    this.switching = false
    this.wantPlay = this.playing
    const idle = this.decks[1 - this.active]
    if (idle.pending && !this.transition) {
      idle.token++
      idle.pending = null
      idle.trackId = null
    }
    this.events.onDuration(this.duration)
    this.events.onTime(this.currentTime)
    /* Пока ждали, прежний трек успел доиграть — его «конец» тогда не сообщили, сообщаем сейчас */
    const el = this.decks[this.active].el
    if (el.ended && this.hasSource) this.events.onEnded()
  }

  removeTracks(ids: Set<number>) {
    const activeRemoved = this.currentTrackId !== null && ids.has(this.currentTrackId)
    if (activeRemoved) { this.stop(); return true }
    const idle = this.decks[1 - this.active]
    if (idle.trackId !== null && ids.has(idle.trackId)) {
      this.loadSeq++
      this.switching = false
      this.finishTransition(true)
      idle.token++
      idle.pending = null
      idle.trackId = null
      this.silence(1 - this.active)
    }
    return false
  }

  stop() {
    void invoke('cancel_media_decode').catch(() => {})
    this.loadSeq++
    this.wantPlay = false
    this.switching = false
    this.finishTransition(true)
    this.cancelPauseTimer()
    this.decks.forEach((d, i) => {
      d.token++
      d.pending = null
      d.trackId = null
      this.silence(i)
      d.el.removeAttribute('src')
      d.el.load()
      if (d.url) URL.revokeObjectURL(d.url)
      d.url = null
    })
    this.setPlaying(false)
    this.events.onTime(0)
    this.events.onDuration(0)
  }

  /* ===== Транспорт ===== */

  play() {
    this.wantPlay = true
    if (!this.hasSource) return
    /* Идёт смена трека — прежний не запускаем: новый заиграет сам, как только прочитается */
    if (this.switching && !this.playing) return
    this.cancelPauseTimer()
    void this.ctx.resume().catch(() => {})
    const active = this.decks[this.active].el
    if (active.ended) active.currentTime = 0
    active.play().catch((e) => console.warn('Не удалось воспроизвести:', e))
    if (this.transition) {
      this.decks[this.transition.outIdx].el.play().catch(() => {})
      this.armTransitionTimer()
    }
    this.rampTo(this.fader.gain, 1, PAUSE_FADE)
    this.setPlaying(true)
  }

  pause() {
    this.wantPlay = false
    if (!this.playing) return
    this.setPlaying(false)
    if (this.transition?.timer) {
      clearTimeout(this.transition.timer)
      this.transition.timer = null
    }
    this.rampTo(this.fader.gain, 0, PAUSE_FADE)
    this.cancelPauseTimer()
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      this.decks.forEach((d) => d.el.pause())
      /* Вместе с контекстом замирают и кривые кроссфейда — после паузы переход продолжится с того же места */
      void this.ctx.suspend().catch(() => {})
    }, PAUSE_FADE * 1000 + 20)
  }

  seek(time: number) {
    /* Перемотка во время перехода относится к новому треку — старый быстро уводим */
    this.finishTransition(true)
    const el = this.decks[this.active].el
    el.currentTime = Math.max(0, time)
    this.events.onTime(el.currentTime)
  }

  dispose() {
    this.stop()
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
    void this.ctx.close().catch(() => {})
  }

  /* ===== Внутреннее ===== */

  private bindDeck(i: number) {
    const deck = this.decks[i]
    const el = deck.el
    const isActive = () => this.active === i && deck.url !== null
    const onTime = () => { if (isActive() && !this.switching) this.events.onTime(el.currentTime) }
    const onDuration = () => { if (isActive()) this.events.onDuration(isFinite(el.duration) ? el.duration : 0) }
    const onEnded = () => {
      if (this.transition && this.transition.outIdx === i) {
        this.finishTransition(false)
        return
      }
      /* Старый трек доиграл, пока грузится выбранный: переход уже идёт, иначе плеер перескочил бы через новый */
      if (isActive() && !this.switching) this.events.onEnded()
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('durationchange', onDuration)
    el.addEventListener('loadedmetadata', onDuration)
    const onError = () => { if (isActive() && !this.switching && deck.trackId !== null) this.events.onError?.(deck.trackId) }
    el.addEventListener('error', onError)
    el.addEventListener('ended', onEnded)
    this.cleanups.push(() => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('durationchange', onDuration)
      el.removeEventListener('loadedmetadata', onDuration)
      el.removeEventListener('error', onError)
      el.removeEventListener('ended', onEnded)
    })
  }

  private prepare(idx: number, track: EngineTrack): Promise<boolean> {
    const deck = this.decks[idx]
    const rate = track.playbackRate ?? 1
    const rewind = (ok: boolean) => {
      if (ok && deck.trackId === track.id) {
        deck.el.defaultPlaybackRate = rate
        deck.el.playbackRate = rate
        if (deck.el.currentTime !== 0) deck.el.currentTime = 0
      }
      return ok
    }
    /* Уже загружен (или грузится) нужный трек — переиспользуем */
    if (deck.trackId === track.id && deck.pending) {
      this.silence(idx)
      return deck.pending.then(rewind)
    }

    const token = ++deck.token
    deck.trackId = track.id
    this.silence(idx)
    const job = (async () => {
      try {
        const bytes = await readFile(track.filePath)
        if (deck.token !== token) return false
        const url = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: audioMime(track.filePath) })
        )
        if (deck.url) URL.revokeObjectURL(deck.url)
        deck.url = url
        deck.el.src = url
        let ok = await waitReady(deck.el)
        if (!ok && deck.token === token) {
          // FFmpeg decodes only for playback; the imported source file stays untouched.
          const decoded = await invoke<string>('decode_media_audio', { path: track.filePath })
          try {
            if (deck.token !== token) return false
            const pcm = await readFile(decoded)
            if (deck.token !== token) return false
            const decodedUrl = URL.createObjectURL(new Blob([pcm as unknown as BlobPart], { type: 'audio/wav' }))
            if (deck.url) URL.revokeObjectURL(deck.url)
            deck.url = decodedUrl
            deck.el.src = decodedUrl
            ok = await waitReady(deck.el)
          } finally { await remove(decoded).catch(() => {}) }
        }
        return ok && deck.token === token
      } catch (e) {
        console.error(`Не удалось прочитать трек (id ${track.id}):`, e)
        return false
      }
    })()
    deck.pending = job
    return job.then((ok) => {
      if (!ok && deck.token === token) {
        deck.trackId = null
        deck.pending = null
      }
      return rewind(ok)
    })
  }

  private startTransition(from: number, to: number, duration: number) {
    const now = this.ctx.currentTime + 0.005
    const gOut = this.decks[from].gain.gain
    const gIn = this.decks[to].gain.gain
    const outStart = Math.min(1, gOut.value)
    gOut.cancelScheduledValues(0)
    gIn.cancelScheduledValues(0)
    gOut.setValueAtTime(outStart, now)
    gIn.setValueAtTime(0, now)
    /* Кривая собирается из коротких линейных отрезков — так нельзя словить ошибку пересечения событий */
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const p = k / CURVE_STEPS
      const t = now + duration * p
      gIn.linearRampToValueAtTime(shape(this.curve, p), t)
      gOut.linearRampToValueAtTime(outStart * shape(this.curve, 1 - p), t)
    }
    this.transition = { outIdx: from, endAt: now + duration, timer: null }
    this.armTransitionTimer()
  }

  private armTransitionTimer() {
    const tr = this.transition
    if (!tr) return
    if (tr.timer) clearTimeout(tr.timer)
    const left = Math.max(0, tr.endAt - this.ctx.currentTime)
    tr.timer = setTimeout(() => this.finishTransition(false), left * 1000 + 40)
  }

  /** hard — переход прерван: уходящую деку не обрываем, а быстро глушим */
  private finishTransition(hard: boolean) {
    const tr = this.transition
    if (!tr) return
    this.transition = null
    if (tr.timer) clearTimeout(tr.timer)
    const out = this.decks[tr.outIdx]
    const inGain = this.decks[this.active].gain.gain
    if (hard) {
      this.rampTo(out.gain.gain, 0, ABORT_FADE)
      this.rampTo(inGain, 1, ABORT_FADE)
      const token = out.token
      setTimeout(() => {
        if (out.token === token && this.decks[this.active] !== out) out.el.pause()
      }, ABORT_FADE * 1000 + 20)
    } else {
      out.el.pause()
      this.setNow(out.gain.gain, 0)
      this.setNow(inGain, 1)
    }
  }

  private silence(idx: number) {
    const d = this.decks[idx]
    d.el.pause()
    this.setNow(d.gain.gain, 0)
  }

  private setNow(p: AudioParam, v: number) {
    p.cancelScheduledValues(0)
    p.setValueAtTime(v, this.ctx.currentTime)
  }

  private rampTo(p: AudioParam, v: number, dur: number) {
    const now = this.ctx.currentTime
    const cur = p.value
    p.cancelScheduledValues(0)
    p.setValueAtTime(cur, now)
    p.linearRampToValueAtTime(v, now + dur)
  }

  private cancelPauseTimer() {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  private setPlaying(v: boolean) {
    if (this.playing === v) return
    this.playing = v
    this.events.onPlayingChange(v)
  }
}
