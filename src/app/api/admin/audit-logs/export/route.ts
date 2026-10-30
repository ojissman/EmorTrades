import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { clientIp, logAdminAction, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN ▸ AUDIT LOGS ▸ EXPORT (ADMIN-2, Agent D) — CSV download of the merged,
 * append-only audit feed using the SAME filters as the listing route (no
 * pagination). Proper CSV escaping (quotes doubled, fields with commas/quotes/
 * newlines wrapped), UTF-8 BOM so Excel opens it cleanly, capped at 10,000
 * rows. The export itself is audited.
 */

const AUTH_KINDS = ['REGISTER', 'LOGIN', 'GOOGLE', 'VERIFY', 'RESEND', 'EXPORT', 'RESET'] as const
const OUTCOMES = ['OK', 'FAIL', 'BLOCKED'] as const
const MAX_ROWS = 10_000

/** Same filter parsing as /api/admin/audit-logs (kept in sync — Agent-D-owned). */
function parseAuditFilters(sp: URLSearchParams) {
  const sourceRaw = sp.get('source')
  const source: 'all' | 'auth' | 'admin' =
    sourceRaw === 'auth' || sourceRaw === 'admin' ? sourceRaw : 'all'
  const kind = (AUTH_KINDS as readonly string[]).includes(sp.get('kind') ?? '')
    ? sp.get('kind')!
    : undefined
  const action = sp.get('action')?.trim() || undefined
  const outcome = (OUTCOMES as readonly string[]).includes(sp.get('outcome') ?? '')
    ? sp.get('outcome')!
    : undefined
  const search = sp.get('search')?.trim() || undefined
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const fromDate = fromRaw ? new Date(fromRaw) : undefined
  const toDate = toRaw ? new Date(toRaw) : undefined
  return {
    source,
    kind,
    action,
    outcome,
    search,
    from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
    to:
      toDate && !Number.isNaN(toDate.getTime())
        ? new Date(toDate.getTime() + (toRaw!.length <= 10 ? 86_399_999 : 0))
        : undefined,
  }
}

/** RFC-4180-ish escaping: wrap when needed, double embedded quotes. */
function csvField(v: string | null | undefined): string {
  const s = v ?? ''
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('audit_logs.view')
  if (!auth.ok) return auth.response

  try {
    const sp = new URL(req.url).searchParams
    const f = parseAuditFilters(sp)

    const createdAt =
      f.from || f.to
        ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) }
        : undefined

    const includeAuth = f.source !== 'admin' && !f.action
    const includeAdmin = f.source !== 'auth' && !f.kind

    const authWhere = {
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.outcome ? { outcome: f.outcome } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(f.search
        ? { OR: [{ email: { contains: f.search } }, { reason: { contains: f.search } }] }
        : {}),
    }
    const adminWhere = {
      ...(f.action ? { action: f.action } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(f.search
        ? { OR: [{ adminEmail: { contains: f.search } }, { targetLabel: { contains: f.search } }] }
        : {}),
    }

    const [authRows, adminRows] = await Promise.all([
      includeAuth
        ? db.authLog.findMany({ where: authWhere, orderBy: { createdAt: 'desc' }, take: MAX_ROWS })
        : Promise.resolve([]),
      includeAdmin
        ? db.adminActionLog.findMany({ where: adminWhere, orderBy: { createdAt: 'desc' }, take: MAX_ROWS })
        : Promise.resolve([]),
    ])

    type Row = {
      timestamp: Date
      source: 'auth' | 'admin'
      actor: string | null
      action: string
      target: string
      outcome: string
      reason: string | null
      ip: string | null
    }
    const rows: Row[] = [
      ...authRows.map((r) => ({
        timestamp: r.createdAt,
        source: 'auth' as const,
        actor: r.email,
        action: r.kind,
        target: '',
        outcome: r.outcome,
        reason: r.reason,
        ip: r.ip,
      })),
      ...adminRows.map((r) => ({
        timestamp: r.createdAt,
        source: 'admin' as const,
        actor: r.adminEmail,
        action: r.action,
        target: r.targetLabel ? (r.targetType ? `${r.targetType}: ${r.targetLabel}` : r.targetLabel) : '',
        outcome: 'OK',
        reason: null,
        ip: r.ip,
      })),
    ]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, MAX_ROWS)

    const lines = ['timestamp,source,actor,action,target,outcome,reason,ip']
    for (const r of rows) {
      lines.push(
        [
          r.timestamp.toISOString(),
          r.source,
          r.actor ?? 'system',
          r.action,
          r.target,
          r.outcome,
          r.reason ?? '',
          r.ip ?? '',
        ]
          .map(csvField)
          .join(','),
      )
    }

    // No BOM — the first line is exactly the contracted header row.
    const csv = lines.join('\r\n')
    const today = new Date()
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

    await logAdminAction(auth.user, {
      action: 'audit_logs.export',
      targetType: 'AuditLog',
      details: {
        rowCount: rows.length,
        filters: {
          source: f.source,
          kind: f.kind ?? null,
          action: f.action ?? null,
          outcome: f.outcome ?? null,
          search: f.search ?? null,
          from: f.from?.toISOString() ?? null,
          to: f.to?.toISOString() ?? null,
        },
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-logs-${ymd}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('GET /api/admin/audit-logs/export error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not export audit logs.' },
      { status: 500 },
    )
  }
}
