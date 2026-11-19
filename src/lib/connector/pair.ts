/**
 * CONNECT-1 pairing — account identity resolution at EA pair time.
 *
 * Identity contract (owner requirement): a connection is keyed by
 * platform + broker/server + login — never by display names. The same
 * external account reconnecting finds-or-reuses the SAME PlatformConnection
 * and the SAME journal Account (Account.externalAccountKey), so history can
 * never be duplicated by a reconnect, a terminal reinstall, or a token
 * rotation.
 *
 * Account resolution order at pair:
 *   1. an existing non-deleted Account with this externalAccountKey;
 *   2. the connection's already-linked accountId (user pre-linked it when
 *      creating the connection in the UI);
 *   3. otherwise auto-create "MT5 <login>" / "MT4 <login>" (name deduped).
 */
import { db } from '@/lib/db'
import { externalKeyOf, type ValidatedPair } from './protocol'

export interface PairOutcome {
  connectionId: string
  accountId: string
  accountName: string
  accountCurrency: string
  isNewConnection: boolean
  isNewAccount: boolean
}

const PLATFORM_LABEL: Record<string, string> = { mt5: 'MT5', mt4: 'MT4' }

/** Unique display label "MT5 <login>" (dedup suffix on collision). */
async function uniqueLabel(userId: string, base: string): Promise<string> {
  let label = base
  let n = 2
  // scoped to the user's own connections only (ownership namespace)
  for (;;) {
    const clash = await db.platformConnection.findFirst({
      where: { userId, label },
      select: { id: true },
    })
    if (!clash) return label
    label = `${base} (${n++})`
  }
}

/** Find-or-create the PlatformConnection for this EA identity. */
async function resolveConnection(
  userId: string,
  platform: string,
  externalKey: string,
  pair: ValidatedPair,
): Promise<{ connection: { id: string; accountId: string | null; externalKey: string | null; userId: string }; created: boolean }> {
  // Same external account reconnecting → same connection row.
  const existing = await db.platformConnection.findFirst({
    where: { userId, externalKey },
    select: { id: true, accountId: true, externalKey: true, userId: true },
  })
  if (existing) return { connection: existing, created: false }

  const label = await uniqueLabel(userId, `${PLATFORM_LABEL[platform] ?? platform} ${pair.account.login}`)
  const created = await db.platformConnection.create({
    data: {
      userId,
      platform,
      label,
      login: pair.account.login,
      broker: pair.account.company ?? null,
      server: pair.account.server ?? null,
      externalKey,
      status: 'connecting',
    },
    select: { id: true, accountId: true, externalKey: true, userId: true },
  })
  return { connection: created, created: true }
}

/** Find-or-create the journal Account for this external identity. */
async function resolveAccount(
  userId: string,
  platform: string,
  externalKey: string,
  pair: ValidatedPair,
  linkedAccountId: string | null,
): Promise<{ accountId: string; name: string; currency: string; created: boolean }> {
  // 1. existing account already carrying this external identity
  const byKey = await db.account.findFirst({
    where: { userId, externalAccountKey: externalKey, deletedAt: null },
    select: { id: true, name: true, currency: true },
  })
  if (byKey) return { accountId: byKey.id, name: byKey.name, currency: byKey.currency, created: false }

  // 2. a user pre-linked account (chosen in the UI when creating the
  //    connection) — stamp it as the owner of this external identity.
  if (linkedAccountId) {
    const linked = await db.account.findFirst({
      where: { id: linkedAccountId, userId },
      select: { id: true, name: true, currency: true, deletedAt: true },
    })
    if (linked && !linked.deletedAt) {
      await db.account.update({
        where: { id: linked.id },
        data: { externalAccountKey: externalKey },
      })
      return { accountId: linked.id, name: linked.name, currency: linked.currency, created: false }
    }
  }

  // 3. auto-create the journal account (import-bulk idiom: starting balance
  //    0 — the synced trades carry the real economics).
  const base = `${PLATFORM_LABEL[platform] ?? platform} ${pair.account.login}`
  let name = base
  let n = 2
  for (;;) {
    const clash = await db.account.findFirst({ where: { userId, name }, select: { id: true } })
    if (!clash) break
    name = `${base} (${n++})`
  }
  const account = await db.account.create({
    data: {
      userId,
      name,
      broker: pair.account.company || PLATFORM_LABEL[platform] || 'Platform',
      type: 'forex',
      currency: pair.account.currency ?? 'USD',
      startingBalance: 0,
      color: platform === 'mt4' ? '#f59e0b' : '#0ea5e9',
      externalAccountKey: externalKey,
    },
    select: { id: true, name: true, currency: true },
  })
  return { accountId: account.id, name: account.name, currency: account.currency, created: true }
}

/** Full pair resolution for an authenticated token. Throws on token/account
 * mismatch. Idempotent: re-pairing the same terminal reuses everything.
 *
 * IDENTITY FIRST: the (userId, externalKey) row is the single owner of the
 * external account — including a DISCONNECTED-but-kept row (disconnect never
 * deletes history, so it never releases the identity). Reconnecting the same
 * account therefore always REVIVES the original connection (and its journal
 * account) instead of colliding on the identity key; a redundant UI-created
 * row (created because the user clicked "connect" again while an old row
 * existed) is honestly marked disconnected/superseded. */
export async function pairConnection(
  tokenRow: { id: string; userId: string; connectionId: string | null; platform: string },
  pair: ValidatedPair,
): Promise<PairOutcome> {
  const externalKey = externalKeyOf(pair.platform, pair.account.server, pair.account.company, pair.account.login)

  // 1) The token's bound connection must not claim a DIFFERENT account.
  let bound: { id: string; externalKey: string | null; accountId: string | null } | null = null
  if (tokenRow.connectionId) {
    const b = await db.platformConnection.findUnique({
      where: { id: tokenRow.connectionId },
      select: { id: true, userId: true, externalKey: true, accountId: true },
    })
    if (!b || b.userId !== tokenRow.userId) {
      throw Object.assign(new Error('invalid token binding'), { status: 401 })
    }
    if (b.externalKey && b.externalKey !== externalKey) {
      throw Object.assign(new Error('token is paired to a different trading account'), { status: 409 })
    }
    bound = b
  }

  // 2) The existing owner of this identity (ANY status — a disconnected row
  //    still owns the account identity; reconnecting revives it).
  const owner = await db.platformConnection.findFirst({
    where: { userId: tokenRow.userId, externalKey },
    orderBy: { createdAt: 'asc' },
    select: { id: true, accountId: true },
  })
  if (owner && bound && owner.id !== bound.id) {
    // The user created a NEW connection row in the UI while an old row for
    // the same account existed — the old row wins (it owns the history).
    // The redundant row is honestly retired, never silently deleted.
    // CONNECT-6: the retired row carries the account identity FACTS
    // (login/server/broker — NOT externalKey: the (userId, externalKey)
    // unique constraint makes the owner row's only holder of that key). A
    // token still bound to it (rotated on the dead card AFTER retirement —
    // the exact trap that wedged the owner's terminal) can then be re-bound
    // to the live row by the heartbeat/events routes, which recompute the
    // external key from these facts, instead of 409-ing forever.
    await db.platformConnection.update({
      where: { id: bound.id },
      data: {
        status: 'disconnected',
        desired: 'disconnect',
        lastError: 'superseded — the existing connection for this account was revived',
        login: pair.account.login,
        broker: pair.account.company ?? null,
        server: pair.account.server ?? null,
      },
    })
    // rebind THIS token to the owning row FIRST (so the revoke sweep below
    // can never revoke the token that is pairing right now)
    await db.connectorToken.update({
      where: { id: tokenRow.id },
      data: { connectionId: owner.id },
    })
    // then revoke the redundant row's remaining tokens (its EA session dies)
    await db.connectorToken.updateMany({
      where: { connectionId: bound.id, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    })
  }
  const targetId = owner && (!bound || owner.id !== bound.id) ? owner.id : bound?.id

  // 3) Resolve the connection row (revive-or-create) and bind the token.
  let connectionId: string
  let isNewConnection = false
  if (targetId) {
    connectionId = targetId
    // revive: clear the disconnect markers so events flow again
    await db.platformConnection.update({
      where: { id: targetId },
      data: {
        externalKey,
        login: pair.account.login,
        broker: pair.account.company ?? null,
        server: pair.account.server ?? null,
        desired: 'sync',
        lastError: null,
      },
    })
  } else {
    const { connection, created } = await resolveConnection(
      tokenRow.userId,
      pair.platform,
      externalKey,
      pair,
    )
    connectionId = connection.id
    isNewConnection = created
  }
  if (bound && bound.id !== connectionId) {
    // token was bound to a superseded row — now bound to the owning row
  } else {
    await db.connectorToken.update({
      where: { id: tokenRow.id },
      data: { connectionId },
    })
  }

  // 4) The journal account (find by identity, pre-linked, or auto-create).
  const account = await resolveAccount(
    tokenRow.userId,
    pair.platform,
    externalKey,
    pair,
    (await db.platformConnection.findUnique({
      where: { id: connectionId },
      select: { accountId: true },
    }))?.accountId ?? null,
  )
  await db.platformConnection.update({
    where: { id: connectionId },
    data: { accountId: account.accountId },
  })
  return {
    connectionId,
    accountId: account.accountId,
    accountName: account.name,
    accountCurrency: account.currency,
    isNewConnection,
    isNewAccount: account.created,
  }
}

// ── CONNECT-6 ghost-token re-binding ────────────────────────────────────────

/** A connection row that was retired by a later pair (superseded) or
 *  disconnected, but a token minted for it is still ACTIVE — the EA holding
 *  that token keeps heartbeating/flushing into a dead row (409 on events,
 *  silent status confusion on beats). The live owner row for the SAME
 *  account is where its traffic belongs. */
export interface TokenBindingResolution {
  /** The connection row the token's requests should be processed against. */
  connectionId: string
  /** True when the token was re-bound away from a dead/ghost row. */
  rebound: boolean
  /** Set when the dead row carries no identity and the caller gave none
   *  (legacy ghosts created before CONNECT-6 breadcrumbs). */
  unresolved: boolean
}

/**
 * Resolve where a token's request belongs. If the token's bound row is a
 * ghost (retired/superseded, desired=disconnect) and a distinct OWNER row
 * for the same external account exists, re-bind the token to the owner and
 * return the owner — the EA's next beat/flush then lands on the live row.
 *
 * Identity sources, in order:
 *   1. the ghost row's identity FACTS (login/server/broker — the CONNECT-6
 *      breadcrumb written at pair-time retirement) recomputed into the
 *      external key with the exact pair-time normalization;
 *   2. the EA-reported account login (rides the heartbeat every 10th beat)
 *      matched by (userId, platform, login) among non-ghost rows — the
 *      legacy-ghost path (pre-CONNECT-6 rows retired with no facts).
 *
 * A token bound to a row the user GENUINELY disconnected (Disconnect… → all
 * its tokens revoked) never reaches this code — it 401s first. A ghost row
 * whose owner is also disconnected still re-binds: the beat then truthfully
 * reports desired=disconnect and the EA stays stopped. No history is ever
 * touched by this resolution — it is pure binding bookkeeping.
 */
export async function resolveTokenBinding(
  tokenRow: { id: string; userId: string; connectionId: string | null; platform: string },
  accountLogin?: string,
): Promise<TokenBindingResolution> {
  const ghostId = tokenRow.connectionId
  if (!ghostId) return { connectionId: '', rebound: false, unresolved: true }

  const ghost = await db.platformConnection.findFirst({
    where: { id: ghostId, userId: tokenRow.userId },
    select: { id: true, desired: true, status: true, login: true, server: true, broker: true },
  })
  // No row / ownership mismatch → the caller's own not-found handling applies.
  if (!ghost) return { connectionId: ghostId, rebound: false, unresolved: true }

  const retired = ghost.desired === 'disconnect' && (ghost.status === 'disconnected' || ghost.status === 'offline')
  if (!retired) return { connectionId: ghost.id, rebound: false, unresolved: false }

  // Owner by the ghost's identity facts (the CONNECT-6 breadcrumb) → external key
  let owner: { id: string } | null = null
  if (ghost.login && ghost.login.trim()) {
    const key = externalKeyOf(tokenRow.platform, ghost.server ?? undefined, ghost.broker ?? undefined, ghost.login)
    owner = await db.platformConnection.findFirst({
      where: { userId: tokenRow.userId, externalKey: key, id: { not: ghost.id } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  }
  // …or by EA-reported login (legacy ghost rows retired before CONNECT-6
  // carry no identity facts at all).
  if (!owner && accountLogin && accountLogin.trim()) {
    owner = await db.platformConnection.findFirst({
      where: {
        userId: tokenRow.userId,
        platform: tokenRow.platform,
        login: accountLogin.trim(),
        id: { not: ghost.id },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  }
  if (!owner) return { connectionId: ghost.id, rebound: false, unresolved: true }

  await db.connectorToken
    .update({ where: { id: tokenRow.id }, data: { connectionId: owner.id } })
    .catch(() => {})
  return { connectionId: owner.id, rebound: true, unresolved: false }
}
