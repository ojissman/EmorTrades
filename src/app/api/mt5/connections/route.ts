import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { encryptSecret, hasCredentialKey } from '@/lib/mt5/crypto'

export const dynamic = 'force-dynamic'

/**
 * MT5-LINK session routes (Task MT5LINK).
 *
 * GET  /api/mt5/connections — the signed-in user's connections (MASKED:
 *     never the password, never the encrypted envelope) + live connector
 *     status (online ⇔ the self-hosted mt5-link service polled within the
 *     last 150s — heartbeat in SystemSetting).
 * POST /api/mt5/connections — connect a new MT5 account: validates the
 *     login/password/server triple, encrypts the password (AES-256-GCM) and
 *     leaves the row PENDING — the connector picks it up on its next poll.
 */

const CONNECTOR_ONLINE_WINDOW_MS = 150_000

async function connectorHeartbeat(): Promise<{ online: boolean; lastSeenAt: string | null }> {
  const row = await db.systemSetting.findUnique({ where: { key: 'mt5.connector.lastSeenAt' } })
  if (!row) return { online: false, lastSeenAt: null }
  const online = Date.now() - new Date(row.value).getTime() < CONNECTOR_ONLINE_WINDOW_MS
  return { online, lastSeenAt: row.value }
}

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const [connections, connector] = await Promise.all([
      db.mt5Connection.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { syncLogs: true, trades: true } } },
      }),
      connectorHeartbeat(),
    ])
    return NextResponse.json({
      connections: connections.map((c) => ({
        id: c.id,
        label: c.label,
        login: c.login,
        brokerServer: c.brokerServer,
        status: c.status,
        lastError: c.lastError,
        accountInfo: c.accountInfo ? JSON.parse(c.accountInfo) : null,
        accountId: c.accountId,
        lastSyncAt: c.lastSyncAt,
        syncRequestedAt: c.syncRequestedAt,
        lastConnectorAt: c.lastConnectorAt,
        createdAt: c.createdAt,
        tradeCount: c._count.trades,
        syncCount: c._count.syncLogs,
        // security by construction: no password field, no envelope field
      })),
      connector,
    })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (!hasCredentialKey()) {
      return NextResponse.json(
        { error: 'MT5 credential encryption is not configured on this server (MT5_CREDENTIAL_KEY).' },
        { status: 503 },
      )
    }

    const body = await req.json().catch(() => null)
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : ''
    const loginRaw = body?.login
    const password = typeof body?.password === 'string' ? body.password : ''
    const server = typeof body?.server === 'string' ? body.server.trim() : ''

    const login = Number(loginRaw)
    if (!Number.isInteger(login) || login <= 0 || login > 9_999_999_999) {
      return NextResponse.json({ error: 'MT5 login must be a positive account number.' }, { status: 400 })
    }
    if (!password || password.length > 64) {
      return NextResponse.json({ error: 'MT5 password is required (max 64 chars).' }, { status: 400 })
    }
    if (!server || server.length > 64) {
      return NextResponse.json(
        { error: 'Broker server is required (exactly as in the MT5 terminal, e.g. "Exness-MT5Trial9").' },
        { status: 400 },
      )
    }

    // Label default: MT5 <login> (deduped with a counter when repeated).
    let finalLabel = label || `MT5 ${login}`
    const sameLabel = await db.mt5Connection.count({ where: { userId: user.id, label: finalLabel } })
    if (sameLabel > 0) finalLabel = `${finalLabel} (${sameLabel + 1})`

    const connection = await db.mt5Connection.create({
      data: {
        userId: user.id,
        label: finalLabel,
        login,
        brokerServer: server,
        encryptedPassword: encryptSecret(password),
        status: 'pending',
        desired: 'connect',
      },
      select: { id: true, label: true, login: true, brokerServer: true, status: true, createdAt: true },
    })
    return NextResponse.json({ connection }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
