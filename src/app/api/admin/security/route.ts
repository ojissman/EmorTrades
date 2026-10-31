import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/server/auth'
import { botProtectionMode, turnstileConfigured } from '@/lib/server/bot-guard'
import { googleConfigured } from '@/lib/server/google'
import {
  FLAG_REQUIRE_EMAIL_VERIFICATION,
  requireEmailVerification,
  setFlag,
} from '@/lib/server/system-flags'
import { emailDeliveryStatus } from '@/lib/server/email'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/security — ADMIN ONLY. Powers the Admin Console ▸ Security
 * card: recent auth events (the visible half of bot protection), 7-day stats,
 * and the current protection configuration.
 *
 * PATCH /api/admin/security { requireEmailVerification?: boolean } — flip the
 * verification enforcement at runtime.
 */

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const since = new Date(Date.now() - SEVEN_DAYS_MS)

    const [events, weekRows, total] = await Promise.all([
      db.authLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, kind: true, email: true, outcome: true, reason: true,
          ip: true, createdAt: true,
        },
      }),
      db.authLog.findMany({
        where: { createdAt: { gte: since } },
        select: { kind: true, outcome: true },
      }),
      db.authLog.count(),
    ])

    const week = {
      total: weekRows.length,
      blocked: weekRows.filter((r) => r.outcome === 'BLOCKED').length,
      failed: weekRows.filter((r) => r.outcome === 'FAIL').length,
      signIns: weekRows.filter((r) => r.kind === 'LOGIN' && r.outcome === 'OK').length,
      registrations: weekRows.filter((r) => r.kind === 'REGISTER' && r.outcome === 'OK').length,
      google: weekRows.filter((r) => r.kind === 'GOOGLE' && r.outcome === 'OK').length,
      verifications: weekRows.filter((r) => r.kind === 'VERIFY' && r.outcome === 'OK').length,
    }

    const emailStatus = await emailDeliveryStatus()

    return NextResponse.json({
      events,
      week,
      totalLogged: total,
      config: {
        protectionMode: botProtectionMode(),
        turnstile: turnstileConfigured(),
        googleSignIn: googleConfigured(),
        emailDelivery: emailStatus.provider,
        requireEmailVerification: await requireEmailVerification(),
      },
    })
  } catch (e: any) {
    console.error('GET /api/admin/security error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load the security log.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body.requireEmailVerification !== 'boolean') {
      return NextResponse.json(
        { error: 'Bad request', message: 'Provide requireEmailVerification (boolean).' },
        { status: 400 }
      )
    }

    await setFlag(FLAG_REQUIRE_EMAIL_VERIFICATION, body.requireEmailVerification ? 'true' : 'false')

    return NextResponse.json({
      requireEmailVerification: body.requireEmailVerification,
      message: body.requireEmailVerification
        ? 'Email verification required — new sign-ups must click their activation link.'
        : 'Email verification disabled — new sign-ups can sign in immediately.',
    })
  } catch (e: any) {
    console.error('PATCH /api/admin/security error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not update the setting.' }, { status: 500 })
  }
}
