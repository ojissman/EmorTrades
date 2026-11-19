/**
 * PREVIEW-2 — the rotating preview origin family (CSRF gate regression).
 *
 * The bug (2026-11-19, owner report "forbidden when creating the MT5/MT4
 * connection"): the platform's preview URL rotates every chat session, so
 * the pinned DEV_ORIGIN — a dead URL from an earlier session — made the
 * auth gate's exact-pin test answer 403 "Cross-origin request rejected"
 * for every state-changing route in the live preview, while same-origin
 * GETs (no Origin header) kept working. previewOriginFamily() derives the
 * family from any preview-shaped pin so the gate accepts the CURRENT
 * session's preview origin; everything genuinely foreign stays blocked.
 *
 * origin.ts is pure (no next/* imports), so this suite exercises the real
 * gate decision table without the Next request machinery.
 */
import { describe, it, expect } from 'vitest'
import { previewOriginFamily, resolvePinnedOrigin } from '@/lib/server/origin'

const STALE_PIN = 'https://preview-chat-b37b825a-aaa6-4d77-8853-a050f66c976c.space-z.ai'
const PROD_PIN = 'https://emortrade.space-z.ai'
const CURRENT = 'https://preview-chat-81f5aaa7-634e-47c0-904b-a7b97b5055e7.space-z.ai'

/** The exact decision table crossOriginBlocked() runs, with the family in place. */
function gateBlocked(origin: string | null, pinsRaw: readonly string[]): boolean {
  const pins = pinsRaw.map((p) => p.trim().replace(/\/+$/, '')).filter(Boolean)
  if (pins.length === 0) return false
  if (!origin) return false
  const normalized = origin.trim().replace(/\/+$/, '')
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return false
  if (previewOriginFamily(pins)?.test(normalized)) return false
  return !pins.includes(normalized)
}

describe('previewOriginFamily — rotating preview URL acceptance', () => {
  it('derives the family from a preview-shaped pin (stale pin still yields it)', () => {
    const fam = previewOriginFamily([PROD_PIN, STALE_PIN])
    expect(fam).not.toBeNull()
    expect(fam!.test(CURRENT)).toBe(true) // the live session origin — the bug
    expect(fam!.test(STALE_PIN)).toBe(true)
    expect(fam!.source).toBe('^https:\\/\\/preview-chat-[a-z0-9-]+\\.space-z\\.ai$') // source escapes "/"
  })

  it('keeps foreign origins, foreign preview domains and wrong shapes blocked', () => {
    const fam = previewOriginFamily([STALE_PIN])!
    expect(fam.test('https://evil.example.com')).toBe(false)
    expect(fam.test('https://preview-chat-evil.evil.com')).toBe(false) // preview prefix, foreign root
    expect(fam.test('https://preview-chat-x.space-z.ai.evil.com')).toBe(false) // suffix trick
    expect(fam.test('https://chat-81f5aaa7-634e-47c0-904b-a7b97b5055e7.space-z.ai')).toBe(false) // wrong prefix
    expect(fam.test('http://preview-chat-81f5aaa7-634e-47c0-904b-a7b97b5055e7.space-z.ai')).toBe(false) // http not https
    expect(fam.test('https://emortrade.space-z.ai')).toBe(false) // prod pin is not family-shaped
  })

  it('returns null when no pin carries the preview pattern (gate unchanged)', () => {
    expect(previewOriginFamily([PROD_PIN])).toBeNull()
    expect(previewOriginFamily([])).toBeNull()
  })

  it('gate decision matrix: current/pins/localhost pass, foreign and absent behave', () => {
    const pins = [STALE_PIN, PROD_PIN]
    expect(gateBlocked(CURRENT, pins)).toBe(false) // PREVIEW-2 fix
    expect(gateBlocked(STALE_PIN, pins)).toBe(false) // exact pin (as before)
    expect(gateBlocked(PROD_PIN, pins)).toBe(false) // exact prod pin (as before)
    expect(gateBlocked(null, pins)).toBe(false) // no Origin (same-origin GET) — gate not armed
    expect(gateBlocked('http://localhost:3000', pins)).toBe(false) // local dev
    expect(gateBlocked('https://evil.example.com', pins)).toBe(true) // foreign origin still blocked
    expect(gateBlocked('https://preview-chat-x.evil.com', pins)).toBe(true) // foreign preview root
    expect(gateBlocked(CURRENT, [])).toBe(false) // unpinned deployment — gate disarmed (historical)
  })

  it('resolvePinnedOrigin exact-pin behaviour is untouched', () => {
    expect(
      resolvePinnedOrigin({ NODE_ENV: 'development', DEV_ORIGIN: STALE_PIN, PUBLIC_ORIGIN: PROD_PIN }),
    ).toBe(STALE_PIN)
    expect(
      resolvePinnedOrigin({ NODE_ENV: 'production', DEV_ORIGIN: STALE_PIN, PUBLIC_ORIGIN: PROD_PIN }),
    ).toBe(PROD_PIN)
    expect(resolvePinnedOrigin({ NODE_ENV: 'development', PUBLIC_ORIGIN: PROD_PIN })).toBe(PROD_PIN)
  })
})
