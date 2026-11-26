import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bookIds, names } from '../src/books.ts'
import { dictionaries } from '../src/i18n.ts'
import {
  alignedVerse, type BookData, defaults, detectLanguage, editionById, editions, editionsIn, languageIds, loadState,
  move, normalize, saveState, shareLink, verses, visible,
} from '../src/reader.ts'

const data = (book: string): BookData => JSON.parse(readFileSync(new URL(`../public/scripture/${book}.json`, import.meta.url), 'utf8'))
const location = (book: string, chapter: number, verse: string) => ({ book, chapter, verse })

test('all six locales include the interface, book names and at least one edition', () => {
  for (const lang of languageIds) {
    assert.equal(names[lang].split('|').length, bookIds.length)
    assert.ok(Object.values(dictionaries[lang]).every(Boolean))
    assert.ok(editionsIn(lang).length)
  }
  assert.equal(detectLanguage(['it-IT', 'pt-BR']), 'pt')
  assert.equal(detectLanguage(['it-IT']), 'en')
})

test('next advances the starting verse by one while keeping the window size', () => {
  assert.deepEqual(visible(defaults).map(place => place.verse), ['1','2','3'])
  const next = move(defaults, 1)!
  assert.deepEqual(visible({ ...defaults, ...next }).map(place => place.verse), ['2','3','4'])
  assert.deepEqual(move(next, -1), location('GEN', 1, '1'))
})

test('reading windows and navigation cross chapter and book boundaries in both directions', () => {
  const last = verses('GEN', 50).at(-1)!
  assert.deepEqual(move(location('GEN', 1, '31'), 1), location('GEN', 2, '1'))
  assert.deepEqual(move(location('GEN', 2, '1'), -1), location('GEN', 1, '31'))
  assert.deepEqual(visible({ ...defaults, ...location('GEN', 50, last) }), [
    location('GEN', 50, last), location('EXO', 1, '1'), location('EXO', 1, '2'),
  ])
  assert.deepEqual(move(location('EXO', 1, '1'), -1), location('GEN', 50, last))
  assert.equal(move(defaults, -1), null)
  const end = location('REV', 22, verses('REV', 22).at(-1)!)
  assert.equal(move(end, 1), null)
})

test('readers can select different editions of one language and keep hidden choices', () => {
  const state = normalize({ ...defaults, columns: 2, translations: ['rv1909', 'vbl', 'bsb'] })
  assert.deepEqual(state.translations, ['rv1909', 'vbl', 'bsb'])
  assert.equal(editionById(state.translations[0])?.lang, editionById(state.translations[1])?.lang)
  assert.equal(normalize({ ...state, columns: 3 }).translations[2], 'bsb')
})

test('edition lookup applies different native numbering and refuses an unverified match', () => {
  const genesis = data('GEN')
  const chapterChange = alignedVerse(genesis.luther, location('GEN', 31, '55'))
  assert.deepEqual(chapterChange, { chapter: 32, verse: '1', text: genesis.luther.native[32]['1'] })
  const philippians = data('PHP')
  assert.equal(alignedVerse(philippians.vbl, location('PHP', 1, '16'))?.verse, '17')
  const corinthians = data('2CO')
  assert.equal(alignedVerse(corinthians.bes, location('2CO', 13, '13')), null)
  assert.ok(corinthians.bes.native[13]['13'])
})

test('saved settings are restored and a shared link takes precedence for its reading fields', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: values.set.bind(values) }
  const saved = { ...defaults, ...location('EXO', 2, '4'), size: 24, columns: 1, count: 5 }
  saveState(storage, saved)
  assert.deepEqual(loadState(storage, ''), saved)
  const shared = { ...defaults, ...location('JHN', 3, '16'), columns: 3, count: 2,
    translations: ['web', 'bsb', 'blivre'] }
  const url = new URL(shareLink('https://example.test/?old=1#text', shared))
  assert.equal(url.hash, '')
  assert.equal(url.searchParams.get('langs'), 'en,en,pt')
  assert.deepEqual(loadState(storage, url.search), { ...shared, size: saved.size })
})

test('invalid parameters and unavailable storage fall back safely', () => {
  const storage = { getItem: () => { throw new Error('Storage disabled') } }
  assert.deepEqual(loadState(storage, ''), defaults)
  assert.deepEqual(loadState(storage, '?read=1&book=xyz&chapter=0&verse=1000&count=8&columns=4&editions=wrong'), defaults)
})

test('every bundled edition includes all 66 books and every explicit mapping resolves', () => {
  const complete = ['rv1909', 'bes', 'web', 'vbl', 'luther', 'synodal', 'martin', 'blivre', 'bsb']
  for (const book of bookIds) {
    const source = data(book)
    for (const edition of editions) {
      const entry = source[edition.id]
      if (complete.includes(edition.id)) assert.ok(Object.keys(entry?.native ?? {}).length > 0, `${edition.id} ${book}`)
      if (!entry) continue
      for (const [chapter, map] of Object.entries(entry.aligned)) {
        if (map === 'same') {
          for (const verse of verses(book, +chapter)) assert.ok(alignedVerse(entry, location(book, +chapter, verse)))
        } else {
          for (const verse of Object.keys(map)) assert.ok(alignedVerse(entry, location(book, +chapter, verse)))
        }
      }
    }
  }
})
