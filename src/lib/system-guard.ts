/**
 * ============================================================================
 * system-guard — in-process observational guard (Task 172, one-service build)
 * ============================================================================
 * With the single-service architecture there is deliberately NOTHING outside
 * the app that could restart it (the old standalone watchdog + market-service
 * respawn layer are gone with the mini-services). The guard is therefore
 * OBSERVATIONAL: it samples the server's own RSS every 30s, logs honest
 * warnings as the process approaches the sandbox ceiling, and exposes its
 * state via /api/market/health so the Settings "System health" card keeps
 * showing a truthful picture. It never kills the process — the sandbox's own
 * dev-server supervision owns restarts now.
 *
 * Thresholds carry over the Task 171-R measurements: warmed steady-state
 * ~2.0GB, cold-compile spikes 2.4-2.6GB transient (benign), true runaway
 * growth ≥2800MB. warn = 2600 (amber, once per 5 min), alarm = 2800.
 */

interface GuardEvent { at: number; kind: 'warn' | 'alarm' | 'recover'; detail: string }

interface GuardState {
  watching: boolean
  thresholdMb: number
  intervalSec: number
  startedAt: number
  lastTickAt: number
  lastWarnAt: number
  rssMb: number
  peakRssMb: number
  events: GuardEvent[]
}

const G = Symbol.for('tradesviz.system.guard')
const g = ((globalThis as Record<symbol, unknown>)[G] as GuardState | undefined) ?? {
  watching: true,
  thresholdMb: 2800,
  intervalSec: 30,
  startedAt: Date.now(),
  lastTickAt: Date.now(),
  lastWarnAt: 0,
  rssMb: 0,
  peakRssMb: 0,
  events: [],
}
;(globalThis as Record<symbol, unknown>)[G] = g

const WARN_MB = 2600
const ALARM_MB = g.thresholdMb
const WARN_EVERY_MS = 5 * 60_000
const TICK_MS = 30_000

let timer: ReturnType<typeof setInterval> | null = null

function logEvent(kind: GuardEvent['kind'], detail: string) {
  g.events.unshift({ at: Date.now(), kind, detail })
  if (g.events.length > 8) g.events.length = 8
}

function tick() {
  g.lastTickAt = Date.now()
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
  const prev = g.rssMb
  g.rssMb = rssMb
  if (rssMb > g.peakRssMb) g.peakRssMb = rssMb

  if (rssMb >= ALARM_MB) {
    if (Date.now() - g.lastWarnAt > WARN_EVERY_MS) {
      g.lastWarnAt = Date.now()
      console.warn(`[system-guard] ALARM rss ${rssMb}MB ≥ ${ALARM_MB}MB — runaway growth zone; peak ${g.peakRssMb}MB`)
      logEvent('alarm', `${rssMb}MB ≥ ${ALARM_MB}MB`)
    }
  } else if (rssMb >= WARN_MB) {
    if (Date.now() - g.lastWarnAt > WARN_EVERY_MS) {
      g.lastWarnAt = Date.now()
      console.warn(`[system-guard] rss ${rssMb}MB above ${WARN_MB}MB (compile spikes are transient; alarm at ${ALARM_MB}MB)`)
      logEvent('warn', `${rssMb}MB ≥ ${WARN_MB}MB`)
    }
  } else if (prev >= WARN_MB && rssMb < WARN_MB) {
    console.log(`[system-guard] rss back to ${rssMb}MB (recovered from ${prev}MB)`)
    logEvent('recover', `${rssMb}MB after ${prev}MB`)
  }
}

export function startSystemGuard() {
  if (timer) return
  timer = setInterval(tick, TICK_MS)
  // First sample immediately (without the warn-gate side effects).
  g.rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
  g.peakRssMb = g.rssMb
  g.lastTickAt = Date.now()
  console.log(`[system-guard] watching server memory every ${TICK_MS / 1000}s (warn ${WARN_MB}MB / alarm ${ALARM_MB}MB)`)
}

export interface GuardView {
  watching: boolean
  thresholdMb: number
  intervalSec: number
  startedAt: string
  lastTickAt: string
  lastGuardAt: string | null
  lastGuardRssMb: number
  rssMb: number
  peakRssMb: number
  events: { at: string; kind: GuardEvent['kind']; detail: string }[]
}

/** Serializable view for /api/market/health (Settings system-health card). */
export function guardView(): GuardView {
  const lastAlarm = g.events.find((e) => e.kind === 'alarm') ?? null
  return {
    watching: g.watching,
    thresholdMb: g.thresholdMb,
    intervalSec: g.intervalSec,
    startedAt: new Date(g.startedAt).toISOString(),
    lastTickAt: new Date(g.lastTickAt).toISOString(),
    lastGuardAt: lastAlarm ? new Date(lastAlarm.at).toISOString() : null,
    lastGuardRssMb: lastAlarm ? g.rssMb : 0,
    rssMb: g.rssMb,
    peakRssMb: g.peakRssMb,
    events: g.events.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, detail: e.detail })),
  }
}
