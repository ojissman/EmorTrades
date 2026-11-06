import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSecret, hasCredentialKey } from '@/lib/mt5/crypto'
import { connectorTokenOk, hasConnectorToken, rateLimitConnector, unauthorized } from '@/lib/mt5/connector-auth'

export const dynamic = 'force-dynamic'

/**
 * MT5-LINK connector work queue (Task MT5LINK) — the ONE place where MT5
 * credentials leave the server, and only for a correctly tokened connector
 * poll over HTTPS. Token-gated (timing-safe), rate-limited, never logged.
 *
 * Response per connection:
 *   { id, login, password, server, label, desired, status,
 *     lastDealTime (epoch seconds | null), syncRequestedAt (epoch s | null) }
 *
 * · desired=connect   → spawn a gateway container + first full-history sync
 * · desired=sync      → keep syncing (each poll also returns rows whose
 *                       syncRequestedAt/lastSyncAt makes a sync due)
 * · desired=disconnect→ tear the container down (row is being removed)
 *
 * Every successful poll refreshes the connector heartbeat (SystemSetting
 * mt5.connector.lastSeenAt) — the user-facing page shows online/offline from
 * exactly this heartbeat. This route grants NO other capability: no user
 * data beyond the connection rows, no trades, no sessions.
 */
export async function GET(req: NextRequest) {
  try {
    if (!hasConnectorToken() || !connectorTokenOk(req)) return unauthorized()
    if (!rateLimitConnector('pending')) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
    }
    if (!hasCredentialKey()) {
      return NextResponse.json({ error: 'Journal MT5_CREDENTIAL_KEY not configured' }, { status: 503 })
    }

    const rows = await db.mt5Connection.findMany({
      where: { status: { not: 'disconnected' } },
      orderBy: { createdAt: 'asc' },
    })
    // Include rows already marked disconnected but not yet deleted so the
    // connector sees the final teardown instruction exactly once.
    const disconnecting = await db.mt5Connection.findMany({
      where: { status: 'disconnected', desired: 'disconnect' },
      orderBy: { createdAt: 'asc' },
    })

    const now = new Date()
    const connections: {
      id: string
      login: number
      password: string
      server: string
      label: string
      desired: string
      status: string
      lastDealTime: number | null
      syncRequestedAt: number | null
    }[] = []
    const seen = new Set<string>()
    for (const c of [...rows, ...disconnecting]) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      let password = ''
      try {
        password = decryptSecret(c.encryptedPassword)
      } catch {
        // Corrupt/tampered envelope: report the connection as errored rather
        // than leaking a partial secret or blocking the whole queue.
        await db.mt5Connection.update({
          where: { id: c.id },
          data: { status: 'error', lastError: 'Stored credential envelope failed to decrypt' },
        })
        continue
      }
      connections.push({
        id: c.id,
        login: c.login,
        password, // HTTPS + token-gated; never logged, never cached client-side
        server: c.brokerServer,
        label: c.label,
        desired: c.desired,
        status: c.status,
        lastDealTime: c.lastDealTime ? Math.floor(c.lastDealTime.getTime() / 1000) : null,
        syncRequestedAt: c.syncRequestedAt ? Math.floor(c.syncRequestedAt.getTime() / 1000) : null,
      })
    }

    if (seen.size) {
      await db.mt5Connection.updateMany({
        where: { id: { in: [...seen] } },
        data: { lastConnectorAt: now },
      })
    }
    await db.systemSetting.upsert({
      where: { key: 'mt5.connector.lastSeenAt' },
      create: { key: 'mt5.connector.lastSeenAt', value: now.toISOString() },
      update: { value: now.toISOString() },
    })

    return NextResponse.json({ connections, pollSeconds: 60 })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
