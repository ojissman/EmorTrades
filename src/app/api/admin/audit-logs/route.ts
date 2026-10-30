import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * ADMIN ▸ AUDIT LOGS (ADMIN-2, Agent D) — the merged, APPEND-ONLY event feed.
 *
 * AuthLog (auth events: REGISTER/LOGIN/GOOGLE/VERIFY/RESEND/EXPORT/RESET ×
 * OK/FAIL/BLOCKED) and AdminActionLog (administrative operations, outcome OK)
 * are queried with the same filter set, merge-sorted newest-first and paged.
 *
 * Pagination correctness: the page slice can only contain rows from the
 * newest (offset+pageSize) rows of EACH table, so each table is fetched with
 * take = offset+pageSize (capped 10k) — exact for any realistic volume (an
 * upgrade over the spec's accepted fetch-500-and-merge approach). Totals
 * come from real count queries. The same filter logic backs the CSV export
 * route (kept in sync deliberately — both files are Agent-D-owned).
 *
 * `stats` (unfiltered) powers the KPI row: total events, failed logins and
 * bot-blocks over the last 7 days, admin actions over the last 7 days.
 */

const AUTH_KINDS = ['REGISTER', 'LOGIN', 'GOOGLE', 'VERIFY', 'RESEND', 'EXPORT', 'RESET'] as const
const OUTCOMES = ['OK', 'FAIL', 'BLOCKED'] as const

interface AuditFilters {
  source: 'all' | 'auth' | 'admin'
  kind?: string
  action?: string
  outcome?: string
  search?: string
  from?: Date
  to?: Date
}

/** Shared filter parsing — mirrored by the export route (both Agent-D-owned). */
function parseAuditFilters(sp: URLSearchParams): AuditFilters {
  const sourceRaw = sp.get('source')
  const source: AuditFilters['source'] =
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
    // a bare date ("2026-01-15") parses to midnight UTC — extend `to` to the
    // end of that day so the boundary is inclusive
    to:
      toDate && !Number.isNaN(toDate.getTime())
        ? new Date(toDate.getTime() + (toRaw!.length <= 10 ? 86_399_999 : 0))
        : undefined,
  }
}

interface MergedEvent {
  id: string
  source: 'auth' | 'admin'
  timestamp: Date
  actor: string
  action: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  outcome: string
  reason: string | null
  ip: string | null
  userAgent: string | null
  details: Record<string, unknown> | null
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return { raw }
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('audit_logs.view')
  if (!auth.ok) return auth.response

  try {
    const sp = new URL(req.url).searchParams
    const f = parseAuditFilters(sp)
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '25', 10) || 25))
    const offset = (page - 1) * pageSize

    const createdAt =
      f.from || f.to
        ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) }
        : undefined

    // kind filters auth events (and excludes admin rows — it's auth-only
    // vocabulary); action filters admin rows and excludes auth rows.
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

    // take = offset+pageSize per table guarantees an exact page slice; totals
    // are real counts. Capped at 10k per table for safety.
    const take = Math.min(10_000, offset + pageSize)

    const [authRows, adminRows, authTotal, adminTotal] = await Promise.all([
      includeAuth
        ? db.authLog.findMany({ where: authWhere, orderBy: { createdAt: 'desc' }, take })
        : Promise.resolve([]),
      includeAdmin
        ? db.adminActionLog.findMany({ where: adminWhere, orderBy: { createdAt: 'desc' }, take })
        : Promise.resolve([]),
      includeAuth ? db.authLog.count({ where: authWhere }) : Promise.resolve(0),
      includeAdmin ? db.adminActionLog.count({ where: adminWhere }) : Promise.resolve(0),
    ])

    const merged: MergedEvent[] = [
      ...authRows.map((r): MergedEvent => ({
        id: r.id,
        source: 'auth',
        timestamp: r.createdAt,
        actor: r.email ?? 'system',
        action: r.kind,
        targetType: null,
        targetId: null,
        targetLabel: null,
        outcome: r.outcome,
        reason: r.reason ?? null,
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        details: null,
      })),
      ...adminRows.map((r): MergedEvent => ({
        id: r.id,
        source: 'admin',
        timestamp: r.createdAt,
        actor: r.adminEmail ?? 'system',
        action: r.action,
        targetType: r.targetType ?? null,
        targetId: r.targetId ?? null,
        targetLabel: r.targetLabel ?? null,
        outcome: 'OK',
        reason: null,
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        details: parseDetails(r.details),
      })),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    /* KPI stats — unfiltered platform-wide snapshots (7d windows). */
    const weekAgo = new Date(Date.now() - 7 * 86_400_000)
    const [totalAuth, totalAdmin, failed7, blocked7, admin7] = await Promise.all([
      db.authLog.count(),
      db.adminActionLog.count(),
      db.authLog.count({ where: { outcome: 'FAIL', createdAt: { gte: weekAgo } } }),
      db.authLog.count({ where: { outcome: 'BLOCKED', createdAt: { gte: weekAgo } } }),
      db.adminActionLog.count({ where: { createdAt: { gte: weekAgo } } }),
    ])

    return NextResponse.json({
      events: merged.slice(offset, offset + pageSize).map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
      total: authTotal + adminTotal,
      page,
      pageSize,
      stats: {
        totalEvents: totalAuth + totalAdmin,
        failedLogins7d: failed7,
        blocked7d: blocked7,
        adminActions7d: admin7,
      },
    })
  } catch (e) {
    console.error('GET /api/admin/audit-logs error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not load audit logs.' },
      { status: 500 },
    )
  }
}
