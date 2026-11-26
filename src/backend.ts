import { createClient } from '@supabase/supabase-js'
import type { Video } from './videos.ts'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const backend = url && key ? createClient(url, key, {
  auth: { detectSessionInUrl: false },
}) : null

export async function getVideos(): Promise<Video[]> {
  if (!backend) return []
  const result: Video[] = []
  const pageSize = 500
  while (true) {
    const { data, error } = await backend.from('videos').select('*').order('id')
      .range(result.length, result.length + pageSize - 1)
    if (error) throw error
    result.push(...data as Video[])
    if (data.length < pageSize) return result
  }
}
