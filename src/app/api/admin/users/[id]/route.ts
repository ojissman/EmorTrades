import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  adminRoleOf,
  ADMIN_PERMISSIONS,
} from '@/lib/server/admin-rbac'
import { hashPassword, sessionEpochNow } from '@/lib/server/auth'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/users/[id] — the Users module detail endpoints.
 *
 *  GET    (users.view)    full profile + subscription + honest trading stats +
 *                         recent trades/journals (titles only)/tickets/auth log
 *                         (user.grants = per-user permission codes;
 *                         emailVerified is a bool, emailVerifiedAt keeps the date)
 *  PATCH  (users.edit)    general profile edit, role, status/suspend, manual
 *                         email verification, admin-set new password
 *                         (SEC-1 recovery lane: scrypt hash + sessionsValidFrom
 *                         epoch revocation, audited, never logged in clear);
 *                         adminRole/adminPermissions changes
 *                         additionally require callers with admins.manage AND
 *                         SUPER_ADMIN (user.permissions audit trail)
 *  DELETE (users.delete)  removes the account and all cascaded data, audited
 *
 * Guards kept from the original console: no self role/status changes, no
 * demote/suspend/delete of the last remaining role=ADMIN user.
 */

async function otherAdminCount(excludeId: string): Promise<number> {
  return db.user.count({ where: { role: 'ADMIN', id: { not: excludeId } } })
}

const USER_SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  adminRole: true,
  adminPermissions: true,
  status: true,
  timezone: true,
  defaultCurrency: true,
  emailVerified: true,
  googleId: true,
  passwordHash: true,
  createdAt: true,
  lastLoginAt: true,
  suspendedAt: true,
  suspensionReason: true,
} as const

/* ── GET: full detail ────────────────────────────────────────────────────── */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('users.view')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const u = await db.user.findUnique({ where: { id }, select: USER_SAFE_SELECT })
    if (!u) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }

    const [subscription, tradeAggRows, journalCount, accountCount, recentTrades, recentJournals, tickets, authEvents] =
      await Promise.all([
        db.subscription.findFirst({
          where: { userId: id, status: 'active' },
          orderBy: { startedAt: 'desc' },
          include: { plan: { select: { id: true, code: true, name: true, price: true, currency: true, billingInterval: true } } },
        }),
        db.$queryRaw<{ total: number | bigint; closed: number | bigint; wins: number | bigint; losses: number | bigint; netPnl: number | bigint | null }[]>`
          SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed,
            COALESCE(SUM(CASE WHEN status = 'closed' AND pnl > 0 THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(SUM(CASE WHEN status = 'closed' AND pnl < 0 THEN 1 ELSE 0 END), 0) AS losses,
            COALESCE(SUM(pnl), 0) AS netPnl
          FROM Trade
          WHERE userId = ${id}`,
        db.journal.count({ where: { userId: id } }),
        db.account.count({ where: { userId: id, deletedAt: null } }),
        db.trade.findMany({
          where: { userId: id },
          orderBy: { entryTime: 'desc' },
          take: 8,
          select: { id: true, symbol: true, side: true, assetClass: true, entryTime: true, exitTime: true, pnl: true, status: true },
        }),
        // Titles + metadata ONLY — journal content is permission-controlled
        // (journals.view_private) and never leaves this shape.
        db.journal.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, mood: true, createdAt: true },
        }),
        db.supportTicket.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, subject: true, status: true, priority: true, createdAt: true },
        }),
        db.authLog.findMany({
          where: { OR: [{ email: u.email }, { userId: u.id }] },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, kind: true, outcome: true, reason: true, ip: true, createdAt: true },
        }),
      ])

    const agg = tradeAggRows[0] ?? { total: 0, closed: 0, wins: 0, losses: 0, netPnl: 0 }
    const totalTrades = Number(agg.total)
    const wins = Number(agg.wins)
    const losses = Number(agg.losses)
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null

    let grants: string[] = []
    try {
      const parsed = u.adminPermissions ? JSON.parse(u.adminPermissions) : []
      if (Array.isArray(parsed)) grants = parsed.filter((p) => typeof p === 'string')
    } catch {
      grants = []
    }

    return NextResponse.json({
      user: {
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        adminRole: adminRoleOf(u),
        adminRoleRaw: u.adminRole,
        grants, // per-user permission grants on top of the role defaults
        status: u.status,
        timezone: u.timezone,
        defaultCurrency: u.defaultCurrency,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        emailVerified: Boolean(u.emailVerified),
        emailVerifiedAt: u.emailVerified, // the verification moment, for display
        googleLinked: Boolean(u.googleId),
        hasPassword: Boolean(u.passwordHash),
        suspendedAt: u.suspendedAt,
        suspensionReason: u.suspensionReason,
      },
      subscription: subscription
        ? {
            plan: subscription.plan,
            status: subscription.status,
            startedAt: subscription.startedAt,
            expiresAt: subscription.expiresAt,
            cancelledAt: subscription.cancelledAt,
            cancelReason: subscription.cancelReason,
          }
        : null,
      stats: {
        tradeCount: totalTrades,
        closedCount: Number(agg.closed),
        winRate, // breakeven-excluded; null when no decisive closed trades
        journalCount,
        accountCount,
        netPnl: Number(agg.netPnl ?? 0),
      },
      recentTrades,
      recentJournals,
      tickets,
      authEvents,
    })
  } catch (e: any) {
    console.error('GET /api/admin/users/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load that user.' }, { status: 500 })
  }
}

/* ── PATCH: edit / role / status / verify / admin permissions ────────────── */

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('users.edit')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))

    const role = typeof body.role === 'string' ? body.role : undefined
    const status = typeof body.status === 'string' ? body.status : undefined
    const verifyEmail = body.action === 'verify-email'
    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : undefined
    const defaultCurrency =
      typeof body.defaultCurrency === 'string' ? body.defaultCurrency.trim().toUpperCase() : undefined
    const suspensionReason =
      typeof body.suspensionReason === 'string' ? body.suspensionReason.trim() : undefined
    // SEC-1 recovery lane: admin sets a new password for a locked-out user
    // (no email provider configured ⇒ no self-service reset on production).
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : undefined

    // adminRole / adminPermissions: undefined = not sent; null adminRole = clear.
    let adminRole: string | null | undefined = undefined
    if ('adminRole' in body && body.adminRole !== undefined) {
      if (body.adminRole === null) adminRole = null
      else if (typeof body.adminRole === 'string') adminRole = body.adminRole
      else {
        return NextResponse.json(
          { error: 'Bad request', message: 'adminRole must be SUPER_ADMIN, ADMIN, SUPPORT or null.' },
          { status: 400 },
        )
      }
    }
    let adminPermissions: string[] | undefined = undefined
    if ('adminPermissions' in body && body.adminPermissions !== undefined) {
      if (!Array.isArray(body.adminPermissions)) {
        return NextResponse.json(
          { error: 'Bad request', message: 'adminPermissions must be an array of permission codes.' },
          { status: 400 },
        )
      }
      const valid = ADMIN_PERMISSIONS as readonly string[]
      const invalid = (body.adminPermissions as unknown[]).filter(
        (p) => typeof p !== 'string' || !valid.includes(p as string),
      )
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: 'Bad request', message: `Unknown permission code(s): ${invalid.join(', ')}.` },
          { status: 400 },
        )
      }
      adminPermissions = [...new Set(body.adminPermissions as string[])]
    }

    /* ── validation ── */
    if (role && role !== 'ADMIN' && role !== 'USER') {
      return NextResponse.json({ error: 'Bad request', message: 'Role must be ADMIN or USER.' }, { status: 400 })
    }
    if (status && status !== 'ACTIVE' && status !== 'SUSPENDED') {
      return NextResponse.json({ error: 'Bad request', message: 'Status must be ACTIVE or SUSPENDED.' }, { status: 400 })
    }
    if (name !== undefined && (name.length < 1 || name.length > 100)) {
      return NextResponse.json({ error: 'Bad request', message: 'Name must be 1–100 characters.' }, { status: 400 })
    }
    if (timezone !== undefined && (timezone.length < 1 || timezone.length > 100)) {
      return NextResponse.json({ error: 'Bad request', message: 'Timezone must be 1–100 characters.' }, { status: 400 })
    }
    if (defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(defaultCurrency)) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Default currency must be a 3-letter code (e.g. USD).' },
        { status: 400 },
      )
    }
    if (suspensionReason !== undefined && suspensionReason.length > 300) {
      return NextResponse.json({ error: 'Bad request', message: 'Suspension reason is limited to 300 characters.' }, { status: 400 })
    }
    if (newPassword !== undefined && (newPassword.length < 8 || newPassword.length > 128)) {
      return NextResponse.json(
        { error: 'Bad request', message: 'New password must be 8–128 characters.' },
        { status: 400 },
      )
    }

    const hasAny =
      role || status || verifyEmail || name !== undefined || timezone !== undefined ||
      defaultCurrency !== undefined || suspensionReason !== undefined ||
      adminRole !== undefined || adminPermissions !== undefined || newPassword !== undefined
    if (!hasAny) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Provide something to update.' },
        { status: 400 },
      )
    }

    // adminRole/adminPermissions changes are SUPER_ADMIN-only (plus admins.manage).
    if ((adminRole !== undefined || adminPermissions !== undefined) &&
        (adminRoleOf(auth.user) !== 'SUPER_ADMIN' || !auth.permissions.includes('admins.manage'))) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          message: 'Only super administrators can change administrative roles or permission grants.',
        },
        { status: 403 },
      )
    }

    const target = await db.user.findUnique({ where: { id }, select: USER_SAFE_SELECT })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }

    /* ── manual email verification (allowed on yourself too) ── */
    if (verifyEmail) {
      if (target.emailVerified) {
        return NextResponse.json({ user: { id: target.id, email: target.email }, message: 'Email is already verified.' })
      }
      const user = await db.user.update({
        where: { id },
        data: { emailVerified: new Date() },
        select: { id: true, name: true, email: true, role: true, status: true, emailVerified: true },
      })
      await logAdminAction(auth.user, {
        action: 'user.verify_email',
        targetType: 'User',
        targetId: target.id,
        targetLabel: target.email,
        details: { email: target.email },
        ip: clientIp(req),
        userAgent: userAgentOf(req),
      })
      return NextResponse.json({ user, message: `Verified ${user.email}. They can sign in now.` })
    }

    // A suspension reason only makes sense on a suspended account.
    if (suspensionReason !== undefined && status !== 'SUSPENDED' && target.status !== 'SUSPENDED') {
      return NextResponse.json(
        { error: 'Bad request', message: 'A suspension reason can only be set while the user is suspended.' },
        { status: 400 },
      )
    }

    /* ── self-protection ── */
    if (target.id === auth.user.id && (role || status)) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot change your own role or status.' },
        { status: 400 },
      )
    }
    // Safety net beyond the contract: a super admin editing away their own
    // staff role/grants could lock the platform out of admin management
    // (fixing it requires a SUPER_ADMIN caller).
    if (target.id === auth.user.id && (adminRole !== undefined || adminPermissions !== undefined)) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot change your own administrative role or permissions.' },
        { status: 400 },
      )
    }

    /* ── last-admin protection on demotion / suspension of an admin ── */
    const affectsAdmin = target.role === 'ADMIN'
    const removingAdmin = affectsAdmin && ((role && role !== 'ADMIN') || (status && status !== 'ACTIVE'))
    if (removingAdmin && (await otherAdminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot demote or suspend the only remaining administrator.' },
        { status: 400 },
      )
    }

    /* ── compute the effective change set ── */
    const data: {
      name?: string
      timezone?: string
      defaultCurrency?: string
      role?: string
      status?: string
      suspendedAt?: Date | null
      suspensionReason?: string | null
      adminRole?: string | null
      adminPermissions?: string
      passwordHash?: string
      sessionsValidFrom?: Date
    } = {}

    if (name !== undefined && name !== (target.name ?? '')) data.name = name
    if (timezone !== undefined && timezone !== target.timezone) data.timezone = timezone
    if (defaultCurrency !== undefined && defaultCurrency !== target.defaultCurrency) data.defaultCurrency = defaultCurrency

    if (role && role !== target.role) data.role = role

    if (status && status !== target.status) {
      data.status = status
      if (status === 'SUSPENDED') {
        data.suspendedAt = new Date()
        data.suspensionReason = suspensionReason && suspensionReason.length > 0 ? suspensionReason : null
      } else {
        data.suspendedAt = null
        data.suspensionReason = null
      }
    } else if (suspensionReason !== undefined && target.status === 'SUSPENDED') {
      // reason edit on an already-suspended account
      const next = suspensionReason.length > 0 ? suspensionReason : null
      if (next !== (target.suspensionReason ?? null)) data.suspensionReason = next
    }

    if (adminRole !== undefined && adminRole !== (target.adminRole ?? null)) data.adminRole = adminRole

    // Admin-set password: scrypt hash + epoch revocation — identical semantics
    // to the user-side reset (reset-password route): every previously issued
    // session token stops verifying. The plaintext never enters the audit log.
    if (newPassword !== undefined) {
      data.passwordHash = hashPassword(newPassword)
      data.sessionsValidFrom = sessionEpochNow()
    }

    let grantsBefore: string[] = []
    try {
      const parsed = target.adminPermissions ? JSON.parse(target.adminPermissions) : []
      if (Array.isArray(parsed)) grantsBefore = parsed.filter((p) => typeof p === 'string')
    } catch {
      grantsBefore = []
    }
    if (adminPermissions !== undefined) {
      const same =
        adminPermissions.length === grantsBefore.length && adminPermissions.every((p) => grantsBefore.includes(p))
      if (!same) data.adminPermissions = JSON.stringify(adminPermissions)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ user: { id: target.id, name: target.name, email: target.email }, message: 'Nothing to change.' })
    }

    const user = await db.user.update({ where: { id }, data, select: USER_SAFE_SELECT })

    /* ── audit each change type ── */
    const auditBase = {
      targetType: 'User',
      targetId: target.id,
      targetLabel: target.email,
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    }
    if (data.name !== undefined || data.timezone !== undefined || data.defaultCurrency !== undefined) {
      await logAdminAction(auth.user, {
        ...auditBase,
        action: 'user.edit',
        details: {
          fields: [
            data.name !== undefined ? 'name' : null,
            data.timezone !== undefined ? 'timezone' : null,
            data.defaultCurrency !== undefined ? 'defaultCurrency' : null,
          ].filter(Boolean),
          from: {
            name: target.name,
            timezone: target.timezone,
            defaultCurrency: target.defaultCurrency,
          },
          to: {
            name: data.name ?? target.name,
            timezone: data.timezone ?? target.timezone,
            defaultCurrency: data.defaultCurrency ?? target.defaultCurrency,
          },
        },
      })
    }
    if (data.role) {
      await logAdminAction(auth.user, {
        ...auditBase,
        action: 'user.role',
        details: { from: target.role, to: data.role },
      })
    }
    if (data.status) {
      await logAdminAction(auth.user, {
        ...auditBase,
        action: 'user.status',
        details: {
          from: target.status,
          to: data.status,
          reason: data.suspensionReason ?? null,
        },
      })
    }
    if (data.passwordHash) {
      await logAdminAction(auth.user, {
        ...auditBase,
        action: 'user.password_set',
        details: {
          sessionsRevoked: true,
          self: target.id === auth.user.id,
          note: 'admin-set password; all prior sessions invalidated (epoch)',
        },
      })
    }
    if (data.adminRole !== undefined || data.adminPermissions !== undefined) {
      // `to` must honour an explicit clear (null) — a plain ?? chain would
      // fall through and re-report the old value.
      const adminRoleTo = adminRole !== undefined ? adminRole : (target.adminRole ?? null)
      await logAdminAction(auth.user, {
        ...auditBase,
        action: 'user.permissions',
        details: {
          adminRole: { from: target.adminRole ?? null, to: adminRoleTo },
          grants: { from: grantsBefore, to: adminPermissions ?? grantsBefore },
        },
      })
    }

    const what = [
      data.name !== undefined ? 'name' : null,
      data.timezone !== undefined ? 'timezone' : null,
      data.defaultCurrency !== undefined ? 'currency' : null,
      data.role ? `role → ${data.role}` : null,
      data.status ? `status → ${data.status}` : null,
      data.adminRole !== undefined ? `admin role → ${data.adminRole ?? 'none'}` : null,
      data.adminPermissions !== undefined ? 'permission grants' : null,
      data.passwordHash ? 'password set (sessions revoked)' : null,
    ]
      .filter(Boolean)
      .join(', ')
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        adminRole: adminRoleOf(user),
        status: user.status,
        timezone: user.timezone,
        defaultCurrency: user.defaultCurrency,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        emailVerified: user.emailVerified,
        suspendedAt: user.suspendedAt,
        suspensionReason: user.suspensionReason,
      },
      message: `Updated ${user.name || user.email}${what ? ` (${what})` : ''}.`,
    })
  } catch (e: any) {
    console.error('PATCH /api/admin/users/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not update that user.' }, { status: 500 })
  }
}

/* ── DELETE: remove the account + all cascaded data ──────────────────────── */

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('users.delete')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true, name: true, email: true, adminRole: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }
    if (target.id === auth.user.id) {
      return NextResponse.json({ error: 'Not allowed', message: 'You cannot delete your own account.' }, { status: 400 })
    }
    if (target.role === 'ADMIN' && (await otherAdminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot delete the only remaining administrator.' },
        { status: 400 },
      )
    }

    // Snapshot for the audit trail — how much data goes with the account.
    const [tradeCount, journalCount, accountCount, subscriptionCount] = await Promise.all([
      db.trade.count({ where: { userId: id } }),
      db.journal.count({ where: { userId: id } }),
      db.account.count({ where: { userId: id } }),
      db.subscription.count({ where: { userId: id } }),
    ])

    await db.user.delete({ where: { id } })

    await logAdminAction(auth.user, {
      action: 'user.delete',
      targetType: 'User',
      targetId: target.id,
      targetLabel: target.email,
      details: {
        email: target.email,
        role: target.role,
        adminRole: target.adminRole ?? null,
        deletedData: { trades: tradeCount, journals: journalCount, accounts: accountCount, subscriptions: subscriptionCount },
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ ok: true, message: `Deleted ${target.name || target.email} and all their data.` })
  } catch (e: any) {
    console.error('DELETE /api/admin/users/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not delete that user.' }, { status: 500 })
  }
}
