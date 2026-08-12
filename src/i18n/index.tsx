import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { readSettingsRaw, writeSettingsRaw } from '../components/views/settings/helpers'
import { ru } from './ru'
import { en } from './en'

/* ===== Встроенные переводы ===== */
type Dict = Record<string, unknown>
const builtIn: Record<string, Dict> = { ru, en }

/* ===== Список встроенных языков ===== */
export const LANGS: Array<{ id: string; flag: string; title: string }> = [
  { id: 'ru', flag: ru.config.iconemoji, title: ru.config.title },
  { id: 'en', flag: en.config.iconemoji, title: en.config.title },
]

export interface CustomLangMeta {
  id: string // имя файла
  title: string // название из config.title
  iconemoji: string // флаг из config.iconemoji
}

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

interface I18nContextValue {
  lang: string
  setLang: (lang: string) => void
  t: (key: string, vars?: Record<string, unknown>) => string
  customLangs: CustomLangMeta[]
  refreshCustomLangs: () => Promise<void>
  createTemplate: (base: 'ru' | 'en') => Promise<void>
  selectCustom: (id: string) => Promise<void>
  openLanguagesFolder: () => Promise<void>
  langError: string | null
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(() => detectLang())
  const [custom, setCustom] = useState<{ lang: string; dict: Dict; base: 'ru' | 'en' } | null>(null)
  const [customLangs, setCustomLangs] = useState<CustomLangMeta[]>([])
  const [langError, setLangError] = useState<string | null>(null)

  /* ===== Применить кастомный перевод ===== */
  const applyCustom = useCallback((langId: string, dict: Dict) => {
    const cfg = (dict as { config?: { base?: string } }).config
    const base: 'ru' | 'en' = cfg?.base === 'ru' ? 'ru' : 'en'
    setCustom({ lang: langId, dict, base })
    setLangState(langId)
    setLangError(null)
    writeSettingsRaw({ language: langId }).catch(() => {})
  }, [])

  /* ===== Переключить на встроенный язык ===== */
  const setLang = useCallback((next: string) => {
    if (next === 'ru' || next === 'en') {
      setCustom(null)
      setLangState(next)
      setLangError(null)
      writeSettingsRaw({ language: next }).catch(() => {})
    }
  }, [])

  /* ===== Сканируем папку languages ===== */
  const refreshCustomLangs = useCallback(async () => {
    try {
      const dir = await getLanguagesDir()
      const entries = await readDir(dir)
      const list: CustomLangMeta[] = []
      for (const e of entries) {
        const name = e.name ?? ''
        if (!name.toLowerCase().endsWith('.json')) continue
        try {
          const raw = await readTextFile(await join(dir, name))
          const dict = JSON.parse(raw) as { config?: { title?: string; iconemoji?: string } }
          list.push({
            id: name,
            title: dict.config?.title || name.replace(/\.json$/i, ''),
            iconemoji: dict.config?.iconemoji || '🏳️',
          })
        } catch {
          /* битый файл — пропускаем */
        }
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
      }
    },
    [refreshCustomLangs]
  )

  /* ===== Выбрать кастомный язык (с обработкой ошибок) ===== */
  const selectCustom = useCallback(
    async (id: string) => {
      try {
        const dir = await getLanguagesDir()
        const path = await join(dir, id)
        if (!(await exists(path))) throw new Error('missing')
        const raw = await readTextFile(path)
        const dict = JSON.parse(raw) as Dict
        applyCustom(id, dict)
      } catch (e) {
        /* Файла нет или он битый: падаем на встроенный язык */
        console.error('Не удалось загрузить перевод:', e)
        const fallback = detectLang()
        setCustom(null)
        setLangState(fallback)
        setLangError('missing')
        writeSettingsRaw({ language: fallback }).catch(() => {})
        await refreshCustomLangs()
      }
    },
    [applyCustom, refreshCustomLangs]
  )

  /* ===== Открыть папку languages ===== */
  const openLanguagesFolder = useCallback(async () => {
    try {
      const dir = await getLanguagesDir()
      await invoke('reveal_item_in_dir', { path: dir })
    } catch (e) {
      console.error('Не удалось открыть папку languages:', e)
    }
  }, [])

  /* ===== При старте: читаем сохранённый язык + обработка "язык выбран, но его нет" ===== */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const raw = await readSettingsRaw().catch(() => ({} as Record<string, unknown>))
      const saved = (raw as Record<string, unknown>).language
      if (cancelled) return

      /* Встроенные языки есть всегда */
      if (saved === 'ru' || saved === 'en') {
        setLangState(saved)
        return
      }

      /* Кастомный язык: пробуем загрузить файл */
      if (typeof saved === 'string' && saved) {
        try {
          const dir = await getLanguagesDir()
          const path = await join(dir, saved)
          if (!(await exists(path))) throw new Error('missing')
          const text = await readTextFile(path)
          const dict = JSON.parse(text) as Dict 
          if (!cancelled) applyCustom(saved, dict)
        } catch {
          if (!cancelled) {
            console.warn(
              `[i18n] Язык "${saved}" не найден или повреждён. Переключаемся на встроенный.`
            )
            const fallback = detectLang()
            setLangError('missing')
            setLangState(fallback)
            writeSettingsRaw({ language: fallback }).catch(() => {})
          }
        }
      }
    })()
    refreshCustomLangs()
    return () => {
      cancelled = true
    }
  }, [applyCustom, refreshCustomLangs])

  const t = useCallback(
    (key: string, vars?: Record<string, unknown>) => {
      const isCustomActive = !!custom && custom.lang === lang
      const rawBase = isCustomActive ? custom.base : lang
      const baseLang = builtIn[rawBase] ? rawBase : 'ru' // защита от неизвестного языка
      const dicts = [isCustomActive ? custom.dict : undefined, builtIn[baseLang], builtIn.ru]

      let value: unknown
      for (const d of dicts) {
        value = lookup(d, key)
        if (value !== undefined) break
      }

      if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, string>
        const n = Number(vars?.count ?? vars?.n ?? 0)
        const form = pluralForm(baseLang, n)
        const template =
          obj[form] ??
          (baseLang === 'ru' ? obj.many : obj.other) ??
          obj.other ??
          obj.one ??
          Object.values(obj)[0] ??
          key
        return interpolate(template, vars)
      }

      if (typeof value === 'string') return interpolate(value, vars)
      return key
    },
    [lang, custom]
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t,
      customLangs,
      refreshCustomLangs,
      createTemplate,
      selectCustom,
      openLanguagesFolder,
      langError,
    }),
    [lang, setLang, t, customLangs, refreshCustomLangs, createTemplate, selectCustom, openLanguagesFolder, langError]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}