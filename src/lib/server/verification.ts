import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

/**
 * VERIFICATION TOKENS — single-use, 24-hour email verification links.
 * Issuing a new link consumes any previous outstanding one, so a user always
 * has exactly one live link (no link-stuffing confusion).
 */

const TOKEN_TTL_MS = 24 * 3600 * 1000

export async function issueVerificationToken(userId: string): Promise<string> {
  // Consume any outstanding tokens for this user first.
  await db.verificationToken.updateMany({
    where: { userId, purpose: 'EMAIL_VERIFY', consumedAt: null },
    data: { consumedAt: new Date() },
  })

  const token = randomBytes(32).toString('hex')
  await db.verificationToken.create({
    data: {
      userId,
      token,
      purpose: 'EMAIL_VERIFY',
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return token
}

export function buildVerificationLink(origin: string, token: string): string {
  return `${origin}/api/auth/verify-email?token=${token}`
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'not-found' | 'expired' | 'consumed' }

export async function consumeVerificationToken(token: string | null | undefined): Promise<ConsumeResult> {
  if (!token) return { ok: false, reason: 'not-found' }
  const row = await db.verificationToken.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  })
  if (!row) return { ok: false, reason: 'not-found' }
  if (row.consumedAt) return { ok: false, reason: 'consumed' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' }

  await db.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
  return { ok: true, userId: row.userId }
}
