import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/auth'
import { sameOrigin } from '@/lib/server/google-link'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { getGmailConnection, sendGmailEmail } from '@/lib/server/gmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/gmail/test (ADMIN-INTEGRATIONS)
 *
 * Sends a real probe email through the connected Gmail sender so the admin
 * can confirm end-to-end delivery from Admin ▸ Settings ▸ Integrations.
 *
 *   body: { to?: string }   — recipient; defaults to the connected inbox
 *                            (send-to-self: the safest possible probe).
 *
 * Guards: sameOrigin + requireAdmin + 3/min/IP rate limit + audit log.
 * Honest 409 when Gmail is not connected (never a fake success).
 *
 * HISTORY NOTE (2026-11-05, CLICKSWEEP): this route was claimed by two
 * commit messages (73cb157, 718bf45) but the file never actually rode a
 * commit — it existed only as an uncommitted working-tree file and vanished
 * on a tree reset, leaving the Settings button a silent 404. The fix this
 * time was verified by `git show --stat` + `git log --all -- <path>` BEFORE
 * implementation, and the file's presence is asserted in the push.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 })
  }
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = auth.user

  const rl = rateLimit(`gmail-test:${clientIp(req)}`, 3, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many test sends. Wait a minute and try again.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as { to?: unknown }
  const conn = await getGmailConnection()
  if (!conn) {
    return NextResponse.json(
      { error: 'Gmail is not connected. Connect it first — the test sends through the real sender.' },
      { status: 409 }
    )
  }

  // recipient: explicit body address, else the connected inbox (self-probe)
  let to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!to) to = conn.email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: 'Enter a valid email address to send the test to.' }, { status: 400 })
  }

  const sentAt = new Date().toISOString()
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
    '<h2 style="margin:0 0 8px;font-size:18px">EmorTrades — Gmail test email</h2>',
    '<p style="margin:0 0 12px;color:#555">This is a test send from the EmorTrades Integrations panel.</p>',
    '<p style="margin:0 0 12px;font-size:13px;color:#777">',
    `Sent by <strong>${admin.email}</strong> at ${sentAt}`,
    '</p>',
    '<p style="margin:0;font-size:13px;color:#777">If you received this, end-to-end Gmail delivery works.</p>',
    '</div>',
  ].join('')

  const result = await sendGmailEmail(to, 'EmorTrades test email', html)
  await logAdminAction(admin, {
    action: 'integrations.gmail.test-send',
    targetType: 'Setting',
    targetId: 'gmail.connection',
    ip: clientIp(req),
    userAgent: userAgentOf(req),
    details: { to, ok: result.ok, messageId: result.messageId ?? null },
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? 'Gmail send failed.', reauth: result.reauth ?? false },
      { status: 502 }
    )
  }
  return NextResponse.json({ ok: true, to, messageId: result.messageId })
}
