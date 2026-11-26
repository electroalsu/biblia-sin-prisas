import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin } from './admin.tsx'
import { backend, getVideos } from './backend.ts'
import { bookIds, names } from './books.ts'
import { dictionaries, type Messages } from './i18n.ts'
import {
  alignedVerse, type BookData, chapters, detectLanguage, editionById, editions, editionsIn, languageIds, languageKey,
  languages, type Language, loadState, type Location, move, normalize, type ReaderState, readLocal, saveState,
  shareLink, verses, visible, writeLocal,
} from './reader.ts'
import { matchVideos, type Video, youtubeChannel, youtubeVideo } from './videos.ts'
import './style.css'

const channel = youtubeChannel(import.meta.env.VITE_YOUTUBE_CHANNEL_URL ?? '')
const email = import.meta.env.VITE_CONTACT_EMAIL?.trim()
const isAdmin = /^\/admin\/?$/.test(window.location.pathname)
const bookRequests = new Map<string, Promise<BookData>>()
const storage = (() => {
  try { return window.localStorage }
  catch { return { getItem: () => null, setItem: () => {} } }
})()

function loadBook(book: string) {
  const cached = bookRequests.get(book)
  if (cached) return cached
  const pending = fetch(`${import.meta.env.BASE_URL}scripture/${book}.json`).then(response => {
    if (!response.ok) throw new Error('Scripture unavailable')
    return response.json() as Promise<BookData>
  }).catch(error => { bookRequests.delete(book); throw error })
  bookRequests.set(book, pending)
  return pending
}

function Modal({ title, onClose, children, closeText }: {
  title: string; onClose: () => void; children: ReactNode; closeText?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close() }
  }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-body">
      <div className="dialog-heading"><h2 id="dialog-title">{title}</h2>
        {closeText && <button type="button" className="icon-button" aria-label={closeText} onClick={onClose}>×</button>}
      </div>
      {children}
    </div>
  </dialog>
}

function Header({ lang, t, openLanguages }: { lang: Language; t: Messages; openLanguages: () => void }) {
  const media = <><span className="youtube-icon" aria-hidden="true" /><span>{channel ? t.channel : t.channelSoon}</span></>
  return <header className="site-header">
    <div className="page-shell header-content">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="Biblia sin prisas">
        <span className="book-mark" aria-hidden="true"><i /><i /></span>
        <span>Biblia sin prisas{lang !== 'es' && <small>{t.brand}</small>}</span>
      </a>
      <div className="header-actions">
        {channel ? <a className="channel-link" href={channel} target="_blank" rel="noreferrer">{media}</a>
          : <span className="channel-link channel-pending">{media}</span>}
        <button aria-label={t.language} className="language-trigger" onClick={openLanguages}>
          <span className="globe" aria-hidden="true" /><span>{languages[lang]}</span>
        </button>
      </div>
    </div>
  </header>
}

const sections = ['about', 'translations', 'publishers', 'contact', 'privacy'] as const
type Section = typeof sections[number]
const sectionFromUrl = () => sections.find(key => window.location.hash === `#${key}`)

function ProjectInfo({ section, t }: { section: Section; t: Messages }) {
  if (section === 'translations') return <>
    <p>{t.translationText}</p>
    <ul className="editions-list">{editions.map(edition => <li key={edition.id}>
      <strong lang={edition.lang}>{edition.name} · {edition.year}</strong>
      <div>{languages[edition.lang]} · {t.publisher} {edition.publisher}</div>
      <div className="info-links">
        <a href={edition.rights} target="_blank" rel="noreferrer">{t.license} · {edition.license}</a>
        <a href={edition.source} target="_blank" rel="noreferrer">{t.source}</a>
        <a href={edition.website} target="_blank" rel="noreferrer">{t.publisher}</a>
        {edition.purchase && <a href={edition.purchase} target="_blank" rel="noreferrer">{t.buy}</a>}
      </div>
    </li>)}</ul>
  </>
  if (section === 'contact') return <p>{email ? <a href={`mailto:${email}`}>{email}</a> : t.contactText}</p>
  return <p>{t[`${section === 'publishers' ? 'publisher' : section}Text`]}</p>
}

function Select({ label, value, options, change, className, disabled }: {
  label: string; value: string | number; options: [string | number, string | number][]
  change: (value: string) => void; className?: string; disabled?: boolean
}) {
  return <label className={className}>{label}<select value={value} disabled={disabled} onChange={event => change(event.target.value)}>
    {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select></label>
}

const optionsOf = (values: (string | number)[]): [string | number, string | number][] => values.map(value => [value, value])

function TranslationPicker({ id, lang, t, update }: {
  id: string; lang: Language; t: Messages; update: (id: string) => void
}) {
  const edition = editionById(id)
  const language = edition?.lang ?? lang
  const candidates = editionsIn(language)
  return <div className="translation-picker">
    <Select label={t.editionLanguage} options={languageIds.filter(code => editionsIn(code).length > 0)
      .map(code => [code, languages[code]])} value={language} change={value => {
        const first = editionsIn(value as Language)[0]
        if (first) update(first.id)
      }} />
    <Select label={t.edition}
      options={candidates.map(item => [item.id, `${item.name} · ${item.year}`])}
      value={id} change={update} />
  </div>
}

function VerseCell({ location, book, id, t }: {
  location: Location; book: BookData; id: string; t: Messages
}) {
  const edition = editionById(id)
  const data = book[id]
  const verse = alignedVerse(data, location)
  if (verse) return <p className="verse-text" lang={edition?.lang}>
    <sup>{verse.chapter !== location.chapter ? `${verse.chapter}:` : ''}{verse.verse}</sup>{verse.text}
  </p>
  const original = data?.native[location.chapter]
  return <div className="unmapped"><p>{t.unmapped}</p>
    {original && <details><summary>{t.original} · {location.chapter}</summary>
      <div lang={edition?.lang} className="original-text">
        {Object.entries(original).map(([number, text]) => <p key={number}><sup>{number}</sup>{text}</p>)}
      </div>
    </details>}
  </div>
}

function Media({ videos, places, lang, t, label }: {
  videos: Video[]; places: Location[]; lang: Language; t: Messages; label: (book: string) => string
}) {
  const { primary, additional } = matchVideos(videos, places)
  const title = (video: Video) => video.titles[lang] || video.title
  return <>
    {primary && <section className="media-section" aria-label={t.video}>
      <a className="video-card" href={youtubeVideo(primary.url)!} target="_blank" rel="noreferrer">
        <span className="video-emblem"><span className="youtube-icon" aria-hidden="true" /></span>
        <span><small>{t.video}</small><strong>{title(primary)}</strong>
          <span className="muted">{label(primary.book)} {primary.chapter}:{primary.start_verse}–{primary.end_verse}</span></span>
        <span className="video-cta">{t.watch}</span>
      </a>
    </section>}
    {additional.length > 0 && <section className="related-videos"><h3>{t.moreVideos}</h3><ul>
      {additional.map(video => <li key={video.id}>
        <a href={youtubeVideo(video.url)!} target="_blank" rel="noreferrer">{title(video)}</a>
      </li>)}
    </ul></section>}
  </>
}

function Reader({ lang, t }: { lang: Language; t: Messages }) {
  const [state, setState] = useState(() => loadState(storage, window.location.search))
  const [data, setData] = useState<Record<string, BookData>>({})
  const [failure, setFailure] = useState('')
  const [videos, setVideos] = useState<Video[]>([])
  const [videoError, setVideoError] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [copy, setCopy] = useState<keyof Messages>()
  const locations = visible(state)
  const last = locations.at(-1)!
  const openBooks = [...new Set(locations.map(place => place.book))].join(',')
  const size = { '--columns': state.columns, '--verse-size': `${state.size / 16}rem` } as CSSProperties
  const bookNames = names[lang].split('|')
  const name = (book: string) => bookNames[bookIds.indexOf(book)]
  const previous = move(state, -1)
  const next = move(state, 1)
  const range = last.book !== state.book ? `– ${name(last.book)} ${last.chapter}:${last.verse}`
    : last.chapter !== state.chapter ? `–${last.chapter}:${last.verse}`
    : last.verse !== state.verse ? `–${last.verse}` : ''
  const link = shareLink(window.location.href, state)

  useEffect(() => { saveState(storage, state) }, [state])
  useEffect(() => {
    let active = true
    Promise.all(openBooks.split(',').map(async book => [book, await loadBook(book)] as const))
      .then(entries => { if (active) { setData(Object.fromEntries(entries)); setFailure('') } })
      .catch(() => { if (active) setFailure(openBooks) })
    return () => { active = false }
  }, [openBooks])

  useEffect(() => {
    const client = backend
    if (!client) return
    let active = true
    let request = 0
    const refresh = async () => {
      const current = ++request
      try {
        const data = await getVideos()
        if (active && request === current) { setVideos(data); setVideoError(false) }
      } catch { if (active && request === current) setVideoError(true) }
    }
    const subscription = client.channel('reader-videos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'videos' }, () => { void refresh() })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refresh() })
    void refresh()
    window.addEventListener('focus', refresh)
    const interval = window.setInterval(refresh, 60000)
    return () => {
      active = false
      window.removeEventListener('focus', refresh)
      window.clearInterval(interval)
      void client.removeChannel(subscription)
    }
  }, [])

  function change(values: Partial<ReaderState>) {
    setState(old => normalize({ ...old, ...values }))
    if (new URLSearchParams(window.location.search).get('read') === '1') {
      const url = new URL(window.location.href)
      url.search = ''
      window.history.replaceState(null, '', url)
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopy('copied') }
    catch { setCopy('copyError') }
  }

  return <main className="page-shell reader">
    <section className="reader-intro">
      <h1>{name(state.book)} <span>{state.chapter}:{state.verse}{range}</span></h1>
      <p>{t.tagline}</p>
    </section>

    <div className="panel reader-settings">
      <Select label={t.book} value={state.book} options={bookIds.map((id, i) => [id, bookNames[i]])}
        change={book => change({ book, chapter: 1, verse: '1' })} className="book-select" />
      <Select label={t.chapter} value={state.chapter} options={optionsOf(chapters(state.book))}
        change={chapter => change({ chapter: +chapter, verse: '1' })} />
      <Select label={t.first} value={state.verse} options={optionsOf(verses(state.book, state.chapter))}
        change={verse => change({ verse })} />
      <Select label={t.verses} value={state.count} options={optionsOf([1, 2, 3, 4, 5])} change={count => change({ count: +count })} />
      <Select label={t.columns} value={state.columns} options={optionsOf([1, 2, 3])} change={columns => change({ columns: +columns })} />
      <div className="text-controls"><span>{t.textSize}</span><div className="size-buttons">
        <button aria-label={t.smaller} disabled={state.size <= 16} onClick={() => change({ size: Math.max(16, state.size - 2) })}>A−</button>
        <button aria-label={t.larger} disabled={state.size >= 32} onClick={() => change({ size: Math.min(32, state.size + 2) })}>A+</button>
      </div></div>
    </div>

    <section className="comparison" aria-labelledby="compare">
      <div className="comparison-heading"><h2 id="compare">{t.compare}</h2>
        {state.columns > 1 && <span className="scroll-hint">{t.scrollHint}</span>}</div>
      <div className="table-panel" tabIndex={0} aria-label={t.compare}>
        <table style={size}><thead><tr>
          {state.translations.slice(0, state.columns).map((id, i) => <th key={i} scope="col">
            <TranslationPicker id={id} lang={lang} t={t} update={chosen => {
              change({ translations: state.translations.map((value, position) => i === position ? chosen : value) })
            }} />
          </th>)}
        </tr></thead><tbody>
          {locations.map(place => <tr key={`${place.book}:${place.chapter}:${place.verse}`}>
            {state.translations.slice(0, state.columns).map((id, i) => <td key={i}>
              {(place.book !== state.book || place.chapter !== state.chapter) &&
                <span className="cross-chapter">{name(place.book)} {place.chapter}:{place.verse}</span>}
              {data[place.book] ? <VerseCell location={place} book={data[place.book]} id={id} t={t} />
                : <span className="muted" role="status">{failure === openBooks ? t.loadError : t.loading}</span>}
            </td>)}
          </tr>)}
        </tbody></table>
      </div>
    </section>

    <nav className="reading-nav" aria-label={t.reader}>
      <button disabled={!previous} onClick={() => previous && change(previous)}>{t.previous}</button>
      <button onClick={() => { setCopy(undefined); setSharing(true) }}>{t.share}</button>
      <button className="dark-button" disabled={!next} onClick={() => next && change(next)}>{t.next}</button>
    </nav>

    {videoError && <p className="muted" role="status">{t.videoError}</p>}
    <Media videos={videos} places={locations} lang={lang} t={t} label={name} />

    {sharing && <Modal title={t.share} closeText={t.close} onClose={() => setSharing(false)}>
      <input className="share-url" aria-label={t.share} value={link} readOnly dir="ltr" onFocus={event => event.target.select()} />
      <div className="button-row">
        <button className="dark-button" onClick={() => void copyLink()}>{t.copy}</button>
        {typeof navigator.share === 'function' && <button onClick={async () => {
          try { await navigator.share({ title: 'Biblia sin prisas', url: link }) }
          catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setCopy('copyError') }
        }}>{t.shareNative}</button>}
      </div>
      {copy && <p role="status">{t[copy]}</p>}
    </Modal>}
  </main>
}

function App() {
  const initial = readLocal(storage, languageKey)
  const [lang, setLang] = useState<Language>(() => detectLanguage(initial ? [initial] : navigator.languages))
  const [languageOpen, setLanguageOpen] = useState(!initial && !isAdmin)
  const [section, setSection] = useState<Section | undefined>(sectionFromUrl)
  const t = dictionaries[lang]
  useEffect(() => { document.documentElement.lang = lang }, [lang])

  useEffect(() => {
    const update = () => setSection(sectionFromUrl())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  function closeSection() {
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState(null, '', url)
    setSection(undefined)
  }

  function choose() {
    writeLocal(storage, languageKey, lang)
    setLanguageOpen(false)
  }

  return <>
    <Header lang={lang} t={t} openLanguages={() => setLanguageOpen(true)} />
    {isAdmin ? <Admin lang={lang} t={t} /> : <Reader lang={lang} t={t} />}
    <footer><div className="page-shell footer-content">
      <span className="footer-brand">Biblia sin prisas</span>
      <nav aria-label={t.about}>{sections.map(key => <a key={key} href={`#${key}`}>{t[key]}</a>)}</nav>
    </div></footer>
    {languageOpen && <Modal title={t.chooseLanguage} onClose={choose} closeText={t.close}>
      <div className="language-options">{languageIds.map(code => <button lang={code} key={code}
        aria-pressed={code === lang} onClick={() => setLang(code)}>{languages[code]}</button>)}</div>
      <button className="dark-button full-width" onClick={choose}>{t.continue}</button>
    </Modal>}
    {section && !languageOpen && <Modal title={t[section]} closeText={t.close} onClose={closeSection}>
      <ProjectInfo section={section} t={t} />
    </Modal>}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
