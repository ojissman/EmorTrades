/**
 * ============================================================================
 * worker-client — Node-side manager for the Bun fetch adapter
 * ============================================================================
 * Spawns `bun scripts/market-fetch-worker.ts` as a detached child and talks
 * JSON-lines over stdio. One child per server process (globalThis singleton,
 * HMR-safe), auto-restarted with backoff if it ever dies. No port, no HTTP —
 * the Yahoo-capable TLS fingerprint is the only thing we borrow from Bun.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

export interface WorkerJsonResponse {
  ok: true
  status: number
  body: string
}

interface Pending {
  resolve: (v: WorkerJsonResponse) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerState {
  proc: ChildProcess | null
  lastStartAt: number
  restarts: number
  lastExit: { at: number; code: number | null; reason: string } | null
  pending: Map<number, Pending>
  nextId: number
  buffer: string
  spawnError: string | null
  requests: number
  failures: number
}

const G = Symbol.for('tradesviz.market.worker')
const g = ((globalThis as Record<symbol, unknown>)[G] as WorkerState | undefined) ?? {
  proc: null,
  lastStartAt: 0,
  restarts: 0,
  lastExit: null,
  pending: new Map<number, Pending>(),
  nextId: 1,
  buffer: '',
  spawnError: null,
  requests: 0,
  failures: 0,
}
;(globalThis as Record<symbol, unknown>)[G] = g

const RESTART_BACKOFF_MS = 3_000
const REQUEST_TIMEOUT_MS = 30_000

function workerFile(): string {
  return path.join(process.cwd(), 'scripts', 'market-fetch-worker.ts')
}

function ensureWorker(): ChildProcess | null {
  if (g.proc && g.proc.exitCode === null && !g.proc.killed) return g.proc
  // Backoff between restarts — a crash-looping adapter must not busy-spin.
  if (Date.now() - g.lastStartAt < RESTART_BACKOFF_MS) return null
  g.lastStartAt = Date.now()
  try {
    const proc = spawn('bun', [workerFile()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    g.proc = proc
    g.spawnError = null

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      g.buffer += chunk
      const lines = g.buffer.split('\n')
      g.buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let msg: { id?: number; ok?: boolean; status?: number; body?: string; error?: string }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof msg.id !== 'number') continue
        const p = g.pending.get(msg.id)
        if (!p) continue
        g.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok === true && typeof msg.status === 'number' && typeof msg.body === 'string') {
          p.resolve({ ok: true, status: msg.status, body: msg.body })
        } else {
          p.reject(new Error(msg.error || 'fetch worker failed'))
        }
      }
    })
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      const t = chunk.trim()
      if (t) console.error(`[market-worker] ${t}`)
    })
    proc.on('exit', (code, signal) => {
      g.lastExit = { at: Date.now(), code, reason: signal ?? `exit ${code}` }
      g.restarts++
      // Fail everything still pending — callers retry/report honestly.
      for (const [, p] of g.pending) {
        clearTimeout(p.timer)
        p.reject(new Error('market fetch worker exited'))
      }
      g.pending.clear()
      if (g.proc === proc) g.proc = null
    })
    proc.on('error', (err) => {
      g.spawnError = err.message
      if (g.proc === proc) g.proc = null
    })
    return proc
  } catch (e) {
    g.spawnError = e instanceof Error ? e.message : String(e)
    return null
  }
}

/** Stats for /api/market/health + the Settings system-health card. */
export function workerStats() {
  return {
    alive: Boolean(g.proc && g.proc.exitCode === null && !g.proc.killed),
    pid: g.proc?.pid ?? null,
    restarts: g.restarts,
    requests: g.requests,
    failures: g.failures,
    spawnError: g.spawnError,
    lastExitAt: g.lastExit ? new Date(g.lastExit.at).toISOString() : null,
  }
}

/**
 * Fetch a URL through the Bun adapter. Returns status + raw body text.
 * Throws on transport failure/timeout (never fabricates data).
 */
export function workerFetch(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<WorkerJsonResponse> {
  const proc = ensureWorker()
  if (!proc) {
    return Promise.reject(
      new Error(
        g.spawnError
          ? `market fetch worker unavailable (${g.spawnError})`
          : 'market fetch worker unavailable (restarting)',
      ),
    )
  }
  const id = g.nextId++
  g.requests++
  return new Promise<WorkerJsonResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      g.pending.delete(id)
      g.failures++
      reject(new Error('market fetch worker timed out'))
    }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
    g.pending.set(id, { resolve, reject, timer })
    const line = JSON.stringify({ id, url, headers: opts.headers, timeoutMs: opts.timeoutMs }) + '\n'
    proc.stdin?.write(line, (err) => {
      if (err) {
        const p = g.pending.get(id)
        if (p) {
          clearTimeout(p.timer)
          g.pending.delete(id)
          g.failures++
          p.reject(new Error(`market fetch worker write failed: ${err.message}`))
        }
      }
    })
  })
}
