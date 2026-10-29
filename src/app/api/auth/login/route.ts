import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, withSessionCookie } from '@/lib/server/auth'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login — email + password sign-in. Issues a 30-day httpOnly
 * session cookie. Suspended accounts get a clear 403 (the cookie is never
 * set). Rate limited to blunt password-guessing.
 */

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many sign-in attempts. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { email, password } = parsed.data

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: 'Invalid credentials', message: 'Incorrect email or password.' },
        { status: 401 }
      )
    }
    if (user.status === 'SUSPENDED') {
      return NextResponse.json(
        { error: 'Suspended', message: 'This account has been suspended. Contact an administrator.' },
        { status: 403 }
      )
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    return withSessionCookie(
      NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
        message: `Welcome back, ${user.name || user.email}!`,
      }),
      user.id
    )
  } catch (e: any) {
    console.error('POST /api/auth/login error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not sign you in. Please try again.' }, { status: 500 })
  }
}
