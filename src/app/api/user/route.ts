import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// Task 120 — the Profile card finally gets real persistence (it toasted
// "demo mode" for four rounds). Same read shape as /api/seed's user select so
// the settings page can point at either; the PATCH is partial-friendly with
// the same grammar as the goals/accounts routes: only fields present in the
// body are written, numeric fields are range-guarded, email is validated and
// uniqueness-checked against OTHER users.

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  startingCapital: true,
  riskPerTrade: true,
  timezone: true,
  defaultCurrency: true,
  googleId: true,
  passwordHash: true,
} as const

export async function GET() {
  try {
    const auth = await requireUser({ select: USER_SELECT })
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Derived booleans only — the raw googleId / password hash never leave the server.
    const { googleId, passwordHash, ...safe } = user
    return NextResponse.json({ user: { ...safe, googleLinked: Boolean(googleId), hasPassword: Boolean(passwordHash) } })
  } catch (e: any) {
    console.error('GET /api/user error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      }
      data.name = name
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
      }
      if (email !== user.email) {
        // AUTH-2: changing the sign-in email re-proves identity with the
        // current password (Google-only accounts are exempt — no password).
        if (user.passwordHash) {
          const { verifyPassword } = await import('@/lib/server/auth')
          const currentOk = verifyPassword(String(body.currentPassword ?? ''), user.passwordHash)
          if (!currentOk) {
            return NextResponse.json({ error: 'Enter your current password to change the email' }, { status: 403 })
          }
        }
        const clash = await db.user.findFirst({ where: { email, id: { not: user.id } } })
        if (clash) {
          return NextResponse.json({ error: 'That email is already in use' }, { status: 409 })
        }
        // Already-verified owner moves their verified status along (password
        // proof above); a pending-verification account keeps pending status.
        if (user.emailVerified) data.emailVerified = new Date()
      }
      data.email = email
    }
    if (body.startingCapital !== undefined) {
      const v = Number(body.startingCapital)
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json(
          { error: 'Starting capital must be a non-negative number' },
          { status: 400 }
        )
      }
      data.startingCapital = v
    }
    if (body.riskPerTrade !== undefined) {
      const v = Number(body.riskPerTrade)
      if (!Number.isFinite(v) || v <= 0 || v > 100) {
        return NextResponse.json(
          { error: 'Risk per trade must be a percentage between 0 and 100' },
          { status: 400 }
        )
      }
      data.riskPerTrade = v
    }
    if (body.timezone !== undefined) {
      data.timezone = String(body.timezone)
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data,
      select: USER_SELECT,
    })
    return NextResponse.json({ user: updated })
  } catch (e: any) {
    console.error('PATCH /api/user error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}
