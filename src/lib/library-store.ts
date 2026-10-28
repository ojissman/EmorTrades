import path from 'path'
import { promises as fs } from 'fs'

/** Uploads live on local disk, outside git; served ONLY via /api/library/media. */
export const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5MB per image
/** Video files (the "Video" half of Screenshots & Video Library) are bigger
 *  by nature — they get their own, higher cap. */
export const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024 // 200MB per video
/** Audio recordings (Task B — trade evidence) get a middle cap: voice memos
 *  are small, but long session recordings need room. */
export const MAX_AUDIO_UPLOAD_BYTES = 50 * 1024 * 1024 // 50MB per audio recording

export const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
}

/** Per-mime upload cap — images 5MB, videos 200MB, audio 50MB. */
export function maxUploadBytesFor(mime: string): number {
  if (mime.startsWith('video/')) return MAX_VIDEO_UPLOAD_BYTES
  if (mime.startsWith('audio/')) return MAX_AUDIO_UPLOAD_BYTES
  return MAX_UPLOAD_BYTES
}

/** True when a library URL points at a video file (by extension).
 *  Note: .webm is ambiguous (audio/webm vs video/webm) — it is treated as
 *  video everywhere; browsers play either, so the mislabel is cosmetic. */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(?:$|\?)/i.test(url)
}

/** True when a library URL points at an audio recording (by extension).
 *  .webm is deliberately NOT matched — it stays on the video branch above. */
export function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|wav|ogg)(?:$|\?)/i.test(url)
}

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true })
}

export function extFromMime(mime: string): string | null {
  return ALLOWED_MIME[mime] ?? null
}

export function contentTypeForFilename(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? null
}

/** Screenshot.url is stored as /api/library/media/<filename> — extract + sanitize filename. */
export function filenameFromUrl(url: string): string | null {
  const prefix = '/api/library/media/'
  if (!url.startsWith(prefix)) return null
  const name = url.slice(prefix.length)
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null
  return name
}
