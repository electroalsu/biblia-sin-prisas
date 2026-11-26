import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const internal = path => new URL(path, root)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isLink = value => typeof value === 'string' && /^https:\/\/[^/\s]+/.test(value)
const isVerse = value => /^\d+[a-z]?(?:[-–]\d+[a-z]?)?$/i.test(value)
const isChapter = value => /^[1-9]\d*$/.test(value)
const fail = message => { throw new Error(message) }

async function run(file) {
  if (!file) fail('Usage: node scripts/add-edition.mjs <edition.json>')
  const { edition, books } = await read(file)
  const catalog = await read(internal('src/catalog.json'))
  const structure = await read(internal('src/structure.json'))
  if (!isObject(edition) || !/^[a-z0-9][a-z0-9-]*$/.test(edition.id ?? '') ||
      !['es', 'en', 'ru', 'pt', 'fr', 'de'].includes(edition.lang) ||
      !['name', 'year', 'publisher', 'license'].every(key => typeof edition[key] === 'string' && edition[key].trim()) ||
      !['source', 'rights', 'website'].every(key => isLink(edition[key])) ||
      (edition.purchase && !isLink(edition.purchase))) fail('Missing or invalid edition metadata.')
  if (catalog.some(item => item.id === edition.id)) fail('Use a new ID for each distinct edition.')
  if (!isObject(books) || !Object.keys(books).length) fail('No books found in the import.')

  for (const [book, data] of Object.entries(books)) {
    const location = structure[book]
    if (!Object.hasOwn(structure, book) || !isObject(data?.native) || !isObject(data?.aligned)) {
      fail(`Invalid edition data for ${book}.`)
    }
    for (const [chapter, verses] of Object.entries(data.native)) {
      if (!isChapter(chapter) || !isObject(verses)) fail(`Invalid chapter ${book} ${chapter}.`)
      for (const [verse, text] of Object.entries(verses)) {
        if (!isVerse(verse) || typeof text !== 'string' || !text.trim()) fail(`Invalid verse ${book} ${chapter}:${verse}.`)
      }
    }
    for (const [chapter, mapping] of Object.entries(data.aligned)) {
      if (!Object.hasOwn(location, chapter)) fail(`Unknown reference chapter ${book} ${chapter}.`)
      if (mapping === 'same') {
        if (!location[chapter].every(verse => data.native[chapter]?.[verse])) {
          fail(`Matching labels missing from ${book} ${chapter}.`)
        }
        continue
      }
      if (!isObject(mapping)) fail(`Invalid mapping in ${book} ${chapter}.`)
      for (const [verse, reference] of Object.entries(mapping)) {
        if (!location[chapter].includes(verse) || !Array.isArray(reference) || reference.length !== 2 ||
            !Number.isInteger(reference[0]) || typeof reference[1] !== 'string' || !isVerse(reference[1]) ||
            !data.native[reference[0]]?.[reference[1]]) fail(`Invalid mapping for ${book} ${chapter}:${verse}.`)
      }
    }
  }

  // Validate the entire import before writing. The catalog is written last,
  // so a retry can replace data from an interrupted import of the same ID.
  for (const [book, data] of Object.entries(books)) {
    const path = internal(`public/scripture/${book}.json`)
    const existing = await read(path)
    existing[edition.id] = data
    await writeFile(path, JSON.stringify(existing) + '\n')
  }
  await writeFile(internal('src/catalog.json'), JSON.stringify([...catalog, edition], null, 2) + '\n')
  console.log(`Added ${edition.name} (${Object.keys(books).length} books).`)
}

run(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })
