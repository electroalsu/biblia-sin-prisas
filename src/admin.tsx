import { useEffect, useState, type FormEvent } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { backend, getVideos } from './backend.ts'
import { bookIds, names } from './books.ts'
import type { Messages } from './i18n.ts'
import { chapters, languageIds, languages, type Language, verseStart, verses } from './reader.ts'
import { type Video, type VideoInput, validVideo, youtubeVideo } from './videos.ts'

const empty: VideoInput = { title: '', url: '', book: 'GEN', chapter: 1, start_verse: 1, end_verse: 1, titles: {} }

export function Admin({ lang, t }: { lang: Language; t: Messages }) {
  const [access, setAccess] = useState<'checking' | 'signedOut' | 'owner' | 'denied' | 'failed'>('checking')
  const [list, setList] = useState<Video[]>([])
  const [form, setForm] = useState<VideoInput | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [status, setStatus] = useState<keyof Messages | null>(null)
  const [busy, setBusy] = useState(false)
  const bookNames = names[lang].split('|')

  useEffect(() => {
    const client = backend
    if (!client) return
    let active = true
    let generation = 0
    async function update(_event: AuthChangeEvent, session: Session | null) {
      const current = ++generation
      if (!session) { setAccess('signedOut'); return }
      const result = await client!.rpc('is_video_owner')
      if (!active || current !== generation) return
      setAccess(result.error ? 'failed' : result.data ? 'owner' : 'denied')
    }
    const { data } = client.auth.onAuthStateChange((event, session) => {
      // Auth API calls run outside the auth callback.
      setTimeout(() => { if (active) void update(event, session) }, 0)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (access !== 'owner') return
    let active = true
    getVideos().then(data => { if (active) setList(data) }).catch(() => { if (active) setStatus('videoError') })
    return () => { active = false }
  }, [access])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setBusy(true)
    setStatus(null)
    try {
      const { error } = await backend!.auth.signInWithPassword({
        email: String(values.get('email')), password: String(values.get('password')),
      })
      if (error) setStatus('adminError')
    } catch { setStatus('adminError') } finally { setBusy(false) }
  }

  async function mutate(event?: FormEvent<HTMLFormElement>, remove?: string) {
    event?.preventDefault()
    if (access !== 'owner' || busy || !backend) return
    if (remove && !window.confirm(t.confirmRemove)) return
    const url = form && youtubeVideo(form.url.trim())
    if (!remove && (!form || !url || !validVideo(form))) { setStatus('videoInput'); return }
    setBusy(true)
    setStatus(null)
    try {
      const table = backend.from('videos')
      if (remove) {
        const { data, error } = await table.delete().eq('id', remove).select('id').single()
        if (error || !data) throw error ?? new Error('Delete failed')
        setList(previous => previous.filter(video => video.id !== remove))
      } else if (form && url) {
        const payload = { ...form, title: form.title.trim(), url,
          titles: Object.fromEntries(languageIds.flatMap(code => {
            const title = form.titles[code]?.trim()
            return title ? [[code, title]] : []
          })) }
        const result = await (id ? table.update(payload).eq('id', id) : table.insert(payload)).select().single()
        if (result.error) throw result.error
        setList(previous => [...previous.filter(video => video.id !== id), result.data as Video])
        setStatus('saved')
      }
      setForm(null)
      setId(null)
    } catch { setStatus('adminError') } finally { setBusy(false) }
  }

  function edit(video?: Video) {
    if (video) {
      const { id: videoId, ...fields } = video
      setId(videoId)
      setForm(fields)
    } else {
      setId(null)
      setForm(empty)
    }
    setStatus(null)
  }

  return <main className="admin page-shell">
    <h1>{t.admin}</h1>
    {!backend && <p>{t.adminSetup}</p>}
    {backend && access === 'signedOut' && <form className="admin-form panel" onSubmit={login}>
      <label>{t.email}<input required type="email" name="email" autoComplete="username" /></label>
      <label>{t.password}<input required type="password" name="password" autoComplete="current-password" /></label>
      <button className="dark-button" disabled={busy}>{t.signIn}</button>
    </form>}
    {backend && access === 'checking' && <p role="status">{t.loading}</p>}
    {access === 'denied' && <p>{t.accessDenied}</p>}
    {access === 'failed' && <p>{t.adminError}</p>}
    {['owner', 'denied', 'failed'].includes(access) && <button onClick={async () => {
      const result = await backend?.auth.signOut()
      if (result?.error) { setStatus('adminError'); return }
      setForm(null); setId(null); setList([]); setStatus(null)
    }}>{t.signOut}</button>}
    {status && <p role="status">{t[status]}</p>}
    {access === 'owner' && <>
      <button type="button" onClick={() => edit()}>{t.newVideo}</button>
      {form && <form className="admin-form panel" onSubmit={mutate}>
        <p>{t.videoInput}</p>
        <label>{t.title}<input required maxLength={300} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>{t.url}<input required type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
        <div className="admin-grid">
          <label>{t.book}<select value={form.book} onChange={e => setForm({ ...form, book: e.target.value, chapter: 1, start_verse: 1, end_verse: 1 })}>
            {bookIds.map((book, i) => <option key={book} value={book}>{bookNames[i]}</option>)}
          </select></label>
          <label>{t.chapter}<select value={form.chapter} onChange={e => setForm({ ...form, chapter: +e.target.value, start_verse: 1, end_verse: 1 })}>
            {chapters(form.book).map(c => <option key={c}>{c}</option>)}
          </select></label>
          {(['start_verse', 'end_verse'] as const).map((field, i) => <label key={field}>{i ? t.end : t.start}
            <select value={form[field]} onChange={e => setForm({ ...form, [field]: +e.target.value })}>
              {[...new Set(verses(form.book, form.chapter).map(verseStart))].map(n => <option key={n}>{n}</option>)}
            </select>
          </label>)}
        </div>
        <div className="admin-grid">{languageIds.map(code =>
          <label key={code}>{t.title} · {languages[code]}<input maxLength={300} value={form.titles[code] ?? ''}
            onChange={e => setForm({ ...form, titles: { ...form.titles, [code]: e.target.value } })} /></label>
        )}</div>
        <div className="button-row"><button className="dark-button" disabled={busy}>{t.save}</button>
          <button type="button" onClick={() => setForm(null)} disabled={busy}>{t.cancel}</button></div>
      </form>}
      <ul className="video-list">{list.map(video => <li key={video.id}>
        <div><strong>{video.titles[lang] || video.title}</strong><br />{bookNames[bookIds.indexOf(video.book)]} {video.chapter}:{video.start_verse}–{video.end_verse}</div>
        <div className="button-row"><button disabled={busy} onClick={() => edit(video)}>{t.edit}</button>
          <button disabled={busy} onClick={() => void mutate(undefined, video.id)}>{t.remove}</button></div>
      </li>)}</ul>
    </>}
  </main>
}
