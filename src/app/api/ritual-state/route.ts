/**
 * /api/ritual-state — ENFORCE-4's public window (owner-visible in preview).
 *
 * Public by design: it carries no secrets, no user data, no DB access — only
 * the ritual drift verdict (git + .sync-state). During DRIFT this route is
 * what the lock page polls; a 10s memo keeps multi-tab polling cheap while
 * staying near-live (the lock must lift within seconds of sync:prod landing).
 */
import { NextResponse } from 'next/server'
import { computeRitualState } from '@/lib/ritual-guard'

export const dynamic = 'force-dynamic'

let memo: { at: number; body: ReturnType<typeof computeRitualState> } | null = null
const MEMO_MS = 10_000

export async function GET() {
  const now = Date.now()
  if (!memo || now - memo.at > MEMO_MS) {
    memo = { at: now, body: computeRitualState(process.cwd()) }
  }
  return NextResponse.json(memo.body, {
    headers: { 'cache-control': 'no-store' },
  })
}
