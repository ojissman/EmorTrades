#!/usr/bin/env node
/**
 * mt5-link — self-hosted read-only MetaTrader 5 connector for EmorTrades.
 * ============================================================================
 * MIT licensed. Part of the EmorTrades repository (Task MT5LINK, 2026-11-06).
 *
 * WHAT IT DOES
 *   Polls the journal's token-gated connector API, spawns ONE
 *   elitekaycy/mt5-gateway Docker container per MT5 connection (headless MT5
 *   terminal under Wine), verifies the login, and reports account info +
 *   COMPLETE deal sets of every touched position back to the journal. The
 *   journal does the math (partial closes, dedup, P&L) — this service is a
 *   dumb, honest pipe.
 *
 * READ-ONLY BY CONSTRUCTION
 *   1. It only ever CALLS the gateway's read endpoints: /health/ready,
 *      /account, /history_deals_range, /history_deals_get. No order, close
 *      or modify endpoint appears anywhere in this file.
 *   2. It mounts a kill-switch file into every gateway container
 *      (/config/kill-switch) — the gateway's own trading kill-switch.
 *
 * SECURITY
 *   · JOURNAL_TOKEN is the only credential this service holds; it grants
 *     exactly the MT5 connector API — nothing else.
 *   · MT5 passwords arrive over HTTPS inside the token-gated pending
 *     response, live only in memory + the spawned container's environment
 *     (the gateway's own documented mechanism), and are never logged.
 *   · Gateway containers bind to 127.0.0.1 only — nothing is exposed to
 *     the network.
 *   · Config volumes (which hold the terminal profile) are removed when a
 *     connection is disconnected.
 *
 * Zero npm dependencies: Node >= 20 built-ins only (fetch, execFile, crypto).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const exec = promisify(execFile)

// ── Configuration (env) ──────────────────────────────────────────────────────
const JOURNAL_URL = (process.env.JOURNAL_URL || '').replace(/\/+$/, '')
const JOURNAL_TOKEN = process.env.JOURNAL_TOKEN || ''
const POLL_SECONDS = Math.max(15, Number(process.env.POLL_SECONDS || 60))
const SYNC_SECONDS = Math.max(60, Number(process.env.SYNC_SECONDS || 300))
const IMAGE = process.env.MT5_GATEWAY_IMAGE || 'elitekaycy/mt5-gateway-api:latest'
const PORT_BASE = Number(process.env.PORT_BASE || 15100)
const PORT_MAX = Number(process.env.PORT_MAX || 15999)
const READY_TIMEOUT_S = Number(process.env.READY_TIMEOUT_S || 900) // 15 min — first terminal download is slow
const FULL_HISTORY_FROM = process.env.FULL_HISTORY_FROM || '2015-01-01T00:00:00Z'
// Kill-switch: KILL_SWITCH_FILE is this process's view of the file;
// KILL_SWITCH_HOST_FILE is the same file as seen by the Docker daemon
// (identical when running natively; differs when mt5-link itself is
// containerized and the file is bind-mounted in).
const KILL_SWITCH_FILE = process.env.KILL_SWITCH_FILE || resolve('data/kill-switch')
const KILL_SWITCH_HOST_FILE = process.env.KILL_SWITCH_HOST_FILE || KILL_SWITCH_FILE

if (!JOURNAL_URL || !JOURNAL_TOKEN) {
  console.error('[mt5-link] JOURNAL_URL and JOURNAL_TOKEN are required (see README.md)')
  process.exit(1)
}

const log = (...a) => console.log(`[mt5-link ${new Date().toISOString()}]`, ...a)

// ── Docker helpers ───────────────────────────────────────────────────────────
async function docker(args, opts = {}) {
  try {
    const { stdout } = await exec('docker', args, { timeout: 120_000, ...opts })
    return stdout.trim()
  } catch (e) {
    throw new Error(`docker ${args.join(' ')}: ${(e.stderr || e.message || '').toString().trim().slice(0, 300)}`)
  }
}

// ── Journal API ──────────────────────────────────────────────────────────────
async function journal(path, init = {}) {
  const res = await fetch(`${JOURNAL_URL}${path}`, {
    ...init,
    headers: {
      'x-connector-token': JOURNAL_TOKEN,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 200) } }
  if (!res.ok) throw new Error(`journal ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

// ── Gateway HTTP (localhost only, per-container API key) ─────────────────────
async function gw(port, apiKey, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`gateway ${path} → ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

// ── Connection runtime state ─────────────────────────────────────────────────
/** @type {Map<string, {id:string,port:number,apiKey:string,container:string,ready:boolean,connecting:boolean,lastSyncAt:number,lastErrorAt:number}>} */
const state = new Map()

function ensureKillSwitch() {
  try {
    mkdirSync(resolve(KILL_SWITCH_FILE, '..'), { recursive: true })
    if (!existsSync(KILL_SWITCH_FILE)) {
      writeFileSync(KILL_SWITCH_FILE, 'active\n')
      log(`kill-switch engaged: ${KILL_SWITCH_FILE} (host view: ${KILL_SWITCH_HOST_FILE})`)
    }
  } catch (e) {
    // Non-fatal: read-only enforcement layer 1 (endpoint whitelist) still holds.
    log(`WARN kill-switch file could not be created (${e.message}) — gateway trading stays blocked only by the endpoint whitelist`)
  }
}

async function usedPorts() {
  const out = await docker(['ps', '-a', '--filter', 'name=mt5link-', '--format', '{{.Names}}\t{{.Ports}}'])
  const set = new Set()
  for (const line of out.split('\n').filter(Boolean)) {
    const m = line.match(/127\.0\.0\.1:(\d+)->/)
    if (m) set.add(Number(m[1]))
  }
  return set
}

function allocPort(taken) {
  for (let p = PORT_BASE; p <= PORT_MAX; p++) if (!taken.has(p)) return p
  throw new Error(`no free port in ${PORT_BASE}-${PORT_MAX}`)
}

async function spawnContainer(conn) {
  const taken = await usedPorts()
  const port = allocPort(taken)
  const apiKey = randomBytes(24).toString('hex')
  const name = `mt5link-${conn.id}`
  const args = [
    'run', '-d', '--name', name, '--restart', 'unless-stopped',
    '-p', `127.0.0.1:${port}:5001`,
    '-v', `mt5link-${conn.id}-config:/config`,
  ]
  if (existsSync(KILL_SWITCH_FILE)) {
    args.push('-v', `${KILL_SWITCH_HOST_FILE}:/config/kill-switch:ro`)
  }
  args.push(
    '-e', `MT5_LOGIN=${conn.login}`,
    '-e', `MT5_PASSWORD=${conn.password}`,
    '-e', `MT5_SERVER=${conn.server}`,
    '-e', `API_KEY=${apiKey}`,
    IMAGE,
  )
  await docker(args)
  log(`spawned ${name} (127.0.0.1:${port}) for login ${conn.login} @ ${conn.server}`)
  return { id: conn.id, port, apiKey, container: name, ready: false, connecting: true, lastSyncAt: 0, lastErrorAt: 0 }
}

async function teardown(id, { removeVolume = true } = {}) {
  const name = `mt5link-${id}`
  await docker(['rm', '-f', name]).catch(() => undefined)
  if (removeVolume) await docker(['volume', 'rm', `mt5link-${id}-config`]).catch(() => undefined)
  state.delete(id)
  log(`torn down ${name}${removeVolume ? ' (+ config volume — terminal profile with saved credentials removed)' : ''}`)
}

async function recoverExistingContainers() {
  // Reconnect state after a mt5-link restart: containers persist (restart:
  // unless-stopped); read port + API key back via docker inspect.
  const out = await docker(['ps', '-a', '--filter', 'name=mt5link-', '--format', '{{.Names}}'])
  for (const name of out.split('\n').filter(Boolean)) {
    const id = name.replace(/^mt5link-/, '')
    try {
      const portMap = await docker(['port', name])
      const m = portMap.match(/127\.0\.0\.1:(\d+)->5001/)
      if (!m) { log(`WARN ${name}: no 127.0.0.1 port mapping — recreating on next reconcile`); continue }
      const envOut = await docker(['inspect', name, '--format', '{{range .Config.Env}}{{println .}}{{end}}'])
      const apiKey = (envOut.match(/^API_KEY=(.+)$/m) || [])[1]
      if (!apiKey) { log(`WARN ${name}: API_KEY unreadable — recreating`); continue }
      state.set(id, { id, port: Number(m[1]), apiKey, container: name, ready: false, connecting: false, lastSyncAt: 0, lastErrorAt: 0 })
      log(`recovered ${name} (127.0.0.1:${m[1]})`)
    } catch (e) {
      log(`WARN could not recover ${name}: ${e.message}`)
    }
  }
}

// ── Per-connection lifecycle ─────────────────────────────────────────────────
async function waitReady(st) {
  const deadline = Date.now() + READY_TIMEOUT_S * 1000
  while (Date.now() < deadline) {
    try {
      const h = await gw(st.port, st.apiKey, '/health/ready')
      if (h && (h.status === 'ready' || h.mt5_status === 'connected')) return true
    } catch { /* not up yet */ }
    await sleep(5000)
  }
  return false
}

async function ensureConnected(conn) {
  let st = state.get(conn.id)
  if (!st) {
    st = await spawnContainer(conn)
    state.set(conn.id, st)
  }
  if (st.ready || st.connecting) return st
  st.connecting = true
  return st
}

async function reportConnected(conn, st) {
  const account = await gw(st.port, st.apiKey, '/account')
  await journal('/api/mt5/connector/report', {
    method: 'POST',
    body: JSON.stringify({
      connectionId: conn.id,
      event: 'connected',
      accountInfo: {
        login: account.login,
        currency: account.currency,
        leverage: account.leverage,
        balance: account.balance,
        equity: account.equity,
        server: account.server,
        company: account.company,
        name: account.name,
      },
    }),
  })
  st.ready = true
  st.connecting = false
  log(`connected ${conn.label} (login ${conn.login}) — journal account ready`)
}

/** Sync one connection: incremental window → complete per-position deal sets. */
async function syncConnection(conn, st) {
  const from = conn.lastDealTime ? new Date((conn.lastDealTime - 300) * 1000).toISOString() : FULL_HISTORY_FROM
  const to = new Date().toISOString()
  const fresh = await gw(st.port, st.apiKey, `/history_deals_range?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`)
  if (!Array.isArray(fresh) || fresh.length === 0) {
    // Nothing new — still report a heartbeat sync so the journal logs cadence.
    const account = await gw(st.port, st.apiKey, '/account').catch(() => null)
    await journal('/api/mt5/connector/report', {
      method: 'POST',
      body: JSON.stringify({ connectionId: conn.id, event: 'sync', deals: [], accountInfo: account }),
    }).catch((e) => log(`WARN sync-report(empty) ${conn.id}: ${e.message}`))
    return
  }
  // COMPLETE deal sets per touched position (journal recomputes truth from
  // full sets — that is the contract in lib/mt5/ingest.ts).
  const positions = [...new Set(fresh.map((d) => Number(d.positionTicket ?? d.position)).filter((p) => Number.isInteger(p) && p > 0))]
  const byTicket = new Map()
  for (const d of fresh) byTicket.set(d.ticket, d)
  for (const p of positions) {
    const deals = await gw(st.port, st.apiKey, `/history_deals_get?position=${p}&from_date=${encodeURIComponent(FULL_HISTORY_FROM)}&to_date=${encodeURIComponent(to)}`)
    if (Array.isArray(deals)) for (const d of deals) byTicket.set(d.ticket, d)
  }
  const account = await gw(st.port, st.apiKey, '/account').catch(() => null)
  const res = await journal('/api/mt5/connector/report', {
    method: 'POST',
    body: JSON.stringify({
      connectionId: conn.id,
      event: 'sync',
      deals: [...byTicket.values()],
      accountInfo: account,
    }),
  })
  st.lastSyncAt = Date.now()
  log(`synced ${conn.label}: +${res.tradesCreated} new, ${res.tradesUpdated} updated, ${res.duplicatesSkipped} duplicates skipped (${res.dealsScanned} deals)`)
}

// ── Main loop ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function reconcile() {
  const pending = await journal('/api/mt5/connector/pending')
  const conns = pending.connections || []
  const activeIds = new Set(conns.filter((c) => c.desired !== 'disconnect').map((c) => c.id))

  // Teardown: removed or disconnect-requested connections.
  for (const id of [...state.keys()]) {
    if (!activeIds.has(id)) {
      await teardown(id)
      await journal('/api/mt5/connector/report', {
        method: 'POST',
        body: JSON.stringify({ connectionId: id, event: 'disconnected' }),
      }).catch(() => undefined)
    }
  }
  for (const c of conns) {
    if (c.desired === 'disconnect' && state.has(c.id)) {
      await teardown(c.id)
      await journal('/api/mt5/connector/report', {
        method: 'POST',
        body: JSON.stringify({ connectionId: c.id, event: 'disconnected' }),
      }).catch(() => undefined)
    }
  }

  // Ensure + connect + sync.
  for (const c of conns) {
    if (c.desired === 'disconnect') continue
    let st = state.get(c.id)
    if (!st) st = await ensureConnected(c)

    if (!st.ready) {
      if (st.connecting && !st._waiting) {
        st._waiting = true
        waitReady(st)
          .then(async (ok) => {
            st._waiting = false
            if (ok) await reportConnected(c, st)
            else {
              st.connecting = false
              const err = `terminal not ready after ${READY_TIMEOUT_S}s (check login/password/server)`
              await journal('/api/mt5/connector/report', {
                method: 'POST',
                body: JSON.stringify({ connectionId: c.id, event: 'error', error: err }),
              }).catch(() => undefined)
              log(`ERROR ${c.id}: ${err}`)
              await teardown(c.id)
            }
          })
          .catch(async (e) => {
            st._waiting = false
            st.connecting = false
            await journal('/api/mt5/connector/report', {
              method: 'POST',
              body: JSON.stringify({ connectionId: c.id, event: 'error', error: String(e.message || e).slice(0, 400) }),
            }).catch(() => undefined)
            log(`ERROR ${c.id}: ${e.message}`)
            await teardown(c.id)
          })
      }
      continue
    }

    // Ready → periodic or requested sync.
    const due = (Date.now() - st.lastSyncAt) / 1000 >= SYNC_SECONDS
    const requested = c.syncRequestedAt && (!c.lastDealTime || c.syncRequestedAt * 1000 > st.lastSyncAt)
    if (due || requested) {
      try {
        await syncConnection(c, st)
      } catch (e) {
        // Transient gateway errors: report honestly, retry next poll cycle.
        if (Date.now() - st.lastErrorAt > 300_000) {
          st.lastErrorAt = Date.now()
          await journal('/api/mt5/connector/report', {
            method: 'POST',
            body: JSON.stringify({ connectionId: c.id, event: 'error', error: String(e.message || e).slice(0, 400) }),
          }).catch(() => undefined)
        }
        log(`ERROR sync ${c.id}: ${e.message}`)
      }
    }
  }
}

async function main() {
  log(`mt5-link starting — journal ${JOURNAL_URL}, image ${IMAGE}, poll ${POLL_SECONDS}s, sync ${SYNC_SECONDS}s`)
  await docker(['version', '--format', '{{.Server.Version}}']).catch((e) => {
    console.error(`[mt5-link] FATAL: docker is not reachable (${e.message}). This service needs the Docker daemon (see README.md).`)
    process.exit(1)
  })
  ensureKillSwitch()
  await recoverExistingContainers()
  while (true) {
    try {
      await reconcile()
    } catch (e) {
      log(`reconcile error: ${e.message}`)
    }
    await sleep(POLL_SECONDS * 1000)
  }
}

main().catch((e) => {
  console.error('[mt5-link] FATAL:', e)
  process.exit(1)
})
