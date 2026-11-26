import { type Language, type Location, verseStart, verses } from './reader.ts'

export interface VideoInput {
  title: string
  url: string
  book: string
  chapter: number
  start_verse: number
  end_verse: number
  titles: Partial<Record<Language, string>>
}
export interface Video extends VideoInput { id: string }

function httpsUrl(raw: string) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null
  } catch { return null }
}

export function youtubeVideo(raw: string) {
  const url = httpsUrl(raw)
  if (!url) return null
  const path = url.pathname.split('/').filter(Boolean)
  const isYoutube = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
  const id = url.hostname === 'youtu.be' && path.length === 1 ? path[0]
    : isYoutube && url.pathname === '/watch' ? url.searchParams.get('v')
    : isYoutube && ['shorts', 'live'].includes(path[0]) && path.length === 2 ? path[1] : null
  return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null
}

export function youtubeChannel(raw: string) {
  const url = httpsUrl(raw)
  return url && ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
    && /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/?$/.test(url.pathname) ? url.href : null
}

export function validVideo(video: VideoInput) {
  const numbers = verses(video.book, video.chapter).map(verseStart)
  return Number.isInteger(video.chapter) && !!video.title.trim() && !!youtubeVideo(video.url)
    && numbers.includes(video.start_verse) && numbers.includes(video.end_verse)
    && video.start_verse <= video.end_verse
}

export function matchVideos(videos: Video[], locations: Location[]) {
  const rank = (a: Video, b: Video) =>
    (a.end_verse - a.start_verse) - (b.end_verse - b.start_verse) || a.id.localeCompare(b.id)
  const seen = new Set<string>()
  const additional: Video[] = []
  let primary: Video | undefined
  locations.forEach((location, i) => {
    const verse = verseStart(location.verse)
    const winner = videos.filter(video => video.book === location.book && video.chapter === location.chapter
      && verse >= video.start_verse && verse <= video.end_verse).sort(rank)[0]
    const link = winner && youtubeVideo(winner.url)
    if (!winner || !link || seen.has(link)) return
    seen.add(link)
    if (i === 0) primary = winner
    else additional.push(winner)
  })
  return { primary, additional }
}
