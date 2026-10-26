import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { FramePreview, ZoomControl } from './FrameEditor'
import { DEFAULT_FRAME, type ImageFrame } from '../lib/imageFrame'
import {
  applyFrame,
  capturePoster,
  encodeGif,
  gifFrameCount,
  loadVideo,
  loopSegments,
  mountPreview,
  segmentsLength,
  setVideoTime,
  useVideoGifRequest,
  type GifPurpose,
  type LoadedVideo,
  type Segment,
} from '../lib/media'
import './PlaylistBanner.css'
import './VideoGifEditor.css'

/* Ограничения, чтобы GIF не получался гигантским */
const MAX_LENGTH = 20
const MAX_FRAMES = 400
const SIZES = [240, 320, 400, 480]
const FPS_OPTIONS = [10, 15, 20, 25]

type Aspect = '1:1' | '16:9' | '3:1' | 'source'
const ASPECTS: Aspect[] = ['1:1', '16:9', '3:1', 'source']

const DEFAULT_ASPECT: Record<GifPurpose, Aspect> = {
  cover: '1:1',
  track: '1:1',
  avatar: '1:1',
  banner: '3:1',
  background: '16:9',
}

const fmtTime = (s: number) => {
  const v = Math.max(0, s)
  const m = Math.floor(v / 60)
  const sec = v - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}

/** Окно, которое открывается из любого выбора картинки, если выбрали видео */
export default function VideoGifHost() {
  const req = useVideoGifRequest()
  if (!req) return null
  return <VideoGifEditor key={req.id} path={req.path} purpose={req.purpose} onDone={req.resolve} />
}

interface EditorProps {
  path: string
  purpose: GifPurpose
  onDone: (r: { gif: Uint8Array; poster: Uint8Array } | null) => void
}

function VideoGifEditor({ path, purpose, onDone }: EditorProps) {
  const { t } = useI18n()
  /* Сам элемент <video> живёт в ref: React им не управляет, его вставляем в рамку вручную */
  const videoRef = useRef<LoadedVideo | null>(null)
  const [ready, setReady] = useState(false)
  /* Пропорции исходника — для режима «Как в видео» */
  const [sourceRatio, setSourceRatio] = useState(16 / 9)
  const [error, setError] = useState(false)
  const [duration, setDuration] = useState(0)
  const [time, setTime] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [frame, setFrame] = useState<ImageFrame>(DEFAULT_FRAME)
  const [aspect, setAspect] = useState<Aspect>(DEFAULT_ASPECT[purpose])
  const [size, setSize] = useState(purpose === 'banner' || purpose === 'background' ? 480 : 320)
  const [fps, setFps] = useState(15)
  const [posterTime, setPosterTime] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  /* Пока тянут ручку на шкале, зацикленный предпросмотр стоит, а видео показывает кадр под ручкой */
  const [dragging, setDragging] = useState(false)
  /* После «Создать GIF» настройки замораживаются, чтобы результат совпал с тем, что видно */
  const locked = progress !== null
  const stopRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const needsPoster = purpose === 'track'

  /* ===== Загрузка видео ===== */
  useEffect(() => {
    let alive = true
    let loaded: LoadedVideo | null = null
    loadVideo(path)
      .then((v) => {
        if (!alive) return v.dispose()
        loaded = v
        const d = isFinite(v.el.duration) ? v.el.duration : 0
        v.el.loop = false
        setDuration(d)
        /* По умолчанию — первые несколько секунд с середины первой трети, там обычно уже есть картинка */
        const start = Math.min(d * 0.1, Math.max(0, d - 4))
        setSegments([{ start: +start.toFixed(1), end: +Math.min(d, start + 4).toFixed(1) }])
        setPosterTime(+start.toFixed(1))
        if (v.el.videoHeight) setSourceRatio(v.el.videoWidth / v.el.videoHeight)
        videoRef.current = v
        setReady(true)
      })
      .catch((e) => {
        console.error('Не удалось открыть видео:', e)
        if (alive) setError(true)
      })
    return () => {
      alive = false
      stopRef.current = true
      loaded?.dispose()
      videoRef.current = null
    }
  }, [path])

  /* Видео живёт внутри рамки предпросмотра, где его можно двигать и масштабировать */
  useEffect(() => {
    const box = stageRef.current?.querySelector('.vg-frame')
    const el = videoRef.current?.el
    if (!ready || !el || !box) return
    return mountPreview(el, box, setTime)
  }, [ready, aspect])

  /* Кадрирование видео — тем же стилем, что и у картинок */
  useEffect(() => {
    const el = videoRef.current?.el
    if (ready && el) applyFrame(el, frame)
  }, [ready, frame, aspect])

  /* Предпросмотр: фрагменты проигрываются по кругу, как будет в GIF */
  useEffect(() => {
    const el = videoRef.current?.el
    if (!ready || !el || progress !== null || dragging || segments.length === 0) return
    return loopSegments(el, segments)
  }, [ready, segments, progress, dragging])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      stopRef.current = true
      onDone(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone])

  /* ===== Размер результата ===== */
  const ratio = useMemo(() => {
    if (aspect === '1:1') return 1
    if (aspect === '16:9') return 16 / 9
    if (aspect === '3:1') return 3
    return sourceRatio
  }, [aspect, sourceRatio])
  const outW = ratio >= 1 ? size : Math.round(size * ratio)
  const outH = ratio >= 1 ? Math.round(size / ratio) : size

  const length = segmentsLength(segments)
  const frames = gifFrameCount(segments, fps)
  const tooLong = length > MAX_LENGTH || frames > MAX_FRAMES
  /* Очень грубая оценка: ~0.35 байта на пиксель кадра после LZW */
  const estimateMb = (outW * outH * frames * 0.35) / (1024 * 1024)

  const updateSeg = (i: number, patch: Partial<Segment>) =>
    setSegments((prev) =>
      prev.map((s, j) => {
        if (j !== i) return s
        const next = { ...s, ...patch }
        next.start = Math.max(0, Math.min(duration, +next.start.toFixed(2)))
        next.end = Math.max(next.start + 0.1, Math.min(duration, +next.end.toFixed(2)))
        return next
      })
    )

  const addSegment = () => {
    const start = Math.min(time, Math.max(0, duration - 1))
    setSegments((prev) => [...prev, { start: +start.toFixed(1), end: +Math.min(duration, start + 3).toFixed(1) }])
  }

  const seekTo = (t: number) => {
    const el = videoRef.current?.el
    if (el) setVideoTime(el, Math.max(0, Math.min(duration, t)))
  }

  const handleSave = async () => {
    const el = videoRef.current?.el
    if (!el || tooLong || segments.length === 0 || progress !== null) return
    stopRef.current = false
    setProgress(0)
    try {
      const gif = await encodeGif(el, {
        segments,
        frame,
        width: outW,
        height: outH,
        fps,
        onProgress: (d, total) => setProgress(d / total),
        shouldStop: () => stopRef.current,
      })
      if (!gif) return
      const posterScale = Math.max(1, Math.round(600 / Math.max(outW, outH)))
      const poster = await capturePoster(
        el,
        needsPoster ? posterTime : segments[0].start,
        frame,
        outW * posterScale,
        outH * posterScale
      )
      onDone({ gif, poster })
    } catch (e) {
      console.error('Не удалось собрать GIF:', e)
      setError(true)
    } finally {
      setProgress(null)
    }
  }

  const cancel = () => {
    stopRef.current = true
    onDone(null)
  }

  return createPortal(
    <div className="frame-modal-overlay vg-overlay" onMouseDown={(e) => e.target === e.currentTarget && progress === null && cancel()}>
      <div className="frame-modal wide vg-modal">
        <div className="frame-modal-head">
          <div className="frame-modal-title">{t('videoGif.title')}</div>
          <div className="frame-modal-sub">{t('videoGif.subtitle')}</div>
        </div>

        {error ? (
          <div className="look-editor-error vg-error">{t('videoGif.error')}</div>
        ) : !ready ? (
          <div className="vg-loading">
            <span className="vg-spinner" />
            {t('videoGif.loading')}
          </div>
        ) : (
          <div className={`vg-edit ${locked ? 'locked' : ''}`} inert={locked}>
            <div className="vg-stage" ref={stageRef}>
              <FramePreview
                key={aspect}
                src=""
                frame={frame}
                onChange={setFrame}
                className="vg-frame"
                style={{ aspectRatio: String(ratio), width: `min(100%, ${Math.round(260 * ratio)}px)` }}
                image={<></>}
              />
              {locked && (
                <div className="vg-stage-busy">
                  <span className="vg-spinner" />
                  {t('videoGif.encoding', { p: Math.round((progress ?? 0) * 100) })}
                </div>
              )}
            </div>
            <div className="frame-modal-sub look-editor-hint">{t('frame.hint')}</div>

            <Timeline
              duration={duration}
              time={time}
              segments={segments}
              posterTime={needsPoster ? posterTime : null}
              onSeek={seekTo}
              onSegment={(i, seg) => setSegments((prev) => prev.map((x, j) => (j === i ? seg : x)))}
              onPoster={(t) => setPosterTime(t)}
              onDragChange={setDragging}
            />

            <div className="vg-segments">
              {segments.map((s, i) => (
                <div key={i} className="vg-seg-row">
                  <span className="vg-seg-name">{t('videoGif.segment', { n: i + 1 })}</span>
                  <label className="vg-time-field">
                    <input type="number" min={0} max={duration} step={0.1} value={s.start} onChange={(e) => updateSeg(i, { start: Number(e.target.value) })} />
                  </label>
                  <button className="btn btn-ghost vg-mini-btn" onClick={() => updateSeg(i, { start: time })} title={t('videoGif.setStart')}>⇤</button>
                  <span className="vg-dash">—</span>
                  <label className="vg-time-field">
                    <input type="number" min={0} max={duration} step={0.1} value={s.end} onChange={(e) => updateSeg(i, { end: Number(e.target.value) })} />
                  </label>
                  <button className="btn btn-ghost vg-mini-btn" onClick={() => updateSeg(i, { end: time })} title={t('videoGif.setEnd')}>⇥</button>
                  <span className="vg-seg-len">{(s.end - s.start).toFixed(1)} {t('videoGif.sec')}</span>
                  <button
                    className="icon-btn vg-seg-remove"
                    onClick={() => setSegments((prev) => prev.filter((_, j) => j !== i))}
                    disabled={segments.length === 1}
                    title={t('common.delete')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
              <button className="btn btn-ghost vg-add" onClick={addSegment}>+ {t('videoGif.addSegment')}</button>
            </div>

            <div className="banner-editor-grid">
              <div className="banner-editor-field full">
                <div className="banner-editor-label"><span>{t('banner.zoom')}</span></div>
                <ZoomControl frame={frame} onChange={setFrame} />
              </div>
              <div className="banner-editor-field">
                <div className="banner-editor-label"><span>{t('videoGif.aspect')}</span></div>
                <div className="segmented">
                  {ASPECTS.map((a) => (
                    <button key={a} className={aspect === a ? 'active' : ''} onClick={() => setAspect(a)}>
                      {a === 'source' ? t('videoGif.aspectSource') : a}
                    </button>
                  ))}
                </div>
              </div>
              <div className="banner-editor-field">
                <div className="banner-editor-label">
                  <span>{t('videoGif.size')}</span>
                  <span>{outW}×{outH}</span>
                </div>
                <div className="segmented">
                  {SIZES.map((v) => (
                    <button key={v} className={size === v ? 'active' : ''} onClick={() => setSize(v)}>{v}</button>
                  ))}
                </div>
              </div>
              <div className="banner-editor-field">
                <div className="banner-editor-label"><span>{t('videoGif.fps')}</span></div>
                <div className="segmented">
                  {FPS_OPTIONS.map((v) => (
                    <button key={v} className={fps === v ? 'active' : ''} onClick={() => setFps(v)}>{v}</button>
                  ))}
                </div>
              </div>
              {needsPoster && (
                <div className="banner-editor-field">
                  <div className="banner-editor-label">
                    <span>{t('videoGif.poster')}</span>
                    <span>{fmtTime(posterTime)}</span>
                  </div>
                  <div className="banner-editor-file">
                    <button className="btn" onClick={() => setPosterTime(+time.toFixed(2))}>{t('videoGif.posterSet')}</button>
                    <button className="btn btn-ghost" onClick={() => seekTo(posterTime)}>{t('videoGif.posterShow')}</button>
                  </div>
                </div>
              )}
            </div>

            <div className={`vg-summary ${tooLong ? 'warn' : ''}`}>
              {tooLong
                ? t('videoGif.tooLong', { max: MAX_LENGTH })
                : t('videoGif.summary', { len: length.toFixed(1), frames, mb: estimateMb.toFixed(1) })}
            </div>
            {needsPoster && <div className="frame-modal-sub">{t('videoGif.posterHint')}</div>}
          </div>
        )}

        {progress !== null && (
          <div className="vg-progress">
            <div className="vg-progress-bar"><i style={{ width: `${Math.round(progress * 100)}%` } as CSSProperties} /></div>
            <span>{t('videoGif.encoding', { p: Math.round(progress * 100) })}</span>
          </div>
        )}

        <div className="frame-modal-actions">
          <button className="btn" onClick={cancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!ready || tooLong || segments.length === 0 || progress !== null}>
            {progress !== null ? t('common.loading') : t('videoGif.create')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ===== Шкала времени: ручки фрагментов, перетаскивание, кадр заставки, позиция ===== */

type DragKind = 'start' | 'end' | 'move' | 'poster' | 'playhead'

interface TimelineProps {
  duration: number
  time: number
  segments: Segment[]
  posterTime: number | null
  onSeek: (t: number) => void
  onSegment: (i: number, seg: Segment) => void
  onPoster: (t: number) => void
  onDragChange: (dragging: boolean) => void
}

const MIN_SEG = 0.2

function Timeline({ duration, time, segments, posterTime, onSeek, onSegment, onPoster, onDragChange }: TimelineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ kind: DragKind; seg: number } | null>(null)
  /* Где схватили фрагмент при перетаскивании целиком */
  const grabRef = useRef(0)

  const timeAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`
  const round = (t: number) => Math.round(t * 20) / 20

  const apply = (kind: DragKind, seg: number, clientX: number) => {
    const t = round(timeAt(clientX))
    const s = segments[seg]
    if (kind === 'playhead') onSeek(t)
    else if (kind === 'poster') {
      onPoster(t)
      onSeek(t)
    } else if (s && kind === 'start') {
      const start = Math.min(t, s.end - MIN_SEG)
      onSegment(seg, { ...s, start })
      onSeek(start)
    } else if (s && kind === 'end') {
      const end = Math.max(t, s.start + MIN_SEG)
      onSegment(seg, { ...s, end })
      onSeek(end)
    } else if (s && kind === 'move') {
      const len = s.end - s.start
      const start = Math.max(0, Math.min(duration - len, round(t - grabRef.current)))
      onSegment(seg, { start, end: +(start + len).toFixed(2) })
      onSeek(start)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.target as HTMLElement
    const kind = (el.closest('[data-kind]') as HTMLElement | null)?.dataset.kind as DragKind | undefined
    const seg = Number((el.closest('[data-seg]') as HTMLElement | null)?.dataset.seg ?? -1)
    const k: DragKind = kind ?? 'playhead'
    if (k === 'move' && segments[seg]) grabRef.current = timeAt(e.clientX) - segments[seg].start
    e.currentTarget.setPointerCapture(e.pointerId)
    setActive({ kind: k, seg })
    onDragChange(true)
    apply(k, seg, e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (active) apply(active.kind, active.seg, e.clientX)
  }

  const end = () => {
    if (!active) return
    setActive(null)
    onDragChange(false)
  }

  /* Подписи на шкале: 5–8 делений по «круглым» секундам */
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => duration / s <= 8) ?? 600
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)

  return (
    <div className="vg-timeline-wrap">
      <div
        ref={ref}
        className={`vg-timeline ${active ? `dragging drag-${active.kind}` : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {segments.map((s, i) => (
          <div
            key={i}
            className={`vg-seg ${active?.seg === i ? 'active' : ''}`}
            data-seg={i}
            data-kind="move"
            style={{ left: pct(s.start), width: pct(s.end - s.start) }}
          >
            <span className="vg-handle start" data-kind="start" />
            <span className="vg-seg-label">{(s.end - s.start).toFixed(1)}</span>
            <span className="vg-handle end" data-kind="end" />
          </div>
        ))}
        {posterTime !== null && (
          <span className="vg-poster-mark" data-kind="poster" style={{ left: pct(posterTime) }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14l-8-4-8 4z" /></svg>
          </span>
        )}
        <span className="vg-playhead" data-kind="playhead" style={{ left: pct(time) }} />
      </div>
      <div className="vg-ticks">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>{fmtTime(t).replace(/\.\d$/, '')}</span>
        ))}
      </div>
    </div>
  )
}
