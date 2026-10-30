import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'
import { botProtectionMode, turnstileConfigured } from '@/lib/server/bot-guard'
import { googleConfigured } from '@/lib/server/google'
import { emailDeliveryConfigured } from '@/lib/server/email'
import {
  FLAG_REQUIRE_EMAIL_VERIFICATION,
  getFlag,
  requireEmailVerification,
  setFlag,
} from '@/lib/server/system-flags'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/settings (ADMIN-2 · Settings module) — the platform configuration
 * surface. GET returns the full structured config (SystemSetting-backed values
 * with hardcoded defaults, plus live status from the env/lib helpers); PATCH
 * persists a whitelisted subset and audits every change.
 *
 * Honesty rules: values that are not wired to real behaviour say so
 * (maintenanceMode is a display flag); secret configuration is NEVER returned —
 * only configured/not-configured booleans.
 */

/* ── SystemSetting keys + defaults ──────────────────────────────────────── */

const K = {
  platformName: 'platform.name',
  platformDescription: 'platform.description',
  timezone: 'platform.timezone',
  dateFormat: 'platform.dateFormat',
  currency: 'platform.currency',
  dataRetentionDays: 'privacy.dataRetentionDays',
  accountDeletionPolicy: 'privacy.accountDeletionPolicy',
  maintenanceMode: 'system.maintenanceMode',
} as const

const DEFAULTS = {
  platformName: 'EmorTrades — Trading Journal',
  platformDescription: '',
  timezone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  currency: 'USD',
  accountDeletionPolicy: '',
} as const

// Hardcoded to match package.json "version" (kept in sync on releases).
const APP_VERSION = '0.2.1'

export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const

/** The SystemSetting-backed slice (no DB counts / env status) — PATCH diff base. */
async function readStored() {
  const [name, description, timezone, dateFormat, currency, retentionRaw, deletionPolicy, maintenanceRaw, verificationRequired] =
    await Promise.all([
      getFlag(K.platformName, DEFAULTS.platformName),
      getFlag(K.platformDescription, DEFAULTS.platformDescription),
      getFlag(K.timezone, DEFAULTS.timezone),
      getFlag(K.dateFormat, DEFAULTS.dateFormat),
      getFlag(K.currency, DEFAULTS.currency),
      getFlag(K.dataRetentionDays, ''),
      getFlag(K.accountDeletionPolicy, DEFAULTS.accountDeletionPolicy),
      getFlag(K.maintenanceMode, 'false'),
      requireEmailVerification(),
    ])
  const retention = Number.parseInt(retentionRaw, 10)
  return {
    general: {
      platformName: name,
      platformDescription: description,
      timezone,
      dateFormat,
      currency,
    },
    security: {
      requireEmailVerification: verificationRequired,
    },
    privacy: {
      dataRetentionDays: Number.isFinite(retention) && retention > 0 ? retention : null,
      accountDeletionPolicy: deletionPolicy,
    },
    maintenanceMode: maintenanceRaw === 'true',
  }
}

/** Full GET/PATCH response payload: stored values + live status + DB counts. */
async function buildSettings() {
  const stored = await readStored()
  // Counts via SELECT subqueries (DateTime columns in this SQLite DB are
  // epoch-millis ints, but plain counts never touch dates). journalEntries =
  // all three note types: Journal + DayNote + MiscNote.
  const [userRows, tradeRows, journalRows] = await Promise.all([
    db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM User`,
    db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM Trade`,
    db.$queryRaw<{ n: number | bigint }[]>`SELECT (SELECT COUNT(*) FROM Journal) + (SELECT COUNT(*) FROM DayNote) + (SELECT COUNT(*) FROM MiscNote) AS n`,
  ])
  const [users, trades, journalEntries] = [
    Number(userRows[0]?.n ?? 0),
    Number(tradeRows[0]?.n ?? 0),
    Number(journalRows[0]?.n ?? 0),
  ]
  const emailDelivery = emailDeliveryConfigured() ? ('resend' as const) : ('dev' as const)
  return {
    general: stored.general,
    security: {
      requireEmailVerification: stored.security.requireEmailVerification,
      botProtection: botProtectionMode(),
      turnstileConfigured: turnstileConfigured(),
      googleSignIn: googleConfigured(),
      emailDelivery,
    },
    notifications: {
      emailDelivery,
      inAppEnabled: true,
    },
    subscriptions: {
      billingMode: 'manual',
      gatewayConnected: false,
    },
    privacy: stored.privacy,
    system: {
      appVersion: APP_VERSION,
      database: { users, trades, journalEntries },
      maintenanceMode: stored.maintenanceMode,
    },
  }
}

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET() {
  const auth = await requirePermission('settings.manage')
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json(await buildSettings())
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('GET /api/admin/settings error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load platform settings.' }, { status: 500 })
  }
}

/* ── PATCH ───────────────────────────────────────────────────────────────── */

const PatchSchema = z.strictObject({
  general: z
    .strictObject({
      platformName: z.string().trim().min(2, 'Platform name must be at least 2 characters.').max(80).optional(),
      platformDescription: z.string().trim().max(500, 'Description is limited to 500 characters.').optional(),
      timezone: z.string().trim().min(1, 'Timezone cannot be empty.').max(64).optional(),
      dateFormat: z.enum(DATE_FORMATS).optional(),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter uppercase code (e.g. USD).')
        .optional(),
    })
    .optional(),
  security: z.strictObject({ requireEmailVerification: z.boolean().optional() }).optional(),
  privacy: z
    .strictObject({
      dataRetentionDays: z
        .number()
        .int('Data retention must be a whole number of days.')
        .positive('Data retention must be a positive number of days.')
        .nullable()
        .optional(),
      accountDeletionPolicy: z.string().trim().max(2000, 'Policy is limited to 2000 characters.').optional(),
    })
    .optional(),
  system: z.strictObject({ maintenanceMode: z.boolean().optional() }).optional(),
})

export async function PATCH(req: NextRequest) {
  const auth = await requirePermission('settings.manage')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = PatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          message: parsed.error.issues[0]?.message ?? 'Invalid settings payload.',
        },
        { status: 400 },
      )
    }
    const data = parsed.data
    if (!data.general && !data.security && !data.privacy && !data.system) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Nothing to update — provide general, security, privacy or system changes.' },
        { status: 400 },
      )
    }

    const current = await readStored()
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    const set = (key: string, from: unknown, to: string) => {
      if (String(from ?? '') !== to) changes[key] = { from, to }
    }

    if (data.general) {
      const g = data.general
      if (g.platformName !== undefined) {
        set(K.platformName, current.general.platformName, g.platformName)
        await setFlag(K.platformName, g.platformName)
      }
      if (g.platformDescription !== undefined) {
        set(K.platformDescription, current.general.platformDescription, g.platformDescription)
        await setFlag(K.platformDescription, g.platformDescription)
      }
      if (g.timezone !== undefined) {
        set(K.timezone, current.general.timezone, g.timezone)
        await setFlag(K.timezone, g.timezone)
      }
      if (g.dateFormat !== undefined) {
        set(K.dateFormat, current.general.dateFormat, g.dateFormat)
        await setFlag(K.dateFormat, g.dateFormat)
      }
      if (g.currency !== undefined) {
        set(K.currency, current.general.currency, g.currency)
        await setFlag(K.currency, g.currency)
      }
    }
    if (data.security?.requireEmailVerification !== undefined) {
      const to = data.security.requireEmailVerification
      if (current.security.requireEmailVerification !== to) {
        changes[FLAG_REQUIRE_EMAIL_VERIFICATION] = { from: current.security.requireEmailVerification, to }
      }
      await setFlag(FLAG_REQUIRE_EMAIL_VERIFICATION, to ? 'true' : 'false')
    }
    if (data.privacy) {
      const p = data.privacy
      if (p.dataRetentionDays !== undefined) {
        const to = p.dataRetentionDays == null ? '' : String(p.dataRetentionDays)
        const from = current.privacy.dataRetentionDays == null ? '' : String(current.privacy.dataRetentionDays)
        if (from !== to) {
          changes[K.dataRetentionDays] = { from: current.privacy.dataRetentionDays, to: p.dataRetentionDays }
        }
        await setFlag(K.dataRetentionDays, to)
      }
      if (p.accountDeletionPolicy !== undefined) {
        set(K.accountDeletionPolicy, current.privacy.accountDeletionPolicy, p.accountDeletionPolicy)
        await setFlag(K.accountDeletionPolicy, p.accountDeletionPolicy)
      }
    }
    if (data.system?.maintenanceMode !== undefined) {
      const to = data.system.maintenanceMode
      if (current.maintenanceMode !== to) {
        changes[K.maintenanceMode] = { from: current.maintenanceMode, to }
      }
      await setFlag(K.maintenanceMode, to ? 'true' : 'false')
    }

    const changedKeys = Object.keys(changes)
    if (changedKeys.length > 0) {
      await logAdminAction(auth.user, {
        action: 'settings.update',
        targetType: 'Setting',
        targetLabel: changedKeys.join(', '),
        details: { changes },
        ip: clientIp(req),
        userAgent: userAgentOf(req),
      })
    }

    return NextResponse.json({
      message:
        changedKeys.length > 0 ? `Settings saved (${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}).` : 'No changes to save.',
      settings: await buildSettings(),
    })
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('PATCH /api/admin/settings error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not save settings.' }, { status: 500 })
  }
}
