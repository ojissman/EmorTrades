import { NextResponse } from 'next/server'
import { withClearedSession } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/** POST /api/auth/logout — clears the session cookie. Always 200. */
export async function POST() {
  return withClearedSession(NextResponse.json({ ok: true, message: 'Signed out.' }))
}
