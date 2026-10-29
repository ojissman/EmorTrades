import { db } from '@/lib/db'

/**
 * AUTH LOG — security audit trail for every public auth attempt. Never throws
 * (an audit write must not break the request it describes); prunes rows older
 * than 30 days opportunistically so the table stays small.
 */

export type AuthLogKind = 'REGISTER' | 'LOGIN' | 'GOOGLE' | 'VERIFY' | 'RESEND'
export type AuthLogOutcome = 'OK' | 'FAIL' | 'BLOCKED'

export interface AuthLogInput {
  kind: AuthLogKind
  outcome: AuthLogOutcome
  email?: string | null
  reason?: string | null
  userId?: string | null
  req?: Request
}

export async function logAuthEvent(input: AuthLogInput): Promise<void> {
  try {
    const fwd = input.req?.headers.get('x-forwarded-for')
    const ip = fwd ? fwd.split(',')[0].trim() : input.req?.headers.get('x-real-ip') || null
    const userAgent = input.req?.headers.get('user-agent')

    await db.authLog.create({
      data: {
        kind: input.kind,
        outcome: input.outcome,
        email: input.email ?? null,
        reason: input.reason ?? null,
        userId: input.userId ?? null,
        ip,
        userAgent: userAgent ? userAgent.slice(0, 250) : null,
      },
    })

    // Opportunistic prune (~5% of writes): drop rows older than 30 days.
    if (Math.random() < 0.05) {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      await db.authLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    }
  } catch (e: any) {
    console.error('[auth-log] write failed:', e?.message)
  }
}
