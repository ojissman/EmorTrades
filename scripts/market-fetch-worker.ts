#!/usr/bin/env bun
/**
 * ============================================================================
 * market-fetch-worker — the invisible fetch adapter (Bun runtime, stdio only)
 * ============================================================================
 * WHY THIS EXISTS: Yahoo Finance TLS-fingerprints HTTP clients — Node's
 * undici fetch gets 429'd, Bun's fetch passes (re-verified 2026-10-12:
 * Node → 429 on both query hosts, Bun → 200). The whole app is ONE Next.js
 * build on Node, so the Yahoo-capable fetch lives in this tiny child process.
 *
 * Task 172 (one-service architecture): this is NOT a service — no port, no
 * HTTP, no package.json, nothing user-visible. The Next.js server spawns it
 * via src/lib/market/worker-client.ts and talks JSON-lines over stdio:
 *
 *   stdin  → { id, url, headers?, timeoutMs? }
 *   stdout ← { id, ok: true, status, body }   — body is the raw text
 *          | { id, ok: false, error }
 *
 * It is a dumb pipe: ALL business logic (symbol resolution, caching,
 * interval degradation, retries) lives in src/lib/market/yahoo.ts inside
 * the app. The worker only lends its TLS fingerprint.
 */

interface Req {
  id: number
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}

function out(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function handle(req: Req): Promise<void> {
  const timeoutMs = Math.min(Math.max(req.timeoutMs ?? 25_000, 1_000), 60_000)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(req.url, {
      headers: req.headers,
      signal: ctrl.signal,
      redirect: 'manual',
    })
    const body = await res.text()
    out({ id: req.id, ok: true, status: res.status, body })
  } catch (e) {
    const aborted = e instanceof Error && /abort/i.test(e.message)
    out({ id: req.id, ok: false, error: aborted ? `timeout after ${timeoutMs}ms` : e instanceof Error ? e.message : String(e) })
  } finally {
    clearTimeout(timer)
  }
}

let busy = 0
const MAX_CONCURRENT = 6

// Line-delimited JSON on stdin; requests are handled with a small concurrency
// cap so a burst of quote batches cannot fan out into a Yahoo rate-limit storm.
const lineBuf: string[] = []
let partial = ''

function pump(): void {
  while (lineBuf.length > 0 && busy < MAX_CONCURRENT) {
    const line = lineBuf.shift()
    if (!line) continue
    let req: Req
    try {
      req = JSON.parse(line) as Req
    } catch {
      continue // malformed line — never reply, never crash
    }
    if (typeof req.id !== 'number' || typeof req.url !== 'string') continue
    busy++
    void handle(req).finally(() => {
      busy--
      pump()
    })
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  partial += chunk
  const lines = partial.split('\n')
  partial = lines.pop() ?? ''
  for (const l of lines) if (l.trim()) lineBuf.push(l)
  pump()
})
process.stdin.on('end', () => {
  // Parent went away — exit quietly.
  process.exit(0)
})

// Safety: never let a silent worker linger if stdin is a pipe nobody writes to.
setInterval(() => {
  /* keep the event loop alive while waiting for requests */
}, 60_000)

console.error('[market-fetch-worker] ready (bun stdio fetch adapter)')
