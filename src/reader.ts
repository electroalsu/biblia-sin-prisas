import catalog from './catalog.json' with { type: 'json' }
import structure from './structure.json' with { type: 'json' }
import { bookIds } from './books.ts'

export const languages = { es: 'Español', en: 'English', ru: 'Русский', pt: 'Português', fr: 'Français', de: 'Deutsch' }
export type Language = keyof typeof languages
export const languageIds = Object.keys(languages) as Language[]
export const editions = catalog as (Omit<(typeof catalog)[number], 'lang'> & { lang: Language; purchase?: string })[]
const index: Record<string, Record<string, string[]>> = structure
export const verses = (book: string, chapter: number) => index[book]?.[chapter] ?? []
export const chapters = (book: string) => Object.keys(index[book] ?? {}).map(Number)

export interface Location {
  book: string
  chapter: number
  verse: string
}
export interface ReaderState extends Location {
  count: number
  columns: number
  translations: string[]
  size: number
}

export function detectLanguage(preferences: readonly string[]): Language {
  return preferences.map(value => value.toLowerCase().split('-')[0])
    .find((value): value is Language => Object.hasOwn(languages, value)) ?? 'en'
}

export const defaults: ReaderState = {
  book: 'GEN', chapter: 1, verse: '1', count: 3, columns: 3,
  translations: ['rv1909', 'web', 'synodal'], size: 19,
}
const storageKey = 'biblia-sin-prisas.reader.v1'
export const languageKey = 'biblia-sin-prisas.language.v1'
export const editionsIn = (language: Language) => editions.filter(edition => edition.lang === language)
export const editionById = (id: string) => editions.find(edition => edition.id === id)

function integer(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback
}

export function normalize(value: unknown): ReaderState {
  const input = value && typeof value === 'object' ? value as Partial<ReaderState> : {}
  const book = typeof input.book === 'string' && bookIds.includes(input.book) ? input.book : defaults.book
  const chapter = integer(input.chapter, 1, chapters(book).length, 1)
  const available = verses(book, chapter)
  const verse = typeof input.verse === 'string' && available.includes(input.verse) ? input.verse : available[0]
  const translations = defaults.translations.map((fallback, i) => {
    const id = Array.isArray(input.translations) ? input.translations[i] : undefined
    return editionById(id ?? '')?.id ?? fallback
  })
  return { book, chapter, verse, translations,
    count: integer(input.count, 1, 5, defaults.count),
    columns: integer(input.columns, 1, 3, defaults.columns),
    size: integer(input.size, 16, 32, defaults.size) }
}

export function readLocal(storage: Pick<Storage, 'getItem'>, key: string) {
  try { return storage.getItem(key) } catch { return null }
}

export function writeLocal(storage: Pick<Storage, 'setItem'>, key: string, value: string) {
  try { storage.setItem(key, value) } catch { /* The reader also works with storage disabled. */ }
}

export function loadState(storage: Pick<Storage, 'getItem'>, search: string): ReaderState {
  let local: ReaderState = defaults
  try { local = normalize(JSON.parse(readLocal(storage, storageKey) ?? 'null')) } catch { /* Ignore damaged settings. */ }
  const query = new URLSearchParams(search)
  if (query.get('read') !== '1') return local
  return normalize({
    ...defaults, size: local.size,
    book: query.get('book'), chapter: query.get('chapter'), verse: query.get('verse'),
    count: query.get('count'), columns: query.get('columns'),
    translations: query.get('editions')?.split(',') ?? [],
  })
}

export function saveState(storage: Pick<Storage, 'setItem'>, state: ReaderState) {
  writeLocal(storage, storageKey, JSON.stringify(state))
}

export function shareLink(href: string, state: ReaderState) {
  const url = new URL(href)
  url.hash = ''
  url.search = new URLSearchParams({
    read: '1', book: state.book, chapter: String(state.chapter), verse: state.verse,
    count: String(state.count), columns: String(state.columns),
    editions: state.translations.slice(0, state.columns).join(','),
    langs: state.translations.slice(0, state.columns).map(id => editionById(id)?.lang).join(','),
  }).toString()
  return url.toString()
}

export function move(location: Location, direction: -1 | 1): Location | null {
  let { book, chapter } = location
  let list = verses(book, chapter)
  const next = list[list.indexOf(location.verse) + direction]
  if (next) return { book, chapter, verse: next }
  chapter += direction
  if (!verses(book, chapter).length) {
    book = bookIds[bookIds.indexOf(book) + direction]
    if (!book) return null
    chapter = direction === 1 ? 1 : chapters(book).at(-1)!
  }
  list = verses(book, chapter)
  return { book, chapter, verse: direction === 1 ? list[0] : list.at(-1)! }
}

export function visible(state: ReaderState): Location[] {
  const result: Location[] = []
  let location: Location | null = state
  while (location && result.length < state.count) {
    result.push({ book: location.book, chapter: location.chapter, verse: location.verse })
    location = move(location, 1)
  }
  return result
}

export interface EditionBook {
  native: Record<string, Record<string, string>>
  aligned: Record<string, 'same' | Record<string, [number, string]>>
}
export type BookData = Record<string, EditionBook>

export function alignedVerse(data: EditionBook | undefined, location: Location) {
  const alignment = data?.aligned[location.chapter]
  const reference = alignment === 'same' ? [location.chapter, location.verse] as const : alignment?.[location.verse]
  if (!reference) return null
  const text = data?.native[reference[0]]?.[reference[1]]
  return text ? { chapter: reference[0], verse: reference[1], text } : null
}

export function verseStart(verse: string) {
  return Number(/^\d+/.exec(verse)?.[0])
}
