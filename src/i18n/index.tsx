import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import { ru } from './ru'
import { en } from './en'
import {
  INTERNAL_KEYS,
  hasReportIssues,
  isInternalKey,
  MAX_FILE_BYTES,
  parseCustomTranslation,
  type BaseLang,
  type CustomLangErrorKind,
  type CustomLangReport,
  type CustomLangResult,
  type Dict,
} from './customLang'

/* ===== Встроенные переводы ===== */
const builtIn: Record<BaseLang, Dict> = { ru, en }

/*
 * Список изменений и «Что нового» — только встроенные (русский и английский): свой перевод их не меняет
 * и в шаблон перевода они не попадают. Пока выбран свой перевод, эти тексты показываются на том
 * встроенном языке, который был включён последним. Проверка своих переводов — в customLang.ts.
 */

/* ===== Список встроенных языков ===== */
// eslint-disable-next-line react-refresh/only-export-components
export const LANGS: Array<{ id: string; flag: string; title: string }> = [
  { id: 'ru', flag: ru.config.iconemoji, title: ru.config.title },
  { id: 'en', flag: en.config.iconemoji, title: en.config.title },
]

export interface CustomLangMeta {
  id: string // имя файла
  title: string // название из config.title
  iconemoji: string // флаг из config.iconemoji
  /* Файл не подходит: в списке он виден, но выбрать его нельзя */
  error?: CustomLangErrorKind
  detail?: string
}

/* Почему свой перевод не включился (или не создался шаблон) */
export interface LangError {
  kind: CustomLangErrorKind | 'template' | 'folder'
  file?: string
  detail?: string
}

/* Перевод включён, но часть строк из него не взята */
export interface LangWarning {
  file: string
  report: CustomLangReport
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''))

/* ===== Автоопределение языка ОС: ru/be → русский, иначе английский ===== */
function detectLang(): string {
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('ru') || nav.startsWith('be')) return 'ru'
  return 'en'
}

/* ===== Плюрализация ===== */
function pluralForm(lang: string, n: number): string {
  if (lang.startsWith('ru') || lang.startsWith('be')) {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return 'one'
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few'
    return 'many'
  }
  return n === 1 ? 'one' : 'other'
}

/* ===== Поиск ключа "a.b.c" в словаре ===== */
function lookup(dict: Dict | undefined, key: string): unknown {
  if (!dict) return undefined
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
    if (node === undefined) return undefined
  }
  return node
}

/* ===== Подстановка {переменных} ===== */
function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    vars[name] !== undefined ? String(vars[name]) : m
  )
}

/* ===== Папка с кастомными переводами: <appData>/playly/languages ===== */
async function getLanguagesDir(): Promise<string> {
  const appDir = await appDataDir()
  const dir = await join(appDir, 'playly', 'languages')
  await mkdir(dir, { recursive: true })
  return dir
}

/* Прочитать и проверить файл своего перевода */
async function loadCustomFile(fileName: string): Promise<CustomLangResult> {
  let text: string
  try {
    const path = await join(await getLanguagesDir(), fileName)
    if (!(await exists(path))) return { ok: false, kind: 'missing' }
    text = await readTextFile(path)
  } catch (e) {
    return { ok: false, kind: 'read', detail: errorText(e) }
  }
  if (text.length > MAX_FILE_BYTES) return { ok: false, kind: 'tooLarge' }
  return parseCustomTranslation(text, fileName, builtIn)
}

interface I18nContextValue {
  lang: string
  setLang: (lang: string) => void
  t: (key: string, vars?: Record<string, unknown>) => string
  /* Структурированное значение перевода (например, список изменений), без подстановок */
  tm: <T = unknown>(key: string) => T | undefined
  customLangs: CustomLangMeta[]
  refreshCustomLangs: () => Promise<void>
  createTemplate: (base: 'ru' | 'en') => Promise<void>
  /* ok — включён; warning — включён, но часть строк не взята; error — остался встроенный язык */
  selectCustom: (id: string) => Promise<'ok' | 'warning' | 'error'>
  openLanguagesFolder: () => Promise<void>
  langError: LangError | null
  langWarning: LangWarning | null
  clearLangNotices: () => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * persist — запоминать выбор языка в settings.json. Мини-плеер берёт язык у главного окна
 * и сам файл настроек не пишет: иначе два окна одновременно перезаписывали бы его.
 */
export function I18nProvider({ children, persist = true }: { children: ReactNode; persist?: boolean }) {
  const persistRef = useRef(persist)
  const saveLang = useCallback((language: string) => {
    if (persistRef.current) writeSettingsRaw({ language }).catch(() => {})
  }, [])
  const [lang, setLangState] = useState<string>(() => detectLang())
  const [custom, setCustom] = useState<{ lang: string; dict: Dict; base: 'ru' | 'en' } | null>(null)
  const [customLangs, setCustomLangs] = useState<CustomLangMeta[]>([])
  const [langError, setLangError] = useState<LangError | null>(null)
  const [langWarning, setLangWarning] = useState<LangWarning | null>(null)
  const clearLangNotices = useCallback(() => {
    setLangError(null)
    setLangWarning(null)
  }, [])
  /* Последний включённый встроенный язык — на нём список изменений, пока выбран свой перевод */
  const [lastBuiltIn, setLastBuiltIn] = useState<BaseLang | null>(null)
  const lastBuiltInRef = useRef<BaseLang | null>(null)
  const rememberBuiltIn = useCallback((language: BaseLang) => {
    lastBuiltInRef.current = language
    setLastBuiltIn(language)
    if (persistRef.current) writeSettingsRaw({ changelogLanguage: language }).catch(() => {})
  }, [])

  /* ===== Применить кастомный перевод ===== */
  const applyCustom = useCallback((langId: string, result: Extract<CustomLangResult, { ok: true }>) => {
    const r = result.report
    const hasIssues = hasReportIssues(r)
    setCustom({ lang: langId, dict: result.dict, base: result.config.base })
    setLangState(langId)
    setLangError(null)
    setLangWarning(hasIssues ? { file: langId, report: r } : null)
    saveLang(langId)
  }, [saveLang])

  /* ===== Свой перевод не загрузился: остаёмся на встроенном языке и объясняем почему ===== */
  const failCustom = useCallback((file: string, kind: CustomLangErrorKind, detail?: string) => {
    console.warn(`[i18n] Перевод "${file}" не загружен: ${kind}`, detail ?? '')
    const fallback: BaseLang = lastBuiltInRef.current ?? (detectLang() === 'ru' ? 'ru' : 'en')
    setCustom(null)
    setLangState(fallback)
    setLangError({ kind, file, detail })
    setLangWarning(null)
    saveLang(fallback)
  }, [saveLang])

  /* ===== Переключить на встроенный язык ===== */
  const setLang = useCallback((next: string) => {
    if (next === 'ru' || next === 'en') {
      setCustom(null)
      setLangState(next)
      setLangError(null)
      setLangWarning(null)
      saveLang(next)
      rememberBuiltIn(next)
    }
  }, [saveLang, rememberBuiltIn])

  /* ===== Сканируем папку languages ===== */
  const refreshCustomLangs = useCallback(async () => {
    try {
      const dir = await getLanguagesDir()
      const entries = await readDir(dir)
      const list: CustomLangMeta[] = []
      for (const e of entries) {
        const name = e.name ?? ''
        if (!name.toLowerCase().endsWith('.json')) continue
        /* Битый файл не прячем: в списке видно, что с ним не так */
        const result = await loadCustomFile(name)
        const title = name.replace(/\.json$/i, '')
        if (result.ok) list.push({ id: name, title: result.config.title, iconemoji: result.config.iconemoji })
        else list.push({ id: name, title, iconemoji: '⚠️', error: result.kind, detail: result.detail })
      }
      setCustomLangs(list)
    } catch (e) {
      console.error('Ошибка чтения папки languages:', e)
    }
  }, [])

  /* ===== Создать шаблон перевода ===== */
  const createTemplate = useCallback(
    async (base: 'ru' | 'en') => {
      try {
        const src = base === 'ru' ? ru : en
        const template: Dict = JSON.parse(JSON.stringify(src))
        /* Список изменений переводит только Playly — в шаблоне его нет */
        for (const k of INTERNAL_KEYS) delete template[k]
        ;(template as { config?: unknown }).config = {
          iconemoji: '🏳️',
          title: base === 'ru' ? 'Мой язык' : 'My Language',
          base,
        }
        const dir = await getLanguagesDir()
        let fileName = 'my-translation.json'
        let i = 2
        while (await exists(await join(dir, fileName))) {
          fileName = `my-translation-${i}.json`
          i += 1
        }
        const filePath = await join(dir, fileName)
        await writeTextFile(filePath, JSON.stringify(template, null, 2))
        await refreshCustomLangs()
        await invoke('reveal_item_in_dir', { path: filePath }).catch(() => {})
      } catch (e) {
        console.error('Не удалось создать шаблон перевода:', e)
        setLangError({ kind: 'template', detail: errorText(e) })
      }
    },
    [refreshCustomLangs]
  )

  /* ===== Выбрать кастомный язык (с обработкой ошибок) ===== */
  const selectCustom = useCallback(
    async (id: string): Promise<'ok' | 'warning' | 'error'> => {
      const result = await loadCustomFile(id)
      if (result.ok) {
        applyCustom(id, result)
        return hasReportIssues(result.report) ? 'warning' : 'ok'
      }
      /* Файла нет или он битый: остаёмся на встроенном языке */
      failCustom(id, result.kind, result.detail)
      await refreshCustomLangs()
      return 'error'
    },
    [applyCustom, failCustom, refreshCustomLangs]
  )

  /* ===== Открыть папку languages ===== */
  const openLanguagesFolder = useCallback(async () => {
    try {
      const dir = await getLanguagesDir()
      await invoke('reveal_item_in_dir', { path: dir })
    } catch (e) {
      console.error('Не удалось открыть папку languages:', e)
      setLangError({ kind: 'folder', detail: errorText(e) })
    }
  }, [])

  /* ===== При старте: читаем сохранённый язык + обработка "язык выбран, но его нет" ===== */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const raw = await readSettingsRaw().catch(() => ({} as Record<string, unknown>))
      const saved = (raw as Record<string, unknown>).language
      const savedChangelog = (raw as Record<string, unknown>).changelogLanguage
      if (cancelled) return
      if (savedChangelog === 'ru' || savedChangelog === 'en') {
        lastBuiltInRef.current = savedChangelog
        setLastBuiltIn(savedChangelog)
      }

      /* Встроенные языки есть всегда */
      if (saved === 'ru' || saved === 'en') {
        setLangState(saved)
        if (savedChangelog !== saved) rememberBuiltIn(saved)
        return
      }

      /* Кастомный язык: пробуем загрузить файл */
      if (typeof saved === 'string' && saved) {
        const result = await loadCustomFile(saved)
        if (cancelled) return
        if (result.ok) applyCustom(saved, result)
        else failCustom(saved, result.kind, result.detail)
      }
    })()
    /* Список своих переводов читается асинхронно — состояние меняется уже после await */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCustomLangs()
    return () => {
      cancelled = true
    }
  }, [applyCustom, failCustom, refreshCustomLangs, rememberBuiltIn])

  /* Цепочка словарей: свой перевод → его базовый язык → русский */
  const resolve = useCallback(
    (key: string) => {
      const isCustomActive = !!custom && custom.lang === lang
      const internal = isInternalKey(key)
      /* Список изменений: свой перевод пропускаем, язык — последний встроенный (или базовый у перевода) */
      const rawBase = isCustomActive ? (internal ? lastBuiltIn ?? custom.base : custom.base) : lang
      const baseLang: BaseLang = rawBase === 'en' || rawBase === 'ru' ? rawBase : 'ru' // защита от неизвестного языка
      const dicts = [isCustomActive && !internal ? custom.dict : undefined, builtIn[baseLang], builtIn.ru]

      let value: unknown
      for (const d of dicts) {
        value = lookup(d, key)
        if (value !== undefined) break
      }
      return { value, baseLang }
    },
    [lang, custom, lastBuiltIn]
  )

  const tm = useCallback(<T,>(key: string) => resolve(key).value as T | undefined, [resolve])

  const t = useCallback(
    (key: string, vars?: Record<string, unknown>) => {
      const { value, baseLang } = resolve(key)

      if (value !== null && typeof value === 'object') {
        /* Берём только строки: значение не того типа показывается ключом, а не роняет интерфейс */
        const obj = value as Record<string, unknown>
        const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
        const count = Number(vars?.count ?? vars?.n ?? 0)
        const form = pluralForm(baseLang, Number.isFinite(count) ? count : 0)
        const template =
          str(obj[form]) ??
          str(baseLang === 'ru' ? obj.many : obj.other) ??
          str(obj.other) ??
          str(obj.one) ??
          Object.values(obj).map(str).find((v) => v !== undefined) ??
          key
        return interpolate(template, vars)
      }

      if (typeof value === 'string') return interpolate(value, vars)
      return key
    },
    [resolve]
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t,
      tm,
      customLangs,
      refreshCustomLangs,
      createTemplate,
      selectCustom,
      openLanguagesFolder,
      langError,
      langWarning,
      clearLangNotices,
    }),
    [lang, setLang, t, tm, customLangs, refreshCustomLangs, createTemplate, selectCustom, openLanguagesFolder, langError, langWarning, clearLangNotices]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}