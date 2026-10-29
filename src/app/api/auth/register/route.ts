import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, withSessionCookie } from '@/lib/server/auth'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register — create a new account (unlimited users) and
 * immediately start a session. Bootstraps the minimum rows the app needs:
 * UserSettings + one default trading account, so a fresh user lands on a
 * working (empty) journal instead of null-pointer screens.
 *
 * First-ever user is promoted to ADMIN automatically (fresh-install safety);
 * afterwards everyone registers as USER and only an admin can promote.
 */

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
})

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`register:${clientIp(req)}`, 5, 15 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = RegisterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { name, email, password } = parsed.data

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return NextResponse.json(
        { error: 'Email taken', message: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      )
    }

    const userCount = await db.user.count()
    const isFirstUser = userCount === 0

    const user = await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        role: isFirstUser ? 'ADMIN' : 'USER',
        status: 'ACTIVE',
        settings: { create: {} }, // UserSettings has safe defaults
        accounts: {
          create: { name: 'Main Account', broker: 'Manual', type: 'stock', startingBalance: 10000 },
        },
      },
      select: { id: true, name: true, email: true, role: true, status: true },
    })

    return withSessionCookie(
      NextResponse.json({ user, message: `Welcome aboard, ${name}!` }, { status: 201 }),
      user.id
    )
  } catch (e: any) {
    // Unique race on email (P2002) — treat as taken
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Email taken', message: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      )
    }
    console.error('POST /api/auth/register error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not create your account. Please try again.' }, { status: 500 })
  }
}
