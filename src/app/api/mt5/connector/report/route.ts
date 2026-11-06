import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { connectorTokenOk, hasConnectorToken, rateLimitConnector, unauthorized } from '@/lib/mt5/connector-auth'
import { ingestDeals } from '@/lib/mt5/ingest'
import type { Mt5DealInput } from '@/lib/mt5/normalize'

export const dynamic = 'force-dynamic'

/**
 * MT5-LINK connector report (Task MT5LINK) — the write-back path. Token-gated
 * (timing-safe), rate-limited, strictly validated. The connector reports:
 *
 *   event=connected  → account verified: store the snapshot, auto-create the
 *                      journal Account that receives the imported trades.
 *   event=sync       → deals[] (COMPLETE deal set per touched position — see
 *                      lib/mt5/ingest.ts) → idempotent ingest + sync log.
 *   event=error      → honest status/lastError + error sync log.
 *   event=disconnected → terminal torn down (row keeps history until removed).
 *
 * No other write capability exists on this route — no trade edits, no user
 * data, no order endpoints anywhere in the app.
 */

const MAX_DEALS = 5000

interface ReportBody {
  connectionId?: unknown
  event?: unknown
  accountInfo?: unknown
  deals?: unknown
  error?: unknown
}

function parseAccountInfo(raw: unknown): {
  login: number
  currency: string
  leverage: number
  balance: number
  equity: number
  server: string
  company: string
  name?: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const login = Number(o.login)
  const balance = Number(o.balance)
  const equity = Number(o.equity)
  const leverage = Number(o.leverage)
  if (!Number.isFinite(login) || !Number.isFinite(balance) || !Number.isFinite(equity)) return null
  return {
    login: Number.isInteger(login) ? login : 0,
    currency: typeof o.currency === 'string' && o.currency.trim() ? o.currency.trim().slice(0, 12) : 'USD',
    leverage: Number.isFinite(leverage) && leverage > 0 ? Math.round(leverage) : 0,
    balance: +balance.toFixed(2),
    equity: +equity.toFixed(2),
    server: typeof o.server === 'string' ? o.server.slice(0, 64) : '',
    company: typeof o.company === 'string' ? o.company.slice(0, 80) : '',
    name: typeof o.name === 'string' ? o.name.slice(0, 80) : undefined,
  }
}

/** Deal validation + MT5 int-enum tolerance (gateway sends raw ints). */
function parseDeal(raw: unknown): Mt5DealInput | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ticket = Number(o.ticket)
  const positionTicket = Number(o.positionTicket ?? o.position)
  const time = Number(o.time)
  const volume = Number(o.volume)
  const price = Number(o.price)
  if (!Number.isInteger(ticket) || ticket <= 0) return null
  if (!Number.isInteger(positionTicket) || positionTicket <= 0) return null
  if (!Number.isFinite(time) || time <= 0) return null
  if (!Number.isFinite(volume) || volume <= 0) return null
  if (!Number.isFinite(price) || price <= 0) return null

  const entryRaw = o.entry
  let entry: Mt5DealInput['entry']
  if (entryRaw === 'in' || entryRaw === 0) entry = 'in'
  else if (entryRaw === 'out' || entryRaw === 1) entry = 'out'
  else if (entryRaw === 'inout' || entryRaw === 2) entry = 'inout'
  else if (entryRaw === 'out_by' || entryRaw === 3) entry = 'out_by'
  else return null

  const sideRaw = o.side ?? o.type
  let side: Mt5DealInput['side']
  if (sideRaw === 'buy' || sideRaw === 0) side = 'buy'
  else if (sideRaw === 'sell' || sideRaw === 1) side = 'sell'
  else return null

  const symbol = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : ''
  if (!symbol || symbol.length > 24) return null

  return {
    ticket,
    positionTicket,
    time: Math.floor(time),
    entry,
    side,
    volume,
    price,
    commission: Number.isFinite(Number(o.commission)) ? Number(o.commission) : 0,
    swap: Number.isFinite(Number(o.swap)) ? Number(o.swap) : 0,
    profit: Number.isFinite(Number(o.profit)) ? Number(o.profit) : 0,
    symbol,
    comment: typeof o.comment === 'string' ? o.comment.slice(0, 200) : undefined,
  }
}

async function logSync(
  connectionId: string,
  kind: string,
  status: string,
  counts: { dealsScanned?: number; tradesCreated?: number; tradesUpdated?: number; duplicatesSkipped?: number },
  error?: string,
  detail?: string,
) {
  await db.mt5SyncLog.create({
    data: {
      connectionId,
      kind,
      status,
      dealsScanned: counts.dealsScanned ?? 0,
      tradesCreated: counts.tradesCreated ?? 0,
      tradesUpdated: counts.tradesUpdated ?? 0,
      duplicatesSkipped: counts.duplicatesSkipped ?? 0,
      error: error ? error.slice(0, 500) : null,
      detail: detail ? detail.slice(0, 1000) : null,
      finishedAt: new Date(),
    },
  })
}

/** Find-or-create the journal Account that receives this connection's trades. */
async function ensureJournalAccount(
  userId: string,
  login: number,
  server: string,
  accountInfo: NonNullable<ReturnType<typeof parseAccountInfo>>,
): Promise<string> {
  const label = `MT5 ${login}`
  const existing = await db.account.findFirst({
    where: { userId, name: { startsWith: label } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (existing) return existing.id
  const account = await db.account.create({
    data: {
      userId,
      name: label,
      broker: accountInfo.company || 'MetaTrader 5',
      type: 'forex',
      currency: accountInfo.currency || 'USD',
      startingBalance: 0, // honest: MT5 reports current balance, not inception
      color: '#0ea5e9',
    },
    select: { id: true },
  })
  return account.id
}

export async function POST(req: NextRequest) {
  try {
    if (!hasConnectorToken() || !connectorTokenOk(req)) return unauthorized()
    if (!rateLimitConnector('report')) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
    }
    const body = (await req.json().catch(() => null)) as ReportBody | null
    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : ''
    const event = typeof body?.event === 'string' ? body.event : ''
    if (!connectionId || !['connected', 'sync', 'error', 'disconnected'].includes(event)) {
      return NextResponse.json({ error: 'connectionId and event (connected|sync|error|disconnected) are required' }, { status: 400 })
    }

    const connection = await db.mt5Connection.findUnique({ where: { id: connectionId } })
    if (!connection) return NextResponse.json({ error: 'Connection not found (removed?)' }, { status: 404 })
    const now = new Date()

    if (event === 'connected') {
      const info = parseAccountInfo(body?.accountInfo)
      if (!info) {
        await logSync(connection.id, 'connect', 'error', {}, 'Invalid accountInfo in connected report')
        return NextResponse.json({ error: 'accountInfo is required for event=connected' }, { status: 400 })
      }
      // Guard against wrong credentials: the reported login must match the
      // stored one (broker logins are unique per server).
      if (Number.isInteger(info.login) && info.login > 0 && info.login !== connection.login) {
        await db.mt5Connection.update({
          where: { id: connection.id },
          data: {
            status: 'error',
            lastError: `Gateway logged into account ${info.login} but this connection is for ${connection.login} (check the broker server name).`,
          },
        })
        await logSync(connection.id, 'connect', 'error', {}, 'Login mismatch')
        return NextResponse.json({ error: 'Login mismatch' }, { status: 409 })
      }
      const accountId = await ensureJournalAccount(connection.userId, connection.login, connection.brokerServer, info)
      await db.mt5Connection.update({
        where: { id: connection.id },
        data: {
          status: 'connected',
          desired: 'sync',
          lastError: null,
          accountInfo: JSON.stringify(info),
          accountId,
          lastConnectorAt: now,
        },
      })
      await logSync(connection.id, 'connect', 'ok', {}, undefined, JSON.stringify(info))
      return NextResponse.json({ ok: true, accountId })
    }

    if (event === 'sync') {
      if (!Array.isArray(body?.deals) || body.deals.length === 0) {
        return NextResponse.json({ error: 'deals[] is required for event=sync' }, { status: 400 })
      }
      if (body.deals.length > MAX_DEALS) {
        return NextResponse.json({ error: `Too many deals in one report (max ${MAX_DEALS})` }, { status: 413 })
      }
      const deals = body.deals.map(parseDeal).filter((d): d is Mt5DealInput => d !== null)
      const accountInfo = parseAccountInfo(body?.accountInfo)
      const counts = await ingestDeals(connection, deals)
      const maxDealTime = deals.length ? Math.max(...deals.map((d) => d.time)) : null
      await db.mt5Connection.update({
        where: { id: connection.id },
        data: {
          lastConnectorAt: now,
          lastSyncAt: now,
          lastDealTime: maxDealTime ? new Date(maxDealTime * 1000) : connection.lastDealTime,
          accountInfo: accountInfo ? JSON.stringify(accountInfo) : undefined,
          ...(connection.status !== 'connected' ? { status: 'connected', desired: 'sync', lastError: null } : {}),
        },
      })
      await logSync(connection.id, 'sync', 'ok', counts, undefined, accountInfo ? JSON.stringify(accountInfo) : undefined)
      return NextResponse.json({ ok: true, ...counts })
    }

    if (event === 'error') {
      const error = typeof body?.error === 'string' ? body.error.slice(0, 500) : 'Unknown connector error'
      await db.mt5Connection.update({
        where: { id: connection.id },
        data: { status: 'error', lastError: error, lastConnectorAt: now },
      })
      await logSync(connection.id, 'error', 'error', {}, error)
      return NextResponse.json({ ok: true })
    }

    // event === 'disconnected'
    await db.mt5Connection.update({
      where: { id: connection.id },
      data: { status: 'disconnected', lastConnectorAt: now },
    })
    await logSync(connection.id, 'disconnect', 'ok', {})
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed', detail: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
      { status: 500 },
    )
  }
}
