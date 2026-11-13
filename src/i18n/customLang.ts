/* ===== Проверка своих переводов (файлы из папки languages) =====
 * Свой перевод — частичное наложение поверх встроенного базового языка: берётся только то, что
 * совпадает со структурой встроенного словаря. Всё остальное (лишние ключи, значения не того
 * типа, пустые строки) отбрасывается, и на этих местах остаётся текст базового языка.
 * Список изменений и «Что нового» переводит только Playly — из своего перевода они не берутся.
 * Модуль без зависимостей от Tauri: его проверяют тесты.
 */

export type Dict = Record<string, unknown>
export type BaseLang = 'ru' | 'en'

/* Разделы, которые переводит только Playly */
export const INTERNAL_KEYS = ['changelog', 'whatsNew']
export const isInternalKey = (key: string) => INTERNAL_KEYS.some((k) => key === k || key.startsWith(`${k}.`))

/* Больше — почти наверняка не перевод (или чужой файл); читать такое целиком нет смысла */
export const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_STRING = 20_000
const MAX_TITLE = 60
const MAX_EMOJI = 16
const DEFAULT_EMOJI = '🏳️'
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])

export type CustomLangErrorKind = 'missing' | 'read' | 'tooLarge' | 'syntax' | 'notObject' | 'empty'

export interface CustomLangConfig {
  title: string
  iconemoji: string
  base: BaseLang
}

export interface CustomLangReport {
  /* Сколько строк перевода принято */
  accepted: number
  /* Ключи, которых нет во встроенном словаре (опечатка или устаревший ключ) */
  unknown: string[]
  /* Значения не того типа или пустые — на их месте текст базового языка */
  invalid: string[]
  /* Строки, где пропали {переменные} из оригинала — текст покажется, но без числа или имени */
  placeholders: string[]
  /* В файле был список изменений — он не используется */
  internalIgnored: boolean
}

export type CustomLangResult =
  | { ok: true; dict: Dict; config: CustomLangConfig; report: CustomLangReport }
  | { ok: false; kind: CustomLangErrorKind; detail?: string }

const isPlainObject = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v)

const isPluralObject = (v: unknown): v is Record<string, string> =>
  isPlainObject(v) &&
  Object.keys(v).length > 0 &&
  Object.entries(v).every(([k, s]) => PLURAL_FORMS.has(k) && typeof s === 'string')

const placeholdersOf = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))

function lostPlaceholders(ref: string, value: string): boolean {
  const have = placeholdersOf(value)
  for (const p of placeholdersOf(ref)) if (!have.has(p)) return true
  return false
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v.trim() === '') return null
  return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v
}

/* Короткая надпись из config (название, флаг): без переводов строк и управляющих символов */
function cleanLabel(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return [...s].slice(0, max).join('')
}

export function readConfig(raw: unknown, fileName: string): CustomLangConfig {
  const cfg = isPlainObject(raw) && isPlainObject(raw.config) ? raw.config : {}
  return {
    title: cleanLabel(cfg.title, MAX_TITLE) || fileName.replace(/\.json$/i, ''),
    iconemoji: cleanLabel(cfg.iconemoji, MAX_EMOJI) || DEFAULT_EMOJI,
    base: cfg.base === 'ru' ? 'ru' : 'en',
  }
}

/**
 * Оставляет из своего перевода только то, что подходит по структуре к встроенному словарю ref.
 * Строка ↔ строка; формы числа ↔ формы числа (или одна строка на все формы);
 * вложенный раздел ↔ объект; список строк ↔ список строк той же длины.
 */
export function sanitizeAgainst(ref: Dict, custom: Dict, report: CustomLangReport, prefix = ''): Dict {
  const out: Dict = {}
  for (const [key, value] of Object.entries(custom)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (!prefix && key === 'config') continue
    if (!prefix && INTERNAL_KEYS.includes(key)) {
      report.internalIgnored = true
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(ref, key)) {
      report.unknown.push(path)
      continue
    }
    const refValue = ref[key]

    if (typeof refValue === 'string') {
      const s = cleanString(value)
      if (s === null) {
        report.invalid.push(path)
        continue
      }
      if (lostPlaceholders(refValue, s)) report.placeholders.push(path)
      out[key] = s
      report.accepted += 1
    } else if (isPluralObject(refValue)) {
      const one = cleanString(value)
      if (one !== null) {
        out[key] = one
        report.accepted += 1
      } else if (isPlainObject(value)) {
        const forms: Record<string, string> = {}
        for (const [form, s] of Object.entries(value)) {
          const clean = PLURAL_FORMS.has(form) ? cleanString(s) : null
          if (clean !== null) forms[form] = clean
        }
        if (Object.keys(forms).length === 0) {
          report.invalid.push(path)
          continue
        }
        out[key] = forms
        report.accepted += 1
      } else report.invalid.push(path)
    } else if (Array.isArray(refValue)) {
      const ok =
        Array.isArray(value) &&
        value.length === refValue.length &&
        value.every((s) => cleanString(s) !== null)
      if (!ok) {
        report.invalid.push(path)
        continue
      }
      out[key] = value
      report.accepted += 1
    } else if (isPlainObject(refValue)) {
      if (!isPlainObject(value)) {
        report.invalid.push(path)
        continue
      }
      const nested = sanitizeAgainst(refValue, value, report, path)
      if (Object.keys(nested).length > 0) out[key] = nested
    }
  }
  return out
}

/**
 * Где в тексте первая ошибка JSON (смещение). Новые версии V8 не пишут позицию в сообщении
 * («Unexpected token '}'…»), а без неё ошибку в большом файле перевода не найти.
 */
export function jsonErrorOffset(text: string): number {
  let i = 0
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++
  }
  const fail = (): never => {
    throw i
  }
  const str = () => {
    if (text[i] !== '"') fail()
    i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++
      else if (text.charCodeAt(i) < 0x20) fail()
      i++
    }
    if (i >= text.length) fail()
    i++
  }
  const lit = (word: string) => {
    if (text.startsWith(word, i)) i += word.length
    else fail()
  }
  const num = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64))
    if (!m) fail()
    else i += m[0].length
  }
  const value = (): void => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') {
        i++
        return
      }
      for (;;) {
        ws()
        str()
        ws()
        if (text[i] !== ':') fail()
        i++
        value()
        ws()
        if (text[i] === ',') i++
        else if (text[i] === '}') {
          i++
          return
        } else fail()
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') {
        i++
        return
      }
      for (;;) {
        value()
        ws()
        if (text[i] === ',') i++
        else if (text[i] === ']') {
          i++
          return
        } else fail()
      }
    }
    if (c === '"') return str()
    if (c === 't') return lit('true')
    if (c === 'f') return lit('false')
    if (c === 'n') return lit('null')
    return num()
  }
  try {
    value()
    ws()
    return i < text.length ? i : -1
  } catch (pos) {
    return typeof pos === 'number' ? pos : -1
  }
}

function describeSyntax(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const fromMessage = /position (\d+)/.exec(message)
  const offset = fromMessage ? Number(fromMessage[1]) : jsonErrorOffset(text)
  if (offset < 0) return message
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = before.length - before.lastIndexOf('\n')
  /* Строка с ошибкой и стрелка под нужным символом */
  const source = (text.split('\n')[line - 1] ?? '').replace(/\r$/, '')
  const from = Math.max(0, column - 60)
  const snippet = source.slice(from, from + 100)
  return `${message}\nline ${line}, column ${column}:\n${snippet}\n${' '.repeat(column - 1 - from)}^`
}

/** Разбор файла перевода: текст → проверенный словарь или понятная причина отказа */
export function parseCustomTranslation(
  text: string,
  fileName: string,
  builtIn: Record<BaseLang, Dict>
): CustomLangResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, kind: 'tooLarge' }
  /* Блокнот Windows сохраняет UTF-8 с BOM — JSON.parse на нём падает */
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (clean.trim() === '') return { ok: false, kind: 'empty' }

  let raw: unknown
  try {
    raw = JSON.parse(clean)
  } catch (e) {
    return { ok: false, kind: 'syntax', detail: describeSyntax(clean, e) }
  }
  if (!isPlainObject(raw)) return { ok: false, kind: 'notObject' }

  const config = readConfig(raw, fileName)
  const report: CustomLangReport = { accepted: 0, unknown: [], invalid: [], placeholders: [], internalIgnored: false }
  const dict = sanitizeAgainst(builtIn[config.base], raw, report)
  if (report.accepted === 0) return { ok: false, kind: 'empty' }
  dict.config = config
  return { ok: true, dict, config, report }
}

/** Есть ли в отчёте что показать пользователю */
export const hasReportIssues = (r: CustomLangReport) =>
  r.unknown.length > 0 || r.invalid.length > 0 || r.placeholders.length > 0
