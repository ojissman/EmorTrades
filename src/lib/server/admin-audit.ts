import { db } from '@/lib/db'
import type { User } from '@prisma/client'

/**
 * ADMIN AUDIT (ADMIN-2) — append-only log of administrative operations.
 * AuthLog (auth events) is untouched; this records what admins DID once
 * authenticated: suspensions, deletions, plan changes, settings updates,
 * sensitive journal access, exports…
 *
 * Logging is best-effort: an audit failure must never break the operation,
 * but it is loudly reported. There is deliberately NO update/delete path —
 * admins cannot silently rewrite history.
 */

export interface AdminActionInput {
  action: string // dot-namespaced verb, e.g. "user.suspend"
  targetType?: string // User | Trade | Plan | SupportTicket | Announcement | Setting …
  targetId?: string
  targetLabel?: string // human-readable label (email, plan name…)
  details?: Record<string, unknown> // structured, JSON-stored
  ip?: string | null
  userAgent?: string | null
}

export async function logAdminAction(admin: Pick<User, 'id' | 'email'>, input: AdminActionInput): Promise<void> {
  try {
    await db.adminActionLog.create({
      data: {
        adminId: admin.id,
        adminEmail: admin.email,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  } catch (e) {
    console.error('logAdminAction failed:', (e as Error)?.message)
  }
}

/** Client IP from the gateway/proxy headers (best-effort, first hop wins). */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || null
  return req.headers.get('x-real-ip')
}

export function userAgentOf(req: Request): string | null {
  return req.headers.get('user-agent')
}
