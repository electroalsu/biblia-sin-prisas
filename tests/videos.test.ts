import assert from 'node:assert/strict'
import test from 'node:test'
import { defaults, visible } from '../src/reader.ts'
import { matchVideos, type Video, validVideo, youtubeChannel, youtubeVideo } from '../src/videos.ts'

// Synthetic identifiers are for tests only. The application includes no video seed records.
const video = (id: string, start: number, end: number, url = `https://youtu.be/${id.padEnd(11, 'x')}`): Video => ({
  id, title: id, url, book: 'GEN', chapter: 1, start_verse: start, end_verse: end, titles: { es: 'Título' },
})

test('the first visible verse picks the main video and later verses pick compact links', () => {
  const first = video('first', 1, 1)
  const second = video('second', 2, 3)
  const third = video('third', 4, 5)
  const videos = [third, second, first]
  assert.deepEqual(matchVideos(videos, visible(defaults)), { primary: first, additional: [second] })
  assert.deepEqual(matchVideos(videos, visible({ ...defaults, verse: '2' })), { primary: second, additional: [third] })
  assert.deepEqual(matchVideos(videos, visible({ ...defaults, count: 1 })), { primary: first, additional: [] })
})

test('missing primary matches do not promote later videos, and no matches produce no cards', () => {
  const secondary = video('second', 2, 3)
  assert.deepEqual(matchVideos([secondary], visible(defaults)), { primary: undefined, additional: [secondary] })
  assert.deepEqual(matchVideos([secondary], visible({ ...defaults, chapter: 2 })), { primary: undefined, additional: [] })
})

test('overlapping ranges prefer the narrower match and duplicates are linked once', () => {
  const broad = video('broad', 1, 8)
  const narrow = video('narrow', 1, 3)
  const duplicate = video('duplicate', 4, 4, narrow.url)
  assert.deepEqual(matchVideos([broad, duplicate, narrow], visible({ ...defaults, count: 4 })),
    { primary: narrow, additional: [] })
})

test('URL and range validation rejects unrelated and malformed links', () => {
  assert.ok(validVideo(video('first', 1, 4)))
  assert.equal(validVideo(video('first', 3, 2)), false)
  assert.equal(validVideo(video('first', 1, 99)), false)
  assert.equal(youtubeVideo('https://youtu.be.evil.test/xxxxxxxxxxx'), null)
  assert.equal(youtubeVideo('https://youtu.be/xxxxxxxxxxx?si=test'), 'https://www.youtube.com/watch?v=xxxxxxxxxxx')
  assert.equal(youtubeChannel('https://www.youtube.com/watch?v=xxxxxxxxxxx'), null)
  assert.ok(youtubeChannel('https://www.youtube.com/@test-channel'))
})
