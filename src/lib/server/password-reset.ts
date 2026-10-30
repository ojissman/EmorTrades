import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

/**
 * PASSWORD RESET TOKENS (LAND-1) — single-use, 60-minute reset links.
 * Same table and pattern as email verification: issuing a new link consumes
 * any outstanding one, so a user always has exactly one live reset link.
 *
 * The purpose column keeps the two flows separate — a verification token can
 * never be replayed as a reset token and vice versa (checked on consume).
 */

const TOKEN_TTL_MS = 60 * 60 * 1000

export const PASSWORD_RESET_PURPOSE = 'PASSWORD_RESET'

export async function issuePasswordResetToken(userId: string): Promise<string> {
  // Consume any outstanding reset tokens for this user first.
  await db.verificationToken.updateMany({
    where: { userId, purpose: PASSWORD_RESET_PURPOSE, consumedAt: null },
    data: { consumedAt: new Date() },
  })

  const token = randomBytes(32).toString('hex')
  await db.verificationToken.create({
    data: {
      userId,
      token,
      purpose: PASSWORD_RESET_PURPOSE,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return token
}

export function buildPasswordResetLink(origin: string, token: string): string {
  return `${origin}/?reset=${token}`
}

export type PasswordResetConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not-found' | 'expired' | 'consumed' }

export async function consumePasswordResetToken(
  token: string | null | undefined
): Promise<PasswordResetConsumeResult> {
  if (!token) return { ok: false, reason: 'not-found' }
  const row = await db.verificationToken.findUnique({
    where: { token },
    select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
  })
  if (!row || row.purpose !== PASSWORD_RESET_PURPOSE) return { ok: false, reason: 'not-found' }
  if (row.consumedAt) return { ok: false, reason: 'consumed' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' }

  await db.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
  return { ok: true, userId: row.userId }
}
